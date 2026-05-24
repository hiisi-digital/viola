#![no_std]
#![deny(unsafe_op_in_unsafe_fn)]

//! Viola.toml config schema + zero-copy no_alloc TOML subset parser.
//!
//! Per `docs/PLUGIN-ABI-V1-DESIGN.md` §8 / §16.3, the canonical viola
//! config artifact is TOML. This crate ships the v1 schema and a
//! minimal parser that handles exactly the shape v1 needs: top-level
//! `key = "string"` and `key = ["string", ...]` entries, line comments
//! starting with `#`, and ASCII whitespace between tokens. Datetimes,
//! multiline strings, dotted keys, sub-tables, and inline tables are
//! out of scope; the parser rejects them deterministically.
//!
//! Parser output is zero-copy: every string slot is a `&[u8]` slice
//! into the caller's input buffer. The parser allocates nothing and
//! requires no allocator. Caller-supplied storage geometry comes
//! through the [`ViolaConfig`] const-generic capacity.
//!
//! ## v1 schema
//!
//! ```toml
//! # Path to the runner role's cdylib.
//! runner = "plugins/viola-runner-rust.dylib"
//!
//! # Paths to grammar role cdylibs. Order is significant; runners may
//! # iterate in declaration order.
//! grammars = [
//!     "plugins/viola-grammar-ts.dylib",
//!     "plugins/viola-grammar-rust.dylib",
//! ]
//!
//! # Paths to lint role cdylibs. Order does not affect output (the
//! # host sorts diagnostics deterministically per §10).
//! lints = [
//!     "plugins/viola-lint-no-yagni.dylib",
//! ]
//!
//! # Optional TS plugin runtime. When present, viola-cli auto-loads
//! # viola-deno-runtime.dylib (sibling to the executable) as the deno-
//! # backed runner / grammar / lint and feeds the user's TS config in
//! # via `lint_config`. Triggers the embedded TS pipeline.
//! [ts]
//! config = "viola.config.ts"
//! ```
//!
//! Per-lint structured config and plugin-set scopes (include/exclude
//! globs) are deferred to a follow-up round; the v1 parser leaves the
//! corresponding fields empty when those keys are absent and rejects
//! them with [`ConfigError::UnknownKey`] when present.

use hilavitkutin_str::ArenaInterner as _;
use notko::{Maybe, Outcome};

// Brings `USize::ZERO` into scope for the const constructors below.
use arvo::Identity as _;

mod parse;
pub mod issue_pattern;

pub use issue_pattern::{
    Category, Impact, IssuePattern, IssuePatternError, parse_issue_pattern,
};
pub use parse::{ConfigError, parse};

/// Resolved viola configuration with caller-provided fixed geometry.
///
/// `MAX_PLUGINS` bounds the number of grammar OR lint plugins (each
/// gets its own array of that size). Setting it to the larger of the
/// two expected counts is the simplest tuning. For the v1 lint
/// runtime where typical configurations carry under a dozen lints,
/// `MAX_PLUGINS = 16` is a comfortable starting point.
#[derive(Copy, Clone)]
pub struct ViolaConfig<'a, const MAX_PLUGINS: usize> {
    // -- v1 fields (still parsed when [viola].version is absent or 1) --
    pub runner: Maybe<&'a [u8]>,
    pub grammars: [&'a [u8]; MAX_PLUGINS],
    pub grammar_len: arvo::USize,
    pub lints: [&'a [u8]; MAX_PLUGINS],
    pub lint_len: arvo::USize,
    /// Path to the user's `viola.config.ts`, if a `[ts]` section is
    /// present. When set, viola-cli auto-loads `viola-deno-runtime`
    /// (sibling to the executable) as runner / grammar / lint and
    /// passes this path through `lint_config` so the embedded TS
    /// runtime can resolve and execute the user's config.
    pub ts_config: Maybe<&'a [u8]>,

    // -- v2 fields (require `[viola] version = 2`) --
    /// Schema version. `Maybe::Isnt` means the file did not declare
    /// `[viola] version = N` and the parser ran in v1-implicit mode.
    /// Currently the only declared value is `2`; future schema bumps
    /// will add more.
    pub version: Maybe<arvo::USize>,
    /// Unified plugin list. v2 users put every plugin (runner /
    /// grammar / lint, Rust cdylib or jsr: / npm: TS specifier) into
    /// `plugins = [...]`. Roles are derived from the descriptor's
    /// provider table at load time.
    pub plugins: [&'a [u8]; MAX_PLUGINS],
    pub plugin_len: arvo::USize,
    /// Preset names inherited from plugin-exported preset bundles.
    /// Applied in declaration order; user-authored severity rules
    /// override preset rules.
    pub inherit: [&'a [u8]; MAX_PLUGINS],
    pub inherit_len: arvo::USize,
    /// Global gate thresholds. Bare keys directly under `[gates]`
    /// land here; per-lint overrides go into `gate_overrides`.
    pub gates: GateThresholds<'a>,
    /// Per-lint gate threshold overrides. Each entry corresponds to a
    /// `[gates.<lint-id>]` sub-table; missing keys fall through to
    /// `gates`, then to the runtime built-in default.
    pub gate_overrides: [GateOverride<'a>; MAX_PLUGINS],
    pub gate_overrides_len: arvo::USize,
    /// Per-lint plugin-defined config blocks. Each entry corresponds
    /// to a `[lint.<lint-id>]` sub-table. The body is captured as a
    /// raw byte slice from the input; the parser validates the keys
    /// are well-formed `key = value` pairs (with string / array /
    /// integer values) but does not interpret the keys themselves.
    /// The plugin parses its own config from `raw_body` at runtime.
    pub lint_configs: [LintConfigBlock<'a>; MAX_PLUGINS],
    pub lint_configs_len: arvo::USize,
    /// Severity rules from `[[severity]]` array-of-tables entries.
    /// Evaluated top-to-bottom against each (issue, file, gate,
    /// confidence) tuple at runtime; later matches override earlier
    /// matches (CSS-style "last wins").
    pub severity_rules: [SeverityRule<'a>; MAX_PLUGINS],
    pub severity_rules_len: arvo::USize,
}

/// Per-gate severity threshold. Each field holds the raw severity
/// token (`b"error"`, `b"warn"`, `b"info"`, `b"hint"`, `b"off"`,
/// `b"skip"`) when present. The runtime parses tokens to its
/// internal severity enum; the parser stays bytes-only to keep the
/// schema parser independent of runtime types.
#[derive(Copy, Clone)]
pub struct GateThresholds<'a> {
    pub commit: Maybe<&'a [u8]>,
    pub build: Maybe<&'a [u8]>,
    pub push: Maybe<&'a [u8]>,
}

impl GateThresholds<'_> {
    pub const EMPTY: Self = Self {
        commit: Maybe::Isnt,
        build: Maybe::Isnt,
        push: Maybe::Isnt,
    };
}

/// One `[gates.<lint-id>]` sub-table. The runtime resolves a lint's
/// effective threshold at gate time by looking up `lint_id` here and
/// falling back to the parent [`ViolaConfig::gates`] for any missing
/// per-gate value.
#[derive(Copy, Clone)]
pub struct GateOverride<'a> {
    pub lint_id: &'a [u8],
    pub thresholds: GateThresholds<'a>,
}

impl GateOverride<'_> {
    pub const EMPTY: Self = Self {
        lint_id: &[],
        thresholds: GateThresholds::EMPTY,
    };
}

/// One `[lint.<lint-id>]` plugin-config sub-table. The runtime hands
/// `raw_body` to the matching plugin's `lint_evaluate` provider via
/// `LintConfig`. The parser validates the body is structurally
/// `key = value` pairs whose values are strings / arrays of strings /
/// integers, but does not interpret the keys.
///
/// Asymmetry note: unlike `[ts]` / `[viola]` / `[gates]` which
/// reject duplicate keys at parse time, `[lint.<id>]` bodies do
/// not. Two entries with the same key both end up in `raw_body`,
/// and the plugin's own parser decides how to handle them. Most
/// TOML parsers reject duplicate top-level keys, so a plugin
/// using a standard parser will surface the error at runtime; if
/// a plugin's parser is permissive (e.g. last-wins), the user
/// gets that semantic without warning. Plugin authors should
/// either reject duplicates (the conservative choice) or
/// document their permissiveness.
#[derive(Copy, Clone)]
pub struct LintConfigBlock<'a> {
    pub lint_id: &'a [u8],
    pub raw_body: &'a [u8],
}

impl LintConfigBlock<'_> {
    pub const EMPTY: Self = Self {
        lint_id: &[],
        raw_body: &[],
    };
}

/// Maximum number of file globs a single `[[severity]]` rule can
/// carry in its `files = [...]` array. Keeps the rule type bounded
/// for the no-alloc copy-storage shape.
pub const SEVERITY_FILES_CAP: usize = 8;

/// Maximum number of partial-rule entries in a compound severity
/// rule's `all = [...]` or `any = [...]` array. Smaller than
/// SEVERITY_FILES_CAP to keep nested storage bounded.
pub const SEVERITY_COMPOUND_CAP: usize = 4;

/// Maximum number of file globs in a single partial-rule entry
/// inside a compound rule. Smaller than the top-level cap; deeply
/// nested glob lists are rare in practice.
pub const SEVERITY_PARTIAL_FILES_CAP: usize = 4;

/// The compound boolean operator on a `[[severity]]` rule: `all`,
/// `any`, or `not`. Mutually exclusive with the rule's flat
/// `issue` / `files` fields; a rule sets either flat conditions or
/// a compound, never both.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum CompoundOp {
    All,
    Any,
    Not,
}

/// One partial rule inside a compound rule's array. Same condition
/// vocabulary as a flat [`SeverityRule`] minus `level` (the level
/// lives on the parent rule, not on each partial). Capped at
/// [`SEVERITY_PARTIAL_FILES_CAP`] file globs.
#[derive(Copy, Clone)]
pub struct PartialSeverityRule<'a> {
    pub issue: Maybe<&'a [u8]>,
    pub files: [&'a [u8]; SEVERITY_PARTIAL_FILES_CAP],
    pub files_len: arvo::USize,
    pub gate: Maybe<&'a [u8]>,
    pub min_confidence: Maybe<arvo::USize>,
}

impl PartialSeverityRule<'_> {
    pub const EMPTY: Self = Self {
        issue: Maybe::Isnt,
        files: [&[]; SEVERITY_PARTIAL_FILES_CAP],
        files_len: arvo::USize(0),
        gate: Maybe::Isnt,
        min_confidence: Maybe::Isnt,
    };
}

impl<'a> PartialSeverityRule<'a> {
    pub fn files_slice(&self) -> &[&'a [u8]] {
        &self.files[..self.files_len.0]
    }
}

/// One `[[severity]]` rule. Flat shape: applies to diagnostics
/// matching `issue` (raw pattern), in any of `files` (globs), at
/// the named `gate` (or every gate when `Maybe::Isnt`), and only
/// when the diagnostic's confidence is >= `min_confidence`. The
/// `level` field gives the severity to apply when the rule fires.
///
/// The compound shape (`all` / `any` / `not`) is reserved for a
/// future PR; this struct lands the flat shape.
#[derive(Copy, Clone)]
pub struct SeverityRule<'a> {
    pub issue: Maybe<&'a [u8]>,
    pub files: [&'a [u8]; SEVERITY_FILES_CAP],
    pub files_len: arvo::USize,
    pub gate: Maybe<&'a [u8]>,
    pub level: Maybe<&'a [u8]>,
    pub min_confidence: Maybe<arvo::USize>,
    /// Compound operator. When `Maybe::Isnt`, the rule is flat: the
    /// fields above carry the conditions. When `Maybe::Is(op)`, the
    /// flat condition fields are mutually exclusive with this and
    /// the rule's conditions live in `partials`.
    pub compound: Maybe<CompoundOp>,
    pub partials: [PartialSeverityRule<'a>; SEVERITY_COMPOUND_CAP],
    pub partials_len: arvo::USize,
}

impl SeverityRule<'_> {
    pub const EMPTY: Self = Self {
        issue: Maybe::Isnt,
        files: [&[]; SEVERITY_FILES_CAP],
        files_len: arvo::USize(0),
        gate: Maybe::Isnt,
        level: Maybe::Isnt,
        min_confidence: Maybe::Isnt,
        compound: Maybe::Isnt,
        partials: [PartialSeverityRule::EMPTY; SEVERITY_COMPOUND_CAP],
        partials_len: arvo::USize(0),
    };
}

impl<'a> SeverityRule<'a> {
    pub fn files_slice(&self) -> &[&'a [u8]] {
        &self.files[..self.files_len.0]
    }
    pub fn partials_slice(&self) -> &[PartialSeverityRule<'a>] {
        &self.partials[..self.partials_len.0]
    }
}

impl<const MAX_PLUGINS: usize> ViolaConfig<'_, MAX_PLUGINS> {
    /// Empty config. All slots are absent / zero-length.
    pub const fn empty() -> Self {
        Self {
            runner: Maybe::Isnt,
            grammars: [&[]; MAX_PLUGINS],
            grammar_len: arvo::USize(0),
            lints: [&[]; MAX_PLUGINS],
            lint_len: arvo::USize(0),
            ts_config: Maybe::Isnt,
            version: Maybe::Isnt,
            plugins: [&[]; MAX_PLUGINS],
            plugin_len: arvo::USize(0),
            inherit: [&[]; MAX_PLUGINS],
            inherit_len: arvo::USize(0),
            gates: GateThresholds::EMPTY,
            gate_overrides: [GateOverride::EMPTY; MAX_PLUGINS],
            gate_overrides_len: arvo::USize(0),
            lint_configs: [LintConfigBlock::EMPTY; MAX_PLUGINS],
            lint_configs_len: arvo::USize(0),
            severity_rules: [SeverityRule::EMPTY; MAX_PLUGINS],
            severity_rules_len: arvo::USize(0),
        }
    }
}

impl<'a, const MAX_PLUGINS: usize> ViolaConfig<'a, MAX_PLUGINS> {
    /// Resolve the effective gate-threshold token for a given lint at
    /// a given gate per the v2 chain documented in
    /// `docs/VIOLA-TOML-V2-SCHEMA.md` §"Gate resolution model":
    ///
    /// 1. `[gates.<lint_id>].<gate>` (per-lint override) if present;
    /// 2. else `[gates].<gate>` (global default) if present;
    /// 3. else the built-in `b"error"` default.
    ///
    /// Lookup is exact-match on `lint_id`; the issue-pattern grammar
    /// (`linter/*`, `*::category`, `>=impact`) is not yet evaluated
    /// at this layer. `gate` is one of `b"commit"` / `b"build"` /
    /// `b"push"`; any other token short-circuits to the default.
    ///
    /// A per-lint override that matches `lint_id` but does not set a
    /// value for the requested gate falls through to the global
    /// default rather than to the built-in. This matches the chain
    /// described in the schema memo: a lint can override `commit`
    /// while inheriting `build` and `push` from `[gates]`.
    pub fn resolve_gate_threshold(
        &'a self,
        lint_id: &[u8],
        gate: &[u8],
    ) -> &'a [u8] {
        let pick = |t: &GateThresholds<'a>| -> Maybe<&'a [u8]> {
            match gate {
                b"commit" => t.commit,
                b"build" => t.build,
                b"push" => t.push,
                _ => Maybe::Isnt,
            }
        };
        for o in self.gate_overrides_slice() {
            if o.lint_id == lint_id {
                if let Maybe::Is(s) = pick(&o.thresholds) {
                    return s;
                }
                // Definitive lint match without a value for this
                // gate: per the schema memo, the chain falls through
                // to the global default, not to the built-in. Stop
                // scanning rather than checking later overrides.
                break;
            }
        }
        if let Maybe::Is(s) = pick(&self.gates) {
            return s;
        }
        b"error"
    }
}

impl<const MAX_PLUGINS: usize> ViolaConfig<'_, MAX_PLUGINS> {
    /// View the populated grammar slots as a slice.
    pub fn grammars_slice(&self) -> &[&[u8]] {
        &self.grammars[..self.grammar_len.0]
    }

    /// View the populated lint slots as a slice.
    pub fn lints_slice(&self) -> &[&[u8]] {
        &self.lints[..self.lint_len.0]
    }

    /// View the populated v2 plugin slots as a slice.
    pub fn plugins_slice(&self) -> &[&[u8]] {
        &self.plugins[..self.plugin_len.0]
    }

    /// View the populated v2 inherit-preset slots as a slice.
    pub fn inherit_slice(&self) -> &[&[u8]] {
        &self.inherit[..self.inherit_len.0]
    }

    /// View the populated `[gates.<lint-id>]` overrides as a slice.
    pub fn gate_overrides_slice(&self) -> &[GateOverride<'_>] {
        &self.gate_overrides[..self.gate_overrides_len.0]
    }

    /// View the populated `[lint.<lint-id>]` config blocks as a slice.
    pub fn lint_configs_slice(&self) -> &[LintConfigBlock<'_>] {
        &self.lint_configs[..self.lint_configs_len.0]
    }

    /// View the populated `[[severity]]` rules as a slice.
    pub fn severity_rules_slice(&self) -> &[SeverityRule<'_>] {
        &self.severity_rules[..self.severity_rules_len.0]
    }
}

impl<const MAX_PLUGINS: usize> Default for ViolaConfig<'_, MAX_PLUGINS> {
    fn default() -> Self {
        Self::empty()
    }
}

/// Convenience: parse into a default-sized [`ViolaConfig`].
pub fn parse_default<'a>(
    input: &'a [u8],
) -> Outcome<ViolaConfig<'a, 16>, ConfigError> {
    parse::<16>(input)
}

// ---------------------------------------------------------------------
// Slice 2a: owned-form bridge for the Resource<T: 'static> boundary.
//
// `ViolaConfig<'a, N>` is the borrowed parser output. The host shim and
// `LoadConfig` WorkUnit need an owned form that satisfies `T: 'static`,
// because `hilavitkutin_api::Resource<T>` requires `'static`. The owned
// form below copies borrowed slices into stable storage: each `&[u8]`
// becomes a `hilavitkutin_str::Str` handle, and each fixed-cap list is
// paired with a `Cap<N>` length tracker. The arena that backs every
// `Str` lives as a private field on the owned struct itself, so the
// bundle is self-contained.
//
// Slice 2a ships the types; Slice 2b (`LoadConfig::execute` body) wires
// the parse path and the arena's real intern/resolve. The arena and the
// owned-record placeholders are zero-sized for Slice 2a.
// ---------------------------------------------------------------------

/// Maximum number of plugins one `ViolaConfigOwned` can carry. Matches
/// the workspace-default `MAX_PLUGINS` for the borrowed `ViolaConfig`.
pub const MAX_PLUGINS: usize = 16; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: const-generic cap; ConstParamTy on usize is the stack convention; tracked: #72

/// Maximum number of gates (`[gates]` entries) in one config.
pub const MAX_GATES: usize = 32; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: const-generic cap; tracked: #72

/// Maximum number of `[[severity]]` rules in one config.
pub const MAX_RULES: usize = 64; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: const-generic cap; tracked: #72

/// Maximum number of `[[severity.partial]]` rules in one config.
pub const MAX_PARTIAL_RULES: usize = 16; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: const-generic cap; tracked: #72

/// Arena byte capacity for one `ViolaConfigOwned`. Backs every `Str`
/// handle interned during parse.
pub const ARENA_BYTES: usize = 8192; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: const-generic cap; tracked: #72

/// Maximum number of distinct interned entries one `ConfigArena<N>` can carry.
/// Sizes the arena's offsets table at the type level.
pub const ARENA_MAX_ENTRIES: usize = 256; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: const-generic cap; tracked: #72

/// Maximum byte length of the raw viola.toml buffer the host shim hands
/// to `LoadConfig`. The buffer lives in `Resource<ConfigBytes>`.
pub const CONFIG_MAX_BYTES: usize = 16384; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: const-generic cap; tracked: #72

/// Host-shim-populated raw bytes of the workspace viola.toml.
///
/// `LoadConfig` reads this Resource and parses into `Resource<ViolaCfg>`.
/// `len` tracks the populated prefix of `bytes`; the trailing region is
/// uninitialised in practice but `[u8; N]` zeroes it for type-safety.
pub struct ConfigBytes {
    pub bytes: [u8; CONFIG_MAX_BYTES], // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: raw byte buffer at host-shim boundary; tracked: #72
    pub len: arvo::Cap,
}

/// Crate-private fixed-cap arena backing every `Str` handle inside one
/// `ViolaConfigOwned`. Cursor-based byte arena with a separate
/// offsets table indexed by 28-bit id. `&self` mutation is gated by
/// `Cell` / `UnsafeCell` interior mutability per the Slice 2b DOC CL.
struct ConfigArena<const N: usize> {
    bytes: core::cell::UnsafeCell<[u8; N]>, // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: raw arena buffer; tracked: #72
    cursor: core::cell::Cell<arvo::USize>,
    entries: core::cell::UnsafeCell<[(arvo::USize, arvo::USize); ARENA_MAX_ENTRIES]>,
    entries_len: core::cell::Cell<arvo::USize>,
}

impl<const N: usize> ConfigArena<N> {
    /// Empty arena.
    #[doc(hidden)]
    #[allow(dead_code)]
    const fn new() -> Self {
        Self {
            bytes: core::cell::UnsafeCell::new([0u8; N]), // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: zero-init of the raw arena buffer; tracked: #72
            cursor: core::cell::Cell::new(arvo::USize::ZERO),
            entries: core::cell::UnsafeCell::new([(arvo::USize::ZERO, arvo::USize::ZERO); ARENA_MAX_ENTRIES]),
            entries_len: core::cell::Cell::new(arvo::USize::ZERO),
        }
    }
}

// SAFETY: `LoadConfig` is the sole producer (declared in its `Write` set; the
// scheduler's AccessSet contract serialises writes on a Resource); subsequent
// WUs hold `Read` access only and do not call `arena_intern`. The interior
// mutability through `&self` is single-threaded per the scheduler's per-WU
// dispatch model. Slice 2b DOC CL ratifies this contract; see decision 3.
unsafe impl<const N: usize> Sync for ConfigArena<N> {}

// Aliasing contract for `arena_intern` / `arena_resolve`: the trait impl is
// append-only on `bytes` and `entries`, so a `&str` returned by `arena_resolve`
// stays valid across subsequent `arena_intern` calls (no prior bytes move). The
// `unsafe impl Sync` above pins cross-WU serialisation via AccessSet. Within
// one `execute` call, the caller MUST NOT hold an `&mut *self.bytes.get()` or
// `&mut *self.entries.get()` while calling either method on the same arena;
// the body shape (single-threaded, intern-then-use) satisfies this trivially.
impl<const N: usize> hilavitkutin_str::ArenaInterner for ConfigArena<N> {
    fn arena_intern(&self, s: &str) -> u32 { // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) lint:allow(no-bare-string) reason: ArenaInterner trait signature is fixed by hilavitkutin-str; tracked: #72
        let bytes = s.as_bytes();
        let len = bytes.len(); // lint:allow(no-bare-numeric) reason: slice len projects to usize at the std boundary; tracked: #72
        let offset = self.cursor.get().0; // lint:allow(no-bare-numeric) reason: USize.0 projects to usize for arithmetic; tracked: #72
        let new_offset = offset + len; // lint:allow(no-bare-numeric) reason: cursor arithmetic in usize; tracked: #72
        let id_internal = self.entries_len.get().0; // lint:allow(no-bare-numeric) reason: USize.0 projects to usize; tracked: #72
        // Fail-closed on EITHER overflow dimension; no state mutation. The
        // sentinel returned is 0 (resolves to ""); valid ids are 1-based so
        // id 0 never collides with a real entry.
        if new_offset > N || id_internal >= ARENA_MAX_ENTRIES {
            return 0u32; // lint:allow(no-bare-numeric) reason: sentinel id for arena overflow; tracked: #72
        }
        // SAFETY: cursor `offset..new_offset` is within [0, N) by the bounds
        // check above. The buffer is `UnsafeCell<[u8; N]>` and `&self`
        // serialisation holds per the `unsafe impl Sync` SAFETY note.
        unsafe {
            let buf = &mut *self.bytes.get();
            buf[offset..new_offset].copy_from_slice(bytes);
        }
        // SAFETY: same `&self` serialisation; the entries table is
        // `UnsafeCell<[(USize, USize); ARENA_MAX_ENTRIES]>`. `id_internal` is
        // in [0, ARENA_MAX_ENTRIES) by the bounds check above.
        unsafe {
            let entries = &mut *self.entries.get();
            entries[id_internal] = (arvo::USize(offset), arvo::USize(len));
        }
        self.cursor.set(arvo::USize(new_offset));
        self.entries_len.set(arvo::USize(id_internal + 1)); // lint:allow(no-bare-numeric) reason: entries-table cursor advance; tracked: #72
        // External id = internal index + 1 so id 0 is reserved as the
        // never-interned / overflow sentinel.
        (id_internal + 1) as u32 // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: ArenaInterner returns the 28-bit id as u32; tracked: #72
    }

    fn arena_resolve(&self, id: u32) -> &str { // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) lint:allow(no-bare-string) reason: ArenaInterner trait signature is fixed by hilavitkutin-str; tracked: #72
        if id == 0 { // lint:allow(no-bare-numeric) reason: 0 is the reserved overflow / never-interned sentinel; tracked: #72
            return "";
        }
        let idx = (id - 1) as usize; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: 1-based id projected back to 0-based table index; tracked: #72
        let len = self.entries_len.get().0; // lint:allow(no-bare-numeric) reason: USize.0 projects to usize for bounds check; tracked: #72
        if idx >= len || idx >= ARENA_MAX_ENTRIES {
            return "";
        }
        // SAFETY: `entries[idx]` is within bounds by the check above; the
        // entries table is initialised at construction; `arena_intern` writes
        // monotonically up to `entries_len`. The returned `&str` borrows from
        // `self.bytes` with `&self`-lifetime, which is the trait contract.
        let (offset, byte_len) = unsafe {
            let entries = &*self.entries.get();
            entries[idx]
        };
        unsafe {
            let buf = &*self.bytes.get();
            // Slice is valid UTF-8 because `arena_intern` only writes valid
            // `&str` bytes; the boundaries were the original `&str` boundaries.
            core::str::from_utf8_unchecked(&buf[offset.0..offset.0 + byte_len.0]) // lint:allow(no-bare-numeric) reason: USize.0 projects for slice range arithmetic; tracked: #72
        }
    }
}

/// Owned-form viola config. Self-contained `'static` value: every
/// borrowed slice in `ViolaConfig` becomes a `Str` handle into the
/// bundled `arena`, every variable-length list becomes a fixed-cap
/// `[T; CAP]` plus a `Cap<CAP>` length tracker.
///
/// Slice 2a ships the type with zero-sized placeholder records
/// (`PluginEntryOwned`, etc.) inside the fixed-cap arrays. Body slices
/// land real field shapes when they first need each.
pub struct ViolaConfigOwned<
    const MAX_PLUGINS_CAP: usize,
    const MAX_GATES_CAP: usize,
    const MAX_RULES_CAP: usize,
    const MAX_PARTIAL_RULES_CAP: usize,
    const ARENA_BYTES_CAP: usize,
> {
    plugins: core::cell::UnsafeCell<[PluginEntryOwned; MAX_PLUGINS_CAP]>,
    plugins_len: core::cell::Cell<arvo::Cap>,
    pub gates: [GateOwned; MAX_GATES_CAP],
    pub gates_len: arvo::Cap,
    pub rules: [RuleOwned; MAX_RULES_CAP],
    pub rules_len: arvo::Cap,
    pub partial_rules: [PartialRuleOwned; MAX_PARTIAL_RULES_CAP],
    pub partial_rules_len: arvo::Cap,
    arena: ConfigArena<ARENA_BYTES_CAP>,
}

// SAFETY: Mirrors the `unsafe impl Sync for ConfigArena<N>` contract.
// `LoadConfig` is the sole producer that calls `populate_from_borrowed`
// (declared in its `Write` set via `Resource<ViolaCfg>`); the scheduler's
// AccessSet contract serialises that producer slot. Downstream WUs that
// read `Resource<ViolaCfg>` (`LoadPlugins`, `DiscoverFiles`, runner /
// lint bodies) hold `Read` access only and use the `&self`-receiver
// accessors (`plugin_path`, `plugin_at`) which do not mutate. The
// interior mutability through `&self` is single-threaded per the
// scheduler's per-WU dispatch model.
unsafe impl<
    const MAX_PLUGINS_CAP: usize,
    const MAX_GATES_CAP: usize,
    const MAX_RULES_CAP: usize,
    const MAX_PARTIAL_RULES_CAP: usize,
    const ARENA_BYTES_CAP: usize,
> Sync for ViolaConfigOwned<MAX_PLUGINS_CAP, MAX_GATES_CAP, MAX_RULES_CAP, MAX_PARTIAL_RULES_CAP, ARENA_BYTES_CAP> {}

/// One plugin entry in `ViolaConfigOwned`. Parser-side owned shape:
/// the host-side post-load `viola_core::wus::PluginEntry` is distinct
/// and lives in `Column<PluginEntry>`. This owned-record carries the
/// manifest data the parser emitted (display name and filesystem path),
/// interned via the bundled `ConfigArena` during `populate_from_borrowed`.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct PluginEntryOwned {
    pub name: hilavitkutin_str::Str,
    pub path: hilavitkutin_str::Str,
}

/// Placeholder for one gate entry. Validator slices replace with real
/// fields.
#[derive(Copy, Clone, Debug, Default)]
pub struct GateOwned;

/// Placeholder for one `[[severity]]` rule. Validator slices replace
/// with real fields.
#[derive(Copy, Clone, Debug, Default)]
pub struct RuleOwned;

/// Placeholder for one `[[severity.partial]]` rule. Validator slices
/// replace with real fields.
#[derive(Copy, Clone, Debug, Default)]
pub struct PartialRuleOwned;

impl<
    const MAX_PLUGINS_CAP: usize,
    const MAX_GATES_CAP: usize,
    const MAX_RULES_CAP: usize,
    const MAX_PARTIAL_RULES_CAP: usize,
    const ARENA_BYTES_CAP: usize,
> ViolaConfigOwned<MAX_PLUGINS_CAP, MAX_GATES_CAP, MAX_RULES_CAP, MAX_PARTIAL_RULES_CAP, ARENA_BYTES_CAP>
{
    /// Populate this owned config from a borrowed parser result.
    ///
    /// Slice 3c fills the plugins arm. Walks `borrowed.plugins[..plugin_len]`,
    /// interns each `&[u8]` path through the bundled arena, wraps the
    /// returned id as a runtime-origin `Str`, and writes
    /// `PluginEntryOwned { name: Str::default(), path: <interned> }`
    /// into each owned-array slot. Gates / rules / partial_rules arms stay
    /// no-op until their producer body slices flip the corresponding
    /// owned-record types and wrap their arrays in `UnsafeCell` / `Cell`
    /// (mirroring the plugins arm pattern).
    ///
    /// Takes `&self`. `Resource<ViolaCfg>` is in `LoadConfig::Write`;
    /// the scheduler's AccessSet contract serialises that producer slot.
    /// The plugins array and plugins_len counter use `UnsafeCell` and
    /// `Cell` respectively, mirroring the bundled `ConfigArena`'s
    /// interior-mutability pattern. The `unsafe impl Sync` on
    /// `ViolaConfigOwned` pins the single-writer invariant.
    pub fn populate_from_borrowed(
        &self,
        borrowed: &ViolaConfig<'_, MAX_PLUGINS_CAP>,
    ) {
        let n: usize = *borrowed.plugin_len; // lint:allow(no-bare-numeric) reason: bridges arvo::USize to std slice-index API; tracked: #72
        // SAFETY: single-writer per AccessSet (see ViolaConfigOwned Sync
        // SAFETY note). LoadConfig is the only WU calling this method;
        // downstream readers use &self accessors that go through
        // `&*self.plugins.get()` (shared-ref read of the same UnsafeCell)
        // and are phase-separated from this write by the scheduler.
        //
        // Aliasing with the arena reborrow below: `arena` is a sibling
        // field of `plugins`, so `&mut *self.plugins.get()` and the
        // `&self.arena` reborrow inside `arena_intern` operate on
        // disjoint memory per field-projection rules. If a future
        // refactor folds the arena into the same UnsafeCell, this
        // SAFETY argument needs revisiting.
        let plugins_mut: &mut [PluginEntryOwned; MAX_PLUGINS_CAP] = unsafe {
            &mut *self.plugins.get()
        };
        let mut i: usize = 0; // lint:allow(no-bare-numeric) reason: loop counter; tracked: #72
        while i < n && i < MAX_PLUGINS_CAP {
            let bytes: &[u8] = borrowed.plugins[i];
            // The parser's `plugins[i]: &[u8]` does not pin utf-8 at the
            // type level. Skip non-utf-8 entries rather than risk silent
            // UB through `from_utf8_unchecked`. Tracked: a future
            // parser-side typed `PathBytes` wrapper would pin the
            // invariant and remove this branch.
            let s: &str = match core::str::from_utf8(bytes) {
                Ok(s) => s,
                Err(_) => {
                    i += 1; // lint:allow(no-bare-numeric) reason: loop counter increment; tracked: #72
                    continue;
                }
            };
            let id: u32 = self.arena.arena_intern(s); // lint:allow(no-bare-numeric) reason: ArenaInterner trait signature is fixed by hilavitkutin-str; tracked: #72
            let path_handle: hilavitkutin_str::Str = hilavitkutin_str::Str::__runtime(
                arvo::Bits::<28, arvo::Hot>::from_raw(id), // lint:allow(no-bare-numeric) reason: arena id is u32 by trait contract; tracked: #72
            );
            plugins_mut[i] = PluginEntryOwned {
                name: hilavitkutin_str::Str::default(),
                path: path_handle,
            };
            i += 1; // lint:allow(no-bare-numeric) reason: loop counter increment; tracked: #72
        }
        self.plugins_len.set(arvo::Cap(arvo::USize(i)));
    }

    /// Currently populated plugin count.
    pub fn plugins_len(&self) -> arvo::Cap {
        self.plugins_len.get()
    }

    /// Plugin entry at slot `i`, or `Maybe::Isnt` past the populated
    /// prefix. The returned `&PluginEntryOwned` lives for `&self`.
    pub fn plugin_at(&self, i: arvo::Cap) -> notko::Maybe<&PluginEntryOwned> {
        let idx: usize = *i.0; // lint:allow(no-bare-numeric) reason: bridges arvo::Cap to slot indexing; tracked: #72
        let len: usize = *self.plugins_len.get().0; // lint:allow(no-bare-numeric) reason: same; tracked: #72
        if idx >= len || idx >= MAX_PLUGINS_CAP {
            return notko::Maybe::Isnt;
        }
        // SAFETY: shared-ref read through UnsafeCell. The single-writer
        // AccessSet invariant ensures no concurrent `populate_from_borrowed`
        // call is mid-write. The returned `&PluginEntryOwned` borrows
        // for `&self`.
        let plugins: &[PluginEntryOwned; MAX_PLUGINS_CAP] = unsafe { &*self.plugins.get() };
        notko::Maybe::Is(&plugins[idx])
    }

    /// Plugin filesystem path resolved back from the arena. Returns
    /// `Maybe::Isnt` when `i` is past the populated prefix (the bound
    /// `*self.plugins_len.0`). Callers must NOT treat an out-of-bounds
    /// `Maybe::Isnt` as an empty string; an empty path fed to
    /// `Library::load` is a real crash vector.
    pub fn plugin_path(&self, i: arvo::Cap) -> notko::Maybe<&str> {
        match self.plugin_at(i) {
            notko::Maybe::Is(entry) => {
                let id: u32 = entry.path.id().to_raw(); // lint:allow(no-bare-numeric) reason: Str id projection; tracked: #72
                notko::Maybe::Is(self.arena.arena_resolve(id))
            }
            notko::Maybe::Isnt => notko::Maybe::Isnt,
        }
    }

    /// Construct an empty owned config.
    ///
    /// Not `const fn`: `PluginEntryOwned` carries two `hilavitkutin_str::Str`
    /// handles whose `Default::default()` is not const-callable in stable
    /// Rust today. The `Default` constructor seeds the workspace's
    /// `Resource<ViolaCfg>` and runs once per scheduler-builder, so the
    /// const-ness loss has no runtime cost.
    pub fn new() -> Self {
        Self {
            plugins: core::cell::UnsafeCell::new(
                [PluginEntryOwned::default(); MAX_PLUGINS_CAP],
            ),
            plugins_len: core::cell::Cell::new(arvo::Cap(arvo::USize::ZERO)),
            gates: [GateOwned; MAX_GATES_CAP],
            gates_len: arvo::Cap(arvo::USize::ZERO),
            rules: [RuleOwned; MAX_RULES_CAP],
            rules_len: arvo::Cap(arvo::USize::ZERO),
            partial_rules: [PartialRuleOwned; MAX_PARTIAL_RULES_CAP],
            partial_rules_len: arvo::Cap(arvo::USize::ZERO),
            arena: ConfigArena::<ARENA_BYTES_CAP>::new(),
        }
    }
}

/// Workspace-default instantiation of `ViolaConfigOwned`. Consumers
/// reference this alias rather than the full const-generic shape.
pub type ViolaCfg = ViolaConfigOwned<
    MAX_PLUGINS,
    MAX_GATES,
    MAX_RULES,
    MAX_PARTIAL_RULES,
    ARENA_BYTES,
>;

#[cfg(test)]
mod gate_resolution_tests {
    use super::*;

    fn parse_v2(s: &[u8]) -> ViolaConfig<'_, 16> {
        match parse::<16>(s) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("expected parse ok, got {e:?}"),
        }
    }

    #[test]
    fn defaults_to_error_when_no_gates_declared() {
        let cfg = parse_v2(
            b"[viola]\nversion = 2\nplugins = [\"./p.dylib\"]\n",
        );
        assert_eq!(cfg.resolve_gate_threshold(b"any-lint", b"commit"), b"error");
        assert_eq!(cfg.resolve_gate_threshold(b"any-lint", b"build"), b"error");
        assert_eq!(cfg.resolve_gate_threshold(b"any-lint", b"push"), b"error");
    }

    #[test]
    fn falls_through_to_global_when_no_per_lint_match() {
        let cfg = parse_v2(
            b"[viola]\nversion = 2\nplugins = [\"./p.dylib\"]\n[gates]\ncommit = \"warn\"\nbuild = \"error\"\npush = \"error\"\n",
        );
        assert_eq!(cfg.resolve_gate_threshold(b"some-lint", b"commit"), b"warn");
        assert_eq!(cfg.resolve_gate_threshold(b"some-lint", b"build"), b"error");
    }

    #[test]
    fn per_lint_override_wins_for_matched_gate() {
        let cfg = parse_v2(
            b"[viola]\nversion = 2\nplugins = [\"./p.dylib\"]\n[gates]\ncommit = \"warn\"\n[gates.no-bare-numeric]\ncommit = \"error\"\n",
        );
        assert_eq!(
            cfg.resolve_gate_threshold(b"no-bare-numeric", b"commit"),
            b"error"
        );
        assert_eq!(
            cfg.resolve_gate_threshold(b"other-lint", b"commit"),
            b"warn"
        );
    }

    #[test]
    fn per_lint_override_falls_through_to_global_for_unset_gate() {
        // duplicate-logic only sets `push`; `commit` should fall
        // through to the global default, not to the built-in "error".
        let cfg = parse_v2(
            b"[viola]\nversion = 2\nplugins = [\"./p.dylib\"]\n[gates]\ncommit = \"warn\"\n[gates.duplicate-logic]\npush = \"error\"\n",
        );
        assert_eq!(
            cfg.resolve_gate_threshold(b"duplicate-logic", b"commit"),
            b"warn"
        );
        assert_eq!(
            cfg.resolve_gate_threshold(b"duplicate-logic", b"push"),
            b"error"
        );
    }

    #[test]
    fn per_lint_override_falls_through_to_builtin_when_global_silent() {
        // No global [gates] block; per-lint sets push but not commit.
        // commit should resolve to the built-in "error".
        let cfg = parse_v2(
            b"[viola]\nversion = 2\nplugins = [\"./p.dylib\"]\n[gates.duplicate-logic]\npush = \"warn\"\n",
        );
        assert_eq!(
            cfg.resolve_gate_threshold(b"duplicate-logic", b"commit"),
            b"error"
        );
        assert_eq!(
            cfg.resolve_gate_threshold(b"duplicate-logic", b"push"),
            b"warn"
        );
    }

    #[test]
    fn unknown_gate_name_resolves_to_builtin() {
        // Gate name not in {commit, build, push}. Both global and
        // per-lint pickers return Maybe::Isnt, so the chain ends at
        // the built-in default.
        let cfg = parse_v2(
            b"[viola]\nversion = 2\nplugins = [\"./p.dylib\"]\n[gates]\ncommit = \"warn\"\n",
        );
        assert_eq!(cfg.resolve_gate_threshold(b"any", b"release"), b"error");
    }
}

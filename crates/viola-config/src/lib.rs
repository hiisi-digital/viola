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

use notko::{Maybe, Outcome};

mod parse;

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
    /// capability table at load time.
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
        }
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

//! WorkUnit stubs for the viola pipeline.
//!
//! Six WUs cover the static pipeline shape per the scoping memo at
//! `mock/research/202605240700_topic.scoping-254-viola-as-hilavitkutin-app.md`.
//! Each stub declares the AccessSet shape, scheduling hint, and Ctx
//! bound; bodies are `unimplemented!()` and ship per their body slice.
//!
//! The placeholder column-record types (`PluginEntry`, `FileInfo`,
//! `Nam`, `Diagnostic`, `DiagnosticSink`) are zero-sized for Slice 2a.
//! Each gains real fields when its body slice first needs them. The
//! owned-form `viola_config::ViolaCfg` replaces the Slice 1
//! `ViolaConfigOpaque` placeholder as the carrier in `Resource<...>`
//! sets across the three WUs that read or write the parsed config.

mod stub;

mod discover_files;
mod emit_diagnostics;
mod load_config;
mod load_plugins;
mod run_lint;
mod run_runner;

pub use discover_files::DiscoverFiles;
pub use emit_diagnostics::EmitDiagnostics;
pub use load_config::LoadConfig;
pub use load_plugins::LoadPlugins;
pub use run_lint::RunLint;
pub use run_runner::RunRunner;

pub use stub::WuCtxStub;

/// Host-side per-plugin record carried by `Column<PluginEntry>`.
///
/// Slice 3 flips this from the Slice 1 ZST to fields-bearing. The
/// loaded `Library` instance lives in `Resource<ExtensionHost>`;
/// `host_idx` is the bridge. `Column<T>` requires `ColumnValue = Copy
/// + 'static`; all four field types are `Copy` (`Str` is a 4-byte
/// handle, `Mask64` is `Bits<64, Hot>`, `AbiVersion(u32)` is a
/// wrapper, `Cap` wraps `USize` which wraps `usize`). No `Drop`.
///
/// `Debug` derive is intentionally omitted: `arvo_bitmask::Mask<W>`
/// and `hilavitkutin_extensions::AbiVersion` do not derive `Debug` in
/// the current upstream releases. A workspace-local newtype wrapping
/// to add Debug is out of scope; either upstream PR adds the derives
/// or this comment guides the next reader to manually format if
/// needed.
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct PluginEntry {
    pub name: hilavitkutin_str::Str,
    pub roles: crate::role::Mask64,
    pub abi_version: hilavitkutin_extensions::AbiVersion,
    pub host_idx: arvo::Cap,
}

/// Column record carried by `Column<FileInfo>`. Two `Copy` fields:
/// `path` (a host-shim-interned `Str` handle copied from the matching
/// `DiscoveredFilePaths` slot during projection) and `kind` (the
/// file-type classification; Slice 4 constructs only `FileKind::Regular`
/// until the host shim supplies kind info per the BACKLOG entry).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct FileInfo {
    pub path: hilavitkutin_str::Str,
    pub kind: FileKind,
}

/// Closed-vocabulary enum classifying one discovered file. Per
/// `vocabulary.md`'s closed-enum-as-spec pattern; the three variants
/// are the spec.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum FileKind {
    /// A regular file. The common case; lints operate on these.
    #[default]
    Regular,
    /// A symbolic link. Lints may follow or skip per future config.
    Symlink,
    /// Anything else (fifo, device, socket, directory if the host shim
    /// emits one).
    Other,
}

/// Column record carried by `Column<Nam>`. One `Copy` field:
/// `payload` (the FFI carrier returned by the runner's `execute_scope`
/// vtable; plugin-owned memory immutable for the scheduler-run duration
/// per the ABI doc). Slice 5a flips this from the Slice 1 ZST
/// placeholder; Slice 5b lands the RunRunner body that writes one row
/// per scheduler run (singleton-row convention; the runner is scope-
/// shaped per `viola_plugin_abi`).
///
/// `Debug` is intentionally omitted: `NamPayload` carries
/// `data: *const c_void` and does not derive `Debug` upstream. The
/// `viola-core/SHAME.md.tmpl` `## Nam` entry tracks the discipline gap.
#[derive(Copy, Clone)]
pub struct Nam {
    pub payload: viola_plugin_abi::NamPayload,
}

/// Per-finding record carried by `Column<WuDiagnostic>`. The host-side
/// element type for the diagnostic fan-in. Distinct from
/// `viola_plugin_abi::Diagnostic` (the FFI plugin-owned carrier);
/// `EmitDiagnostics` (Slice 7) projects host-side to ABI shape at egress.
///
/// Slice 2b ships the fields the parse-error path needs; future producer
/// slices may extend with additional context.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct WuDiagnostic {
    pub severity: viola_plugin_abi::DiagnosticSeverity,
    pub source: WuDiagnosticSource,
    pub message: hilavitkutin_str::Str,
    pub range: notko::Maybe<viola_plugin_abi::SourceRange>,
}

/// Closed-vocabulary enum classifying the WU that produced a `WuDiagnostic`.
/// All six known producers ship in Slice 2b per `vocabulary.md`'s closed-enum-as-spec
/// pattern (`Phase` precedent). Each producer slice constructs only its own variant.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum WuDiagnosticSource {
    /// Parse failure on `Resource<ConfigBytes>` (Slice 2b producer).
    ConfigParse,
    /// Plugin dlopen, descriptor verification, or ABI gate failure (Slice 3).
    PluginLoad,
    /// Filesystem walk error or include/exclude mismatch (Slice 4).
    FileWalk,
    /// Runner WU body failure (Slice 5).
    RunRunner,
    /// Lint WU body failure (Slice 6).
    RunLint,
    /// `EmitDiagnostics` sink-side egress failure (Slice 7).
    Emit,
}

/// Diagnostic egress writer trait. `EmitDiagnostics<W>` drives one
/// `EmitWriter` impl held inside `Resource<DiagnosticSink<W>>`. The
/// trait is minimal by design: per-write failure has no useful
/// recovery action at WU body level, so methods return unit.
/// Concrete impls (viola-cli's stderr writer, future LSP-buffered
/// emitter, future network sink) handle syscall context internally.
pub trait EmitWriter {
    /// Emit `s` as part of the current diagnostic line. Implementors
    /// may buffer, route, drop, or panic on failure per their
    /// concrete policy.
    fn write_str(&mut self, s: &str);
    /// Emit `bytes` (raw, non-UTF-8 path or pre-formatted span).
    fn write_bytes(&mut self, bytes: &[u8]);
    /// Flush any buffered output. Called once at end-of-emit.
    fn flush(&mut self);
}

/// No-op `EmitWriter` default. ZST, `Default`-constructible. Used by
/// AccessSet witness tests so `EmitDiagnostics<EmitFlat>` and
/// `DiagnosticSink<EmitFlat>` can be instantiated without pulling
/// viola-cli's concrete impl into the test build. Production code in
/// viola-cli supplies its own `EmitWriter` impl.
#[derive(Copy, Clone, Default)]
pub struct EmitFlat;

impl EmitWriter for EmitFlat {
    fn write_str(&mut self, _s: &str) {}
    fn write_bytes(&mut self, _bytes: &[u8]) {}
    fn flush(&mut self) {}
}

/// Diagnostic egress sink Resource. Generic over the `EmitWriter` impl
/// that viola-cli registers at scheduler-builder time. `EmitDiagnostics`
/// is the sole writer (declared in its Write set); the scheduler
/// serialises Write access; no other WU touches this Resource.
pub struct DiagnosticSink<W: EmitWriter> {
    writer: core::cell::UnsafeCell<W>,
}

impl<W: EmitWriter> DiagnosticSink<W> {
    /// Construct a sink wrapping the given writer. Called at
    /// scheduler-builder time when viola-cli registers the Resource.
    pub const fn new(writer: W) -> Self {
        Self {
            writer: core::cell::UnsafeCell::new(writer),
        }
    }

    /// Emit one string through the wrapped writer.
    ///
    /// # Safety
    ///
    /// Caller MUST hold a `Write` projection of this Resource for the
    /// scheduler-dispatched WU. Concretely: `EmitDiagnostics<W>` is
    /// the sole declared writer (see `wus/emit_diagnostics.rs`); the
    /// scheduler's per-WU dispatch serialises that WU's `execute`,
    /// so the `&mut W` reborrow through the `UnsafeCell` is the only
    /// live borrow of the writer for the duration of the call.
    pub unsafe fn write_str(&self, s: &str) {
        let writer: &mut W = unsafe { &mut *self.writer.get() };
        writer.write_str(s);
    }

    /// Emit raw bytes through the wrapped writer.
    ///
    /// # Safety
    ///
    /// Same contract as `write_str`.
    pub unsafe fn write_bytes(&self, bytes: &[u8]) {
        let writer: &mut W = unsafe { &mut *self.writer.get() };
        writer.write_bytes(bytes);
    }

    /// Flush the wrapped writer. Called once at end-of-emit.
    ///
    /// # Safety
    ///
    /// Same contract as `write_str`.
    pub unsafe fn flush(&self) {
        let writer: &mut W = unsafe { &mut *self.writer.get() };
        writer.flush();
    }
}

// SAFETY: `EmitDiagnostics<W>` is the sole declared writer of
// `Resource<DiagnosticSink<W>>` (see `wus/emit_diagnostics.rs`'s Write
// set). The scheduler serialises that WU's `execute` against any
// reader of the Resource by AccessSet contract. No other WU declares
// `Resource<DiagnosticSink<W>>` in its AccessSet. Interior mutability
// through `&self` is single-threaded for the duration of one WU
// dispatch, satisfying the four-invariant Sync contract paralleling
// the host-shim Resources.
unsafe impl<W: EmitWriter> Sync for DiagnosticSink<W> {}


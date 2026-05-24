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

/// Placeholder for the per-file record. Slice 4 wires real fields.
#[derive(Copy, Clone, Debug)]
pub struct FileInfo;

/// Placeholder for the per-file parser snapshot. Slice 5 wires real fields.
#[derive(Copy, Clone, Debug)]
pub struct Nam;

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

/// Placeholder for the diagnostic egress sink. Slice 7 wires real fields.
#[derive(Copy, Clone, Debug)]
pub struct DiagnosticSink;


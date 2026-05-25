#![no_std]
#![deny(unsafe_op_in_unsafe_fn)]

//! Viola Core (Host Runtime).
//!
//! `viola-core` is the in-process host runtime for viola plugins. It
//! is `#![no_std]` and adds only viola-domain layering over the
//! `hilavitkutin-extensions` host primitives that handle descriptor
//! discovery, library loading, abi gating, required-host-cap checks,
//! and per-extension lifecycle.
//!
//! ## What this crate adds over hilavitkutin-extensions
//!
//! - [`role`]: cap-derived role classification per
//!   `docs/PLUGIN-ABI-V1-DESIGN.md` §5. A plugin's role set is the set
//!   of v1 provider ids it exports.
//! - [`invoke`]: typed vtable resolvers for the three v1 providers,
//!   bridging raw `*const c_void` to the `#[repr(C)]` shapes pinned in
//!   [`viola_plugin_abi::vtable`].
//! - [`aggregate`]: §10 deterministic diagnostic comparator + slice
//!   sort helpers retained for host-shim sibling consumers; the
//!   in-WU sort lives inside [`wus::EmitDiagnostics`].
//! - [`resources`] + [`wus`]: post-#254 hilavitkutin-app surface. The
//!   in-process pipeline runs through `hilavitkutin::Scheduler` over
//!   the WorkUnits in [`wus`] and the Resources / Columns in
//!   [`resources`]. The pre-#254 `pipeline::run` orchestrator and
//!   `Session<N>` LIFO helper are removed per Slice 8a.

pub mod aggregate;
pub mod invoke;
pub mod resources;
pub mod role;
pub mod wus;

pub use hilavitkutin_extensions::{
    ProviderEntry, ProviderExport, ProviderId, DESCRIPTOR_SYMBOL,
    Extension, ExtensionAbiStatus, ExtensionDescriptor, ExtensionError,
    ExtensionHost, ExtensionMeta, ExtensionRequirement, ExtensionVersion,
    FailurePolicyFn, HOST_ABI_VERSION, InitHandler, PolicyVerdict,
    ShutdownHandler, default_policy,
};

pub use viola_config::ViolaCfg;

pub use viola_plugin_abi::{
    BytesRef, PROVIDER_GRAMMAR_EXTRACT, PROVIDER_LINT_EVALUATE,
    PROVIDER_RUNNER_EXECUTE_SCOPE, Diagnostic, DiagnosticBatch,
    DiagnosticSeverity, FileEntry, GrammarExtractVtable, LintEvaluateVtable,
    NamPayload, NamVersion, PluginError, RunScope, RunSurface,
    RunnerExecuteScopeVtable, SourceLocation, SourceRange,
    StructuredError,
};

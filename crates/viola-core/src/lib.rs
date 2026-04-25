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
//!   of v1 capability ids it exports.
//! - [`invoke`]: typed vtable resolvers for the three v1 capabilities,
//!   bridging raw `*const c_void` to the `#[repr(C)]` shapes pinned in
//!   [`viola_plugin_abi::vtable`].
//! - [`pipeline`]: runner-once + lint-fan-out orchestration over a
//!   single NAM snapshot, per §7.1 / §8.3. Diagnostics egress through
//!   a consumer-provided [`pipeline::DiagnosticSink`].
//! - [`aggregate`]: §10 deterministic diagnostic comparator + slice
//!   sort.
//! - [`session`]: fixed-cap LIFO container that pins reverse-
//!   insertion-order shutdown across multiple extensions, per §7.4.

pub mod aggregate;
pub mod invoke;
pub mod pipeline;
pub mod role;
pub mod session;

pub use hilavitkutin_extensions::{
    CapabilityEntry, CapabilityExport, CapabilityId, DESCRIPTOR_SYMBOL,
    Extension, ExtensionAbiStatus, ExtensionDescriptor, ExtensionError,
    ExtensionHost, ExtensionMeta, ExtensionRequirement, ExtensionVersion,
    FailurePolicyFn, HOST_ABI_VERSION, InitHandler, PolicyVerdict,
    ShutdownHandler, default_policy,
};

pub use viola_plugin_abi::{
    BytesRef, CAP_GRAMMAR_EXTRACT, CAP_LINT_EVALUATE,
    CAP_RUNNER_EXECUTE_SCOPE, Diagnostic, DiagnosticBatch,
    DiagnosticSeverity, FileEntry, GrammarExtractVtable, LintEvaluateVtable,
    NamPayload, NamVersion, PluginError, RunScope, RunSurface,
    RunnerExecuteScopeVtable, SourceLocation, SourceRange,
    StructuredError,
};

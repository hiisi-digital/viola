#![no_std]
#![deny(unsafe_op_in_unsafe_fn)]

//! Viola Core (Host Runtime).
//!
//! `viola-core` is the in-process host runtime for viola plugins. It
//! is `#![no_std]` and adds only viola-domain layering over the
//! `hilavitkutin-extensions` host primitives that handle descriptor
//! discovery, library loading, abi gating, required-host-cap checks,
//! and lifecycle.
//!
//! ## Public surface (in progress)
//!
//! This crate's public surface is being assembled on the correct
//! substrate after the prior `libloading` + `std` host loader was
//! removed. Tracked items:
//!
//! - role-vs-capability validation (Runner / Grammar / Lint <->
//!   `CAP_RUNNER_EXECUTE_SCOPE` / `CAP_GRAMMAR_EXTRACT` /
//!   `CAP_LINT_EVALUATE`)
//! - runner-once + lint-fan-out orchestration over a single NAM
//! - deterministic diagnostic aggregation per
//!   `docs/PLUGIN-ABI-V1-DESIGN.md` §10 sort key
//! - viola.toml config-driven plugin path resolution per §16.3
//!
//! Until each lands, the crate exposes only the substrate re-exports
//! plugin authors and embedders need to compose against.

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

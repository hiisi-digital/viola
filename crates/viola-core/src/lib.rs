//! # Viola Core (Host Runtime)
//!
//! `viola-core` is the in-process host runtime for the Viola plugin
//! ABI v1. It opens native plugin cdylibs, validates their descriptors
//! against the host contract, drives the seven-stage lifecycle from
//! `docs/PLUGIN-ABI-V1-DESIGN.md` §7.1, dispatches capability calls
//! through the typed v1 vtables, and aggregates lint diagnostics into a
//! deterministic-keyed list per §10.
//!
//! ## Public surface
//!
//! - [`Host`] is the embedder entry point. It owns the
//!   [`HostContext`] and the loaded plugin set.
//! - [`HostError`] wraps [`viola_plugin_abi::PluginError`] with
//!   operational context (plugin id, library path, retryable flag).
//! - [`OwnedDiagnostic`] is the host-owned, post-aggregation diagnostic
//!   shape returned by [`Host::run`].
//! - [`resolution`] exposes the §16.3 plugin path precedence helpers.
//!
//! ## Loading flow
//!
//! ```text
//! Host::new(ctx)
//!   .load_plugin(path)?    // open cdylib + validate descriptor
//!   .load_plugin(path)?
//! host.validate_set()?     // cross-plugin coherence
//! host.init_all()?         // call init_fn on each
//! let diags = host.run(scope)?;  // runner once → lint fan-out → sort
//! host.shutdown_all()?     // call shutdown_fn in reverse order
//! ```
//!
//! ## Safety
//!
//! `viola-core` interacts with native dylibs through `libloading`.
//! Loading a dylib executes plugin code; the host trusts the plugin
//! source. All FFI boundaries threading raw pointers through the
//! `*mut c_void` host context are documented `# Safety` sections on
//! the relevant functions.
//!
//! ## v1 scope notes
//!
//! Several features named in the design doc are intentionally minimal
//! at v1 and ship as TODO follow-ups:
//!
//! - Per-lint config resolution (§8): resolved-config-to-bytes is
//!   stubbed empty; populated by #221 (viola.toml schema).
//! - NAM payload concrete shape (§9.2): the v1 contract crate reserves
//!   the version axis and an opaque payload carrier; concrete shapes
//!   land in a minor revision.
//! - File crawl + `RunScope` synthesis: `Host::run` consumes a
//!   [`viola_plugin_abi::RunScope`] from the caller; the existing
//!   `crawler` module produces TS-port-shape inputs and is retained
//!   for migration but not wired into the new loader path.
//! - `viola.toml` discovery and parsing: the existing `config` /
//!   `models` modules retain TS-port shape pending #221.

mod context;
mod diagnostics;
mod error;
mod host;
mod invocation;
mod lifecycle;
mod loader;
pub mod resolution;
mod validation;

// TS-port scaffolding. Retained for migration; not part of the v1
// host loader surface. Slated for replacement in #221 / #222.
// `pub(crate)` so it does not leak into the host crate's public API.
pub(crate) mod config;
pub(crate) mod crawler;
pub(crate) mod models;

pub use context::HostContext;
pub use diagnostics::{OwnedDiagnostic, aggregate_and_sort, sort_deterministic};
pub use error::{EmittedError, HostError, Result};
pub use host::Host;
pub use invocation::{find_capability, invoke_grammar, invoke_lint, invoke_runner};
pub use lifecycle::PluginInstance;
pub use loader::LoadedLibrary;
pub use validation::validate_descriptor;

// Re-exports plugin-facing types embedders typically use alongside
// the host: status codes, role bits, capability ids, vtable shapes.
pub use viola_plugin_abi::{
    AbiStatus, AbiVersion, BytesRef, CAP_GRAMMAR_EXTRACT,
    CAP_LINT_EVALUATE, CAP_RUNNER_EXECUTE_SCOPE, CapabilityEntry,
    CapabilityId, DESCRIPTOR_SYMBOL, Diagnostic, DiagnosticBatch,
    DiagnosticSeverity, FileEntry, GrammarExtractVtable, HOST_ABI_MAJOR,
    LintEvaluateVtable, NamPayload, NamVersion, PluginDescriptor,
    PluginError, Role, RoleSet, RunScope, RunSurface,
    RunnerExecuteScopeVtable, SourceLocation, SourceRange,
    StructuredError, VIOLA_ABI_VERSION,
};

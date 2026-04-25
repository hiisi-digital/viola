//! `HostContext`: opaque host-side state threaded through plugin
//! lifecycle and invocation calls as `*mut c_void`.
//!
//! Per `docs/PLUGIN-ABI-V1-DESIGN.md` §7.2, the host passes resolved
//! workspace context, run surface metadata, plugin-scoped configuration,
//! and version info on init. Plugins receive the host context as an
//! opaque pointer; v1 does not yet expose host-side accessor capabilities,
//! so the pointer is currently a stable identity that future capability
//! tables will dereference.
//!
//! The `HostContext` is owned by the [`crate::Host`] and outlives every
//! plugin instance loaded through it. Drop order is enforced: plugins
//! drop first (calling shutdown), then the context.

use std::path::PathBuf;

use viola_plugin_abi::{AbiVersion, CapabilityId, RunSurface, VIOLA_ABI_VERSION};

/// Resolved workspace and run-scope metadata the host carries across
/// plugin lifecycle calls.
pub struct HostContext {
    /// Absolute path to the workspace root.
    pub workspace_root: PathBuf,
    /// ABI version this host speaks. Always [`VIOLA_ABI_VERSION`] for v1.
    pub abi_version: AbiVersion,
    /// Capability ids the host advertises. Plugins whose
    /// `required_host_caps` contains an id absent from this list are
    /// rejected at load with [`viola_plugin_abi::PluginError::HostCapabilityMissing`].
    pub host_caps: Vec<CapabilityId>,
    /// Run surface (CLI / hook / CI / LSP / test). Maps onto NAM
    /// `run_context.surface`.
    pub surface: RunSurface,
    /// Whether this run is a CI invocation. Maps onto NAM
    /// `run_context.ci`. Stored as bool here, marshalled to `u8` at the
    /// FFI boundary in [`crate::invocation`].
    pub ci: bool,
}

impl HostContext {
    /// Construct a context with v1 defaults: empty host caps,
    /// `RunSurface::Cli`, `ci = false`.
    pub fn new(workspace_root: PathBuf) -> Self {
        Self {
            workspace_root,
            abi_version: VIOLA_ABI_VERSION,
            host_caps: Vec::new(),
            surface: RunSurface::Cli,
            ci: false,
        }
    }

    pub fn with_surface(mut self, surface: RunSurface) -> Self {
        self.surface = surface;
        self
    }

    pub fn with_ci(mut self, ci: bool) -> Self {
        self.ci = ci;
        self
    }

    pub fn with_host_caps(mut self, caps: Vec<CapabilityId>) -> Self {
        self.host_caps = caps;
        self
    }

    /// Whether the host advertises a given capability id.
    pub fn advertises(&self, cap: CapabilityId) -> bool {
        self.host_caps.iter().any(|c| c.0 == cap.0)
    }
}

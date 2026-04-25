//! Host-side error type wrapping `viola_plugin_abi::PluginError`.
//!
//! The contract crate exposes `PluginError` (a `#[repr(u32)]` category
//! enum) and `StructuredError` (the wire envelope per
//! `docs/PLUGIN-ABI-V1-DESIGN.md` §11). The host needs richer context
//! than the wire envelope alone — paths, plugin ids, originating
//! capability — so it wraps the category in `HostError` and emits a
//! structured envelope at the output boundary.
//!
//! `HostError` implements `std::error::Error` so callers can bubble it
//! through `anyhow` / `Result<_, HostError>` chains without losing the
//! category bit.

use std::path::PathBuf;

use viola_plugin_abi::PluginError;

/// Host error wrapping a `PluginError` category with operational context.
#[derive(Debug, Clone, thiserror::Error)]
#[error("{message} (category: {kind:?}, plugin_id: {plugin_id}, path: {path})")]
pub struct HostError {
    /// Wire-shape category for the failure.
    pub kind: PluginError,
    /// Plugin id the error originates from. May be empty for failures
    /// that occurred before the descriptor could be read.
    pub plugin_id: String,
    /// Filesystem path of the cdylib involved.
    pub path: String,
    /// Human-readable diagnostic message.
    pub message: String,
    /// Whether the host should treat the failure as transient.
    pub retryable: bool,
}

impl HostError {
    /// Build an error for a failure that occurred before the descriptor
    /// could be read (file open / symbol resolution / null pointer).
    pub fn pre_descriptor(
        kind: PluginError,
        path: &std::path::Path,
        message: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            plugin_id: String::new(),
            path: path.display().to_string(),
            message: message.into(),
            retryable: false,
        }
    }

    /// Build an error tied to a fully-resolved descriptor.
    pub fn from_descriptor(
        kind: PluginError,
        plugin_id: impl Into<String>,
        path: &std::path::Path,
        message: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            plugin_id: plugin_id.into(),
            path: path.display().to_string(),
            message: message.into(),
            retryable: false,
        }
    }

    /// Mark the error as transient (host policy may retry).
    pub fn retryable(mut self) -> Self {
        self.retryable = true;
        self
    }
}

/// Convenience alias for results in the host crate.
pub type Result<T> = std::result::Result<T, HostError>;

/// Convert a wire `StructuredError` byte payload into a host-side
/// emission shape. Used at the output boundary when the host needs to
/// serialize a host error for an external consumer (CLI, LSP, CI).
pub struct EmittedError {
    pub code: PluginError,
    pub message: String,
    pub plugin_id: String,
    pub path: PathBuf,
    pub retryable: bool,
}

impl From<&HostError> for EmittedError {
    fn from(e: &HostError) -> Self {
        Self {
            code: e.kind,
            message: e.message.clone(),
            plugin_id: e.plugin_id.clone(),
            path: PathBuf::from(&e.path),
            retryable: e.retryable,
        }
    }
}

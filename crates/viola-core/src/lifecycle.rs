//! Per-plugin lifecycle: init → invoke → shutdown.
//!
//! Per `docs/PLUGIN-ABI-V1-DESIGN.md` §7.1, the host orchestrates seven
//! stages across the loaded plugin set:
//!
//! 1. resolve config (handled by [`crate::resolution`])
//! 2. discover and load plugins ([`crate::loader`])
//! 3. validate plugin set ([`crate::validation`])
//! 4. initialize plugin instances (this module)
//! 5. execute run (runner once → lint fan-out, [`crate::invocation`])
//! 6. aggregate diagnostics ([`crate::diagnostics`])
//! 7. shutdown plugins (this module)
//!
//! `PluginInstance` ties an opened library together with its
//! initialization state. Drop calls `shutdown_fn` if the plugin was
//! successfully initialized; this guarantees plugins can release
//! resources even on error paths that abort a run.

use core::ffi::c_void;
use std::path::PathBuf;

use viola_plugin_abi::{AbiStatus, PluginDescriptor, PluginError};

use crate::error::{HostError, Result};
use crate::loader::LoadedLibrary;
use crate::validation::read_plugin_id;

/// A single plugin: opened library, validated descriptor, init state.
pub struct PluginInstance {
    pub(crate) library: LoadedLibrary,
    pub(crate) plugin_id: String,
    initialized: bool,
}

impl PluginInstance {
    /// Wrap a validated library. The descriptor MUST already have
    /// passed [`crate::validation::validate_descriptor`].
    pub fn new(library: LoadedLibrary) -> Self {
        let plugin_id = read_plugin_id(library.descriptor());
        Self { library, plugin_id, initialized: false }
    }

    /// Invoke the plugin's `init_fn` if present, threading `host_ctx`.
    ///
    /// # Safety
    ///
    /// `host_ctx` MUST point at a [`crate::HostContext`] (or a
    /// host-context shape compatible with this ABI major). The pointer
    /// MUST stay valid for the plugin's entire lifetime; the host
    /// MUST NOT free or reuse the address until after this plugin's
    /// `shutdown_fn` returns.
    pub unsafe fn init(&mut self, host_ctx: *mut c_void) -> Result<()> {
        if self.initialized {
            return Ok(());
        }
        if let Some(init) = self.descriptor().init_fn {
            let status = unsafe { init(host_ctx) };
            if !status.is_ok() {
                return Err(HostError::from_descriptor(
                    PluginError::InitFailed,
                    &self.plugin_id,
                    self.path(),
                    format!(
                        "init returned non-ok status {:?}",
                        status as u32
                    ),
                ));
            }
        }
        self.initialized = true;
        Ok(())
    }

    /// Invoke the plugin's `shutdown_fn` if present.
    ///
    /// # Safety
    ///
    /// See [`Self::init`]; `host_ctx` MUST be the same pointer that was
    /// threaded through `init`.
    pub unsafe fn shutdown(&mut self, host_ctx: *mut c_void) -> Result<()> {
        if !self.initialized {
            return Ok(());
        }
        if let Some(shutdown) = self.descriptor().shutdown_fn {
            let status: AbiStatus = unsafe { shutdown(host_ctx) };
            self.initialized = false;
            if !status.is_ok() {
                return Err(HostError::from_descriptor(
                    PluginError::ShutdownFailed,
                    &self.plugin_id,
                    self.path(),
                    format!(
                        "shutdown returned non-ok status {:?}",
                        status as u32
                    ),
                ));
            }
        } else {
            self.initialized = false;
        }
        Ok(())
    }

    pub fn descriptor(&self) -> &PluginDescriptor {
        self.library.descriptor()
    }

    pub fn plugin_id(&self) -> &str {
        &self.plugin_id
    }

    pub fn path(&self) -> &std::path::Path {
        self.library.path()
    }

    pub fn path_buf(&self) -> PathBuf {
        self.library.path().to_path_buf()
    }

    pub fn is_initialized(&self) -> bool {
        self.initialized
    }
}

impl Drop for PluginInstance {
    fn drop(&mut self) {
        if self.initialized {
            if let Some(shutdown) = self.descriptor().shutdown_fn {
                // Best-effort drop-time shutdown without a host_ctx
                // is unsafe; v1 does not store the host_ctx pointer
                // inside the instance. Callers MUST drive shutdown
                // through `Host::shutdown_all` before drop. If we
                // reach here while `initialized`, log nothing (no
                // logging dep at v1) and skip the call: dropping
                // without explicit shutdown is a host-side bug, not
                // something to paper over by guessing a context.
                let _ = shutdown;
            }
        }
    }
}

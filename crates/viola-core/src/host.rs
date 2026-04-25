//! Top-level [`Host`]: owns the [`HostContext`] and the loaded plugin set.
//!
//! `Host` orchestrates the seven lifecycle stages from
//! `docs/PLUGIN-ABI-V1-DESIGN.md` §7.1. It is the public entry point
//! for embedders (`viola-cli`, third-party Rust hosts) and abstracts
//! over the loader / validation / lifecycle / invocation modules.
//!
//! ## Lifetime safety
//!
//! [`Host::Drop`] calls [`Host::shutdown_all`] before any field-level
//! drop runs. While `shutdown_all` executes, both `context` and
//! `plugins` are still live, so every plugin's `shutdown_fn` receives
//! a valid `host_ctx` pointer.
//!
//! [`crate::PluginInstance::Drop`] intentionally skips its
//! `shutdown_fn` because it has no stored host_ctx pointer to thread
//! through; reaching field drop with `initialized == true` is a
//! host-side bug that drop cannot paper over by guessing a context.
//! Embedders MUST drive shutdown through [`Host::shutdown_all`] (the
//! `Host::Drop` path covers normal teardown automatically).

use core::ffi::c_void;
use std::path::Path;

use viola_plugin_abi::{
    CAP_LINT_EVALUATE, DiagnosticBatch, NamPayload, PluginError, Role,
    RunScope,
};

use crate::context::HostContext;
use crate::diagnostics::{OwnedDiagnostic, aggregate_and_sort};
use crate::error::{HostError, Result};
use crate::invocation::{invoke_lint, invoke_runner};
use crate::lifecycle::PluginInstance;
use crate::loader::LoadedLibrary;
use crate::validation::validate_descriptor;

/// Host runtime: owns the host context and the validated plugin set.
pub struct Host {
    context: Box<HostContext>,
    plugins: Vec<PluginInstance>,
}

impl Host {
    /// Create a host bound to a [`HostContext`].
    pub fn new(context: HostContext) -> Self {
        Self { context: Box::new(context), plugins: Vec::new() }
    }

    /// Borrow the host context.
    pub fn context(&self) -> &HostContext {
        &self.context
    }

    /// Mutable borrow of the host context.
    pub fn context_mut(&mut self) -> &mut HostContext {
        &mut self.context
    }

    /// Open a cdylib at `path`, validate the descriptor, and add the
    /// plugin to the set. Stage 2 + 3 of the §7.1 lifecycle.
    ///
    /// # Safety
    ///
    /// Loading a dynamic library executes plugin code; callers MUST
    /// trust the source. See [`LoadedLibrary::open`].
    pub unsafe fn load_plugin(&mut self, path: &Path) -> Result<&PluginInstance> {
        let library = unsafe { LoadedLibrary::open(path)? };
        validate_descriptor(library.descriptor(), path, &self.context)?;
        let instance = PluginInstance::new(library);
        self.plugins.push(instance);
        Ok(self.plugins.last().expect("just pushed"))
    }

    /// Return all loaded plugins as a slice.
    pub fn plugins(&self) -> &[PluginInstance] {
        &self.plugins
    }

    /// Run cross-plugin validation that requires the full set in hand.
    ///
    /// v1 currently checks for plugin id collisions. Future revisions
    /// can extend this with role-set coherence (single runner, no
    /// duplicated grammars per language, etc.). Stage 3 of §7.1.
    pub fn validate_set(&self) -> Result<()> {
        for (i, a) in self.plugins.iter().enumerate() {
            for b in &self.plugins[i + 1..] {
                if a.plugin_id() == b.plugin_id() {
                    return Err(HostError::from_descriptor(
                        PluginError::Internal,
                        a.plugin_id(),
                        a.path(),
                        format!(
                            "duplicate plugin id {:?} (also at {:?})",
                            a.plugin_id(),
                            b.path(),
                        ),
                    ));
                }
            }
        }
        Ok(())
    }

    /// Initialize every loaded plugin. Stage 4 of §7.1.
    pub fn init_all(&mut self) -> Result<()> {
        let ctx_ptr = self.context_ptr();
        for plugin in &mut self.plugins {
            unsafe { plugin.init(ctx_ptr)? };
        }
        Ok(())
    }

    /// Drive the run pass: runner once → lint fan-out over the single
    /// NAM snapshot. Stage 5 of §7.1.
    ///
    /// Caller supplies the [`RunScope`] (file list, surface, ci flag,
    /// workspace root). Returns the aggregated, deterministic-sorted
    /// diagnostic list per §10.
    pub fn run(&mut self, scope: &RunScope) -> Result<Vec<OwnedDiagnostic>> {
        let ctx_ptr = self.context_ptr();
        let nam = self.run_runner(scope, ctx_ptr)?;
        let diags = self.run_lints(&nam, ctx_ptr)?;
        Ok(diags)
    }

    fn run_runner(
        &mut self,
        scope: &RunScope,
        ctx_ptr: *mut c_void,
    ) -> Result<NamPayload> {
        let runner = self
            .plugins
            .iter()
            .find(|p| p.descriptor().roles.contains(Role::Runner));

        if let Some(runner) = runner {
            unsafe {
                invoke_runner(
                    runner.descriptor(),
                    ctx_ptr,
                    scope,
                    runner.plugin_id(),
                    runner.path(),
                )
            }
        } else {
            // No runner role declared in the plugin set. v1 still
            // permits lint-only runs against an externally-supplied
            // NAM snapshot, but Host::run is the runner-driven path.
            // Synthesize an empty NAM so lints can run against it; a
            // future revision exposes a separate entrypoint that
            // accepts a host-supplied NAM directly.
            Ok(NamPayload {
                version: viola_plugin_abi::NamVersion(
                    viola_plugin_abi::VersionTriple::new(1, 0, 0),
                ),
                data: core::ptr::null(),
                len: 0,
            })
        }
    }

    fn run_lints(
        &mut self,
        nam: &NamPayload,
        ctx_ptr: *mut c_void,
    ) -> Result<Vec<OwnedDiagnostic>> {
        let mut batches: Vec<DiagnosticBatch> = Vec::new();
        for plugin in &self.plugins {
            if !plugin.descriptor().roles.contains(Role::Lint) {
                continue;
            }
            // v1: empty lint config. Resolution into per-lint config
            // arrives with #221 (viola.toml schema).
            let empty_config: &[u8] = &[];
            let nam_ptr = nam as *const NamPayload;
            let batch = unsafe {
                invoke_lint(
                    plugin.descriptor(),
                    ctx_ptr,
                    nam_ptr,
                    empty_config,
                    plugin.plugin_id(),
                    plugin.path(),
                )?
            };
            batches.push(batch);
            // Suppress the unused-cap warning on the path that doesn't
            // dispatch the cap directly.
            let _ = CAP_LINT_EVALUATE;
        }
        Ok(unsafe { aggregate_and_sort(&batches) })
    }

    /// Invoke `shutdown_fn` on every initialized plugin in reverse
    /// load order. Stage 7 of §7.1.
    pub fn shutdown_all(&mut self) -> Result<()> {
        let ctx_ptr = self.context_ptr();
        let mut first_err: Option<HostError> = None;
        for plugin in self.plugins.iter_mut().rev() {
            if let Err(e) = unsafe { plugin.shutdown(ctx_ptr) } {
                if first_err.is_none() {
                    first_err = Some(e);
                }
            }
        }
        match first_err {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    fn context_ptr(&mut self) -> *mut c_void {
        (&mut *self.context) as *mut HostContext as *mut c_void
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        let _ = self.shutdown_all();
    }
}

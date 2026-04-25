//! Open a cdylib, resolve the v1 descriptor symbol, read the descriptor.
//!
//! Per `docs/PLUGIN-ABI-V1-DESIGN.md` §4.1 / §4.2, plugin discovery is
//! pull-based: the host opens the library, resolves
//! [`viola_plugin_abi::DESCRIPTOR_SYMBOL`] (`__viola_plugin_descriptor`),
//! calls it, and reads the descriptor it returns. There is no linker
//! constructor magic.
//!
//! `LoadedLibrary` owns the `libloading::Library` so the dylib stays
//! mapped for the lifetime of the host's reference. Dropping it
//! `dlclose`s. Validation runs after the descriptor has been read; any
//! validation failure leaves the library loaded (so the descriptor's
//! plugin-owned static buffers stay valid for diagnostic emission)
//! until the loader explicitly drops it.

use std::path::{Path, PathBuf};

use libloading::{Library, Symbol};
use viola_plugin_abi::{DESCRIPTOR_SYMBOL, PluginDescriptor, PluginError};

use crate::error::{HostError, Result};

/// Plugin descriptor entrypoint signature: `fn() -> *const PluginDescriptor`.
type DescriptorFn = unsafe extern "C" fn() -> *const PluginDescriptor;

/// A loaded cdylib plus a verified descriptor pointer.
///
/// The descriptor pointer references plugin-owned static memory that is
/// stable for the library's loaded lifetime. The host reads through this
/// pointer; it never frees what it points at.
pub struct LoadedLibrary {
    path: PathBuf,
    /// Held only to keep the dylib mapped. Dropping the field unloads it.
    _library: Library,
    descriptor: *const PluginDescriptor,
}

// SAFETY: the underlying `libloading::Library` is `Send + Sync`. The
// descriptor pointer addresses plugin-owned static memory immutable for
// the library's loaded lifetime, and the host only reads through it.
unsafe impl Send for LoadedLibrary {}
unsafe impl Sync for LoadedLibrary {}

impl LoadedLibrary {
    /// Open a cdylib at `path`, resolve the descriptor symbol, call it,
    /// and capture the descriptor pointer.
    ///
    /// # Safety
    ///
    /// Loading a dynamic library executes arbitrary code from the
    /// plugin (loader-level constructors, if any). Callers MUST trust
    /// the plugin source. The plugin author MUST guarantee the
    /// descriptor pointer references static memory stable for the
    /// library's loaded lifetime.
    pub unsafe fn open(path: &Path) -> Result<Self> {
        let library = unsafe { Library::new(path) }.map_err(|e| {
            HostError::pre_descriptor(
                PluginError::DescriptorMissing,
                path,
                format!("failed to open cdylib: {e}"),
            )
        })?;

        let symbol_bytes = DESCRIPTOR_SYMBOL.to_bytes_with_nul();
        let entry: Symbol<DescriptorFn> = unsafe {
            library.get(symbol_bytes).map_err(|e| {
                HostError::pre_descriptor(
                    PluginError::DescriptorMissing,
                    path,
                    format!(
                        "missing exported symbol `{}`: {e}",
                        DESCRIPTOR_SYMBOL.to_string_lossy()
                    ),
                )
            })?
        };

        let descriptor: *const PluginDescriptor = unsafe { entry() };
        if descriptor.is_null() {
            return Err(HostError::pre_descriptor(
                PluginError::DescriptorNull,
                path,
                "descriptor entrypoint returned null",
            ));
        }

        Ok(Self {
            path: path.to_path_buf(),
            _library: library,
            descriptor,
        })
    }

    /// Path the cdylib was opened from.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Borrow the descriptor.
    ///
    /// # Safety
    ///
    /// Plugin-owned static memory; valid for the library's loaded
    /// lifetime. The reference is dropped before the next call into
    /// the plugin.
    pub fn descriptor(&self) -> &PluginDescriptor {
        unsafe { &*self.descriptor }
    }

    /// Raw descriptor pointer (used by FFI invocation paths).
    pub fn descriptor_ptr(&self) -> *const PluginDescriptor {
        self.descriptor
    }
}

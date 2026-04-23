//! Viola Core (Host)
//!
//! This crate contains the host loader and execution engine for Viola.
//! It loads plugins (compiled as cdylibs) and orchestrates runners, grammars, and lints.

// FIXME: The dynamic loading abstractions and lifecycle management here are temporary shams.
// They are placeholders representing the eventual ABI interaction and will be replaced
// by robust cross-platform implementations from the `hilavitkutin-extensions`
// and `hilavitkutin-plugins` crates once those are published.

pub mod crawler;
pub mod models;

use std::path::Path;

/// A loaded plugin instance.
pub struct LoadedPlugin {
    // FIXME: In reality, this would hold the libloading::Library or similar handle
    // from `hilavitkutin-extensions` to keep the cdylib loaded in memory,
    // plus the extracted operations table.
    pub name: String,
    pub version: String,
}

impl Drop for LoadedPlugin {
    fn drop(&mut self) {
        // FIXME: Here we would call the shutdown hook on the plugin descriptor
        // before the library handle is dropped:
        // (descriptor.shutdown)();
    }
}

/// The core host environment that discovers, loads, and manages plugins.
pub struct PluginLoader {
    plugins: Vec<LoadedPlugin>,
}

impl Default for PluginLoader {
    fn default() -> Self {
        Self::new()
    }
}

impl PluginLoader {
    pub fn new() -> Self {
        Self {
            plugins: Vec::new(),
        }
    }

    /// Loads a plugin from the specified shared library path.
    ///
    /// // FIXME: Replace this sham with actual `libloading`/dlopen usage
    /// // bridging to the descriptor defined in `viola-plugin-abi`, orchestrated
    /// // by `hilavitkutin-plugins`.
    pub fn load_plugin<P: AsRef<Path>>(&mut self, path: P) -> Result<(), String> {
        let path = path.as_ref();

        // --- Intended workflow once hilavitkutin-extensions is ready ---
        // let lib = hilavitkutin_extensions::Library::load(path)?;
        //
        // // Explicit pull-based discovery (no inventory magic)
        // let descriptor: &viola_plugin_abi::PluginDescriptor =
        //     lib.get_symbol(b"viola_plugin_v1_descriptor\0")?;
        //
        // // Lifecycle: Init
        // let init_res = (descriptor.init)();
        // if init_res != viola_plugin_abi::ABI_SUCCESS {
        //     return Err(format!("Plugin {} initialization failed", descriptor.name));
        // }
        //
        // // Store the loaded plugin and capabilities
        // ...
        // ----------------------------------------------------------------

        // Mocking a successful load for the sham implementation
        let mock_name = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        self.plugins.push(LoadedPlugin {
            name: mock_name,
            version: "0.1.0".to_string(), // mocked
        });

        Ok(())
    }

    /// Returns a slice of the currently loaded plugins.
    pub fn loaded_plugins(&self) -> &[LoadedPlugin] {
        &self.plugins
    }

    /// Executes the loaded plugins over a given context.
    ///
    /// // FIXME: This will be fleshed out to execute the specific roles
    /// // (runners -> NAM -> lints fan-out).
    pub fn run_pipeline(&self) -> Result<(), String> {
        // Iterate and invoke
        for plugin in &self.plugins {
            // let ops = plugin.operations();
            // if let Some(invoke) = ops.invoke {
            //     let res = invoke();
            //     if res != viola_plugin_abi::ABI_SUCCESS { ... }
            // }
            let _ = plugin;
        }

        Ok(())
    }
}

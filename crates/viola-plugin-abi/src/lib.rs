//! Viola Plugin ABI v1
//!
//! This crate defines the C-ABI boundary for Viola plugins (runners, grammars, lints).
//!
//! // FIXME: This ABI boundary is an approximation and will be finalized and synced
//! // with the hilavitkutin-extensions and hilavitkutin-plugins crates once they are ready.

use std::os::raw::c_char;

/// A result code returned by ABI functions.
/// 0 indicates success, non-zero indicates an error.
pub type AbiResult = i32;

pub const ABI_SUCCESS: AbiResult = 0;
pub const ABI_ERROR: AbiResult = 1;

/// The operations table for a plugin.
/// This is an approximation of what operations a plugin might expose.
#[repr(C)]
pub struct PluginOperations {
    /// Example function: invoke the plugin's primary role.
    /// This will likely be broken down into runner, grammar, and lint specifics later.
    pub invoke: Option<extern "C" fn() -> AbiResult>,
}

/// The root descriptor exported by a Viola plugin.
///
/// Plugins must export a symbol (e.g., `viola_plugin_v1_descriptor`) of this type
/// for the host to pull and discover its capabilities.
#[repr(C)]
pub struct PluginDescriptor {
    /// The name of the plugin (null-terminated C string).
    pub name: *const c_char,

    /// The version of the plugin (null-terminated C string).
    pub version: *const c_char,

    /// Initialize the plugin. Called once per load.
    pub init: extern "C" fn() -> AbiResult,

    /// Shutdown the plugin. Called before unload.
    pub shutdown: extern "C" fn() -> AbiResult,

    /// The operations provided by this plugin.
    pub ops: PluginOperations,
}

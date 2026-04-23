//! Viola Deno Bridge Plugin
//!
//! This crate implements the `viola-plugin-abi` to act as a bridge between the
//! Rust-based `viola-core` host and TypeScript-based plugins running in Deno.

use std::os::raw::c_char;
use viola_plugin_abi::{ABI_SUCCESS, AbiResult, PluginDescriptor, PluginOperations};

/// Initialize the Deno bridge.
///
/// // FIXME: This will eventually spin up the embedded Deno runtime or connect
/// // to a Deno sidecar process to evaluate TypeScript plugins.
extern "C" fn bridge_init() -> AbiResult {
    // In a real implementation, we would bootstrap the JS environment here.
    ABI_SUCCESS
}

/// Shutdown the Deno bridge.
///
/// // FIXME: Clean up Deno runtime resources.
extern "C" fn bridge_shutdown() -> AbiResult {
    ABI_SUCCESS
}

/// Invoke the Deno bridge operations.
///
/// // FIXME: This is a placeholder for the actual operation dispatch table
/// // (e.g., executing TS lints, grammars, runners over the NAM snapshot).
extern "C" fn bridge_invoke() -> AbiResult {
    ABI_SUCCESS
}

/// The exported plugin descriptor.
///
/// The Viola host discovers this symbol (`viola_plugin_v1_descriptor`) via `dlsym`
/// to load the bridge plugin and query its capabilities.
#[no_mangle]
pub static viola_plugin_v1_descriptor: PluginDescriptor = PluginDescriptor {
    name: b"viola-bridge-deno\0".as_ptr() as *const c_char,
    version: b"0.1.0\0".as_ptr() as *const c_char,
    init: bridge_init,
    shutdown: bridge_shutdown,
    ops: PluginOperations {
        invoke: Some(bridge_invoke),
    },
};

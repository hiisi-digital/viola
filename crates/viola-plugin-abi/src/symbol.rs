//! Well-known exported symbol name.

use core::ffi::CStr;

/// Symbol every viola plugin `cdylib` MUST export.
///
/// The exported symbol resolves to
/// `unsafe extern "C" fn() -> *const PluginDescriptor`. The host opens
/// the library, looks up this symbol, calls the resulting function
/// pointer, and reads the descriptor it returns.
///
/// Typed as `&CStr` so callers see the nul-terminated-C-string intent;
/// linking primitives that take `&[u8]` receive
/// `DESCRIPTOR_SYMBOL.to_bytes_with_nul()` at the call site.
//
// SAFETY: the byte literal contains a single trailing nul and no
// interior nul. `from_bytes_with_nul_unchecked` is const since 1.59.
pub const DESCRIPTOR_SYMBOL: &CStr = unsafe {
    CStr::from_bytes_with_nul_unchecked(b"__viola_plugin_descriptor\0")
};

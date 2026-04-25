//! Configuration surface that crosses into the plugin at init.
//!
//! Plugins declare a config-schema reference statically; the host
//! resolves the consumer's TOML (or TS-builder-emitted equivalent)
//! against that schema and passes the resolved bytes plus a
//! [`RunSurface`] tag at init time.
//!
//! The config schema reference is opaque at the ABI boundary: it is a
//! `(ptr, len)` UTF-8 slice naming either a path inside the plugin's
//! distribution or an inline JSON Schema document. Schema resolution
//! happens host-side before init.

/// Reference to a plugin's config schema.
///
/// A UTF-8 string the host interprets as a schema locator. Common
/// shapes:
///
/// - `"schemas/grammar-ts.schema.json"`: relative path inside the
///   plugin distribution.
/// - `"inline:{...}"`: inline JSON Schema document.
///
/// Resolution policy is host-side; the contract crate stores only the
/// pointer and length.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ConfigSchemaRef {
    pub data: *const u8,
    pub len: usize,
}

// SAFETY: pointer into plugin-owned static memory.
unsafe impl Send for ConfigSchemaRef {}
unsafe impl Sync for ConfigSchemaRef {}

/// Where the host invocation originated. Forwarded to plugins at init
/// so they can adapt diagnostics or telemetry. Maps onto NAM's
/// `run_context.surface` field.
///
/// `#[repr(u32)]` so it transits as a plain word. The host MAY supply
/// surface values not enumerated here (extension space reserved above
/// 0xFF00); plugins SHOULD treat unknown values as `Other`.
#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum RunSurface {
    Cli = 0,
    Hook = 1,
    Ci = 2,
    Lsp = 3,
    Test = 4,
    Other = 0xFFFF,
}

//! Configuration surface that crosses into the plugin at init.
//!
//! Plugins declare a config-schema reference statically; the host
//! resolves the consumer's TOML (or TS-builder-emitted equivalent)
//! against that schema and passes the resolved bytes plus a
//! [`RunSurface`] tag at init time.
//!
//! The config schema reference is opaque at the ABI boundary: it is a
//! UTF-8 string the host interprets as a schema locator, carried via
//! [`crate::BytesRef`].

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

/// Reference to a plugin's config schema.
///
/// A UTF-8 string the host interprets as a schema locator. Common
/// shapes: `"schemas/grammar-ts.schema.json"` (relative path inside
/// the plugin distribution), `"inline:{...}"` (inline JSON Schema
/// document). Resolution policy is host-side.
///
/// Type alias over [`crate::BytesRef`]; the wire layout is identical.
pub type ConfigSchemaRef = crate::bytes_ref::BytesRef;

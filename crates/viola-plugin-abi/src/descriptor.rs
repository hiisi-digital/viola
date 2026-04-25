//! Top-level [`PluginDescriptor`] read by the host at load time.
//!
//! The descriptor is the sole contract between plugin and host. The
//! plugin exposes one symbol ([`crate::DESCRIPTOR_SYMBOL`]) returning
//! a pointer to a `#[repr(C)]` `PluginDescriptor`; lifecycle,
//! capability dispatch, and version gating all derive from the
//! descriptor's fields. There is no other discovery channel.

use core::ffi::c_void;

use crate::bytes_ref::BytesRef;
use crate::capability::CapabilityEntry;
use crate::config::ConfigSchemaRef;
use crate::error::AbiStatus;
use crate::nam::NamVersion;
use crate::role::RoleSet;
use crate::version::{ManifestVersion, PluginVersion};

/// Static identity record for the plugin.
///
/// `plugin_id` follows the `org.viola.<role>.<short>` convention but
/// the host treats it as opaque; equality and ordering are
/// byte-comparison.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct PluginIdentity {
    pub plugin_id: BytesRef,
    pub display_name: BytesRef,
    pub plugin_version: PluginVersion,
}

/// Top-level plugin descriptor.
///
/// Layout is `#[repr(C)]` and stable for a given [`crate::AbiVersion`]
/// major. Adding fields requires bumping the major.
///
/// Field groups:
///
/// 1. Version and identity: `abi_version`, `manifest_version`,
///    `identity`.
/// 2. Role and capability surface: `roles`, `capabilities_*`.
/// 3. Compatibility claims: `nam_produces`, `nam_consumes`,
///    `required_host_caps_*`.
/// 4. Configuration: `config_schema`.
/// 5. Lifecycle: `init_fn`, `shutdown_fn`.
///
/// `init_fn` and `shutdown_fn` are `Option`-wrapped to allow a null
/// representation across the FFI boundary; absent lifecycle handlers
/// are valid for plugins with no init/shutdown work.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct PluginDescriptor {
    pub abi_version: u32,
    pub manifest_version: ManifestVersion,

    pub identity: PluginIdentity,

    pub roles: RoleSet,

    pub capabilities_ptr: *const CapabilityEntry,
    pub capabilities_len: usize,

    /// NAM version the plugin produces. Meaningful only when `roles`
    /// includes the runner bit; otherwise zero.
    pub nam_produces: NamVersion,
    /// NAM version the plugin consumes. Meaningful only when `roles`
    /// includes the lint bit; otherwise zero.
    pub nam_consumes: NamVersion,

    /// Host capabilities this plugin requires; the host rejects load
    /// when any are absent.
    pub required_host_caps_ptr: *const crate::capability::CapabilityId,
    pub required_host_caps_len: usize,

    pub config_schema: ConfigSchemaRef,

    pub init_fn: Option<
        unsafe extern "C" fn(host_ctx: *mut c_void) -> AbiStatus,
    >,
    pub shutdown_fn: Option<
        unsafe extern "C" fn(host_ctx: *mut c_void) -> AbiStatus,
    >,
}

// SAFETY: PluginDescriptor is a POD payload with raw pointers into
// plugin-owned static memory. The host reads only; pointers are stable
// for the library's loaded lifetime.
unsafe impl Send for PluginDescriptor {}
unsafe impl Sync for PluginDescriptor {}

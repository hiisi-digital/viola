//! NAM (Normalized Analysis Model) payload carrier.
//!
//! Per `docs/PLUGIN-ABI-V1-DESIGN.md` §9, NAM is the single stable
//! structure consumed by all lints. The wire shape of the payload is
//! deferred to a minor revision; v1 reserves the version axis and an
//! opaque carrier so the runtime contract is fixed even before the
//! concrete schema is.

use core::ffi::c_void;

/// Three-component NAM model version with a reserved padding slot.
#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct NamVersion {
    /// lint:allow(arvo-types-only, no-bare-numeric, no-public-raw-field) tracked: #207
    pub major: u16,
    /// lint:allow(arvo-types-only, no-bare-numeric, no-public-raw-field) tracked: #207
    pub minor: u16,
    /// lint:allow(arvo-types-only, no-bare-numeric, no-public-raw-field) tracked: #207
    pub patch: u16,
    /// lint:allow(arvo-types-only, no-bare-numeric, no-public-raw-field) tracked: #207
    pub _reserved: u16,
}

impl NamVersion {
    pub const fn new(major: u16, minor: u16, patch: u16) -> Self {
        Self { major, minor, patch, _reserved: 0 }
    }
}

/// Opaque payload carrier for a NAM snapshot.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct NamPayload {
    pub version: NamVersion,
    pub data: *const c_void,
    pub len: arvo::USize,
}

// SAFETY: data references plugin-owned memory immutable for the
// invocation's duration. Host reads only.
unsafe impl Send for NamPayload {}
unsafe impl Sync for NamPayload {}

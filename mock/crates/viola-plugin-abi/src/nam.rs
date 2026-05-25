//! NAM (Normalized Analysis Model) payload carrier.
//!
//! Per `docs/PLUGIN-ABI-V1-DESIGN.md` §9, NAM is the single stable
//! structure consumed by all lints. The wire shape of the payload is
//! versioned via [`NamVersion`]; the v1 carrier ([`NamPayload`]) reserves
//! the version axis and an opaque `data` pointer so the runtime contract
//! is fixed independently of the concrete schema.
//!
//! # NAM v1.0.0 wire schema
//!
//! [`NamVersion::V1_0_0`] selects the per-file entry schema. The
//! `data` pointer points at a contiguous slice of [`NamFileEntry`]
//! records; `len / size_of::<NamFileEntry>()` gives the entry count.
//! Plugin authors use the [`nam_file_entries`] accessor to walk the
//! slice safely; the accessor returns `None` if the carrier's version
//! is not v1.0.0.

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

    /// Selects the v1.0.0 wire schema documented at the module head:
    /// `NamPayload::data` points at a slice of [`NamFileEntry`].
    pub const V1_0_0: Self = Self::new(1, 0, 0);
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

/// Per-file entry under the NAM v1.0.0 wire schema.
///
/// Field ordering is alphabetical-by-meaning: `path` identifies the
/// file, `language` tags its source language, `source` carries the
/// UTF-8 source bytes. All three fields are `#[repr(C)]` or
/// `#[repr(transparent)]` types, so the struct layout is stable
/// across compilation units.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct NamFileEntry {
    pub path: crate::BytesRef,
    pub language: arvo::USize,
    pub source: crate::BytesRef,
}

// SAFETY: NamFileEntry's pointers reference plugin-owned static memory
// stable for the loaded library's lifetime. Host reads only.
unsafe impl Send for NamFileEntry {}
unsafe impl Sync for NamFileEntry {}

/// Walk the v1.0.0 file-entry slice behind a [`NamPayload`].
///
/// Returns `None` if the carrier's version is not [`NamVersion::V1_0_0`].
/// Returns `Some(&[])` if the slice is empty but the version matches.
///
/// # Safety
///
/// The caller upholds the contract that `nam` is a valid pointer to a
/// `NamPayload` whose `data` and `len` describe a contiguous slice of
/// `NamFileEntry` records owned by the plugin and immutable for the
/// duration of the borrow.
pub unsafe fn nam_file_entries<'a>(nam: *const NamPayload) -> Option<&'a [NamFileEntry]> {
    if nam.is_null() {
        return None;
    }
    // SAFETY: caller upholds nam non-null + valid for read.
    let payload = unsafe { &*nam };
    if payload.version != NamVersion::V1_0_0 {
        return None;
    }
    if payload.data.is_null() {
        return Some(&[]);
    }
    let entry_size = core::mem::size_of::<NamFileEntry>();
    let count = payload.len.0 / entry_size;
    // SAFETY: caller upholds (data, len) describing a contiguous slice
    // of NamFileEntry records valid for the borrow's lifetime.
    let slice = unsafe {
        core::slice::from_raw_parts(payload.data as *const NamFileEntry, count)
    };
    Some(slice)
}

//! NAM (Normalized Analysis Model) version markers and wire payload.
//!
//! NAM's full schema is normative in
//! `docs/PLUGIN-ABI-V1-DESIGN.md` section 9. v1 of the plugin ABI does
//! not pin a `#[repr(C)]` shape for the model itself; the runner emits
//! and lints consume it through an opaque payload whose interpretation
//! is gated by a [`NamVersion`].
//!
//! Concrete NAM serialization (CBOR, FlatBuffers, custom packed
//! layout) lands in a follow-up round. The contract crate reserves
//! only the version axis and the carrier shape so that follow-up does
//! not bump the ABI major.

use core::ffi::c_void;

use crate::version::VersionTriple;

/// NAM schema version a plugin produces (runner) or consumes (lint).
///
/// `#[repr(transparent)]` over [`VersionTriple`]. Major mismatch
/// between runner-produced NAM and a lint's consumed NAM is a hard
/// load-time rejection.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct NamVersion(pub VersionTriple);

impl NamVersion {
    pub const fn new(major: u16, minor: u16, patch: u16) -> Self {
        Self(VersionTriple::new(major, minor, patch))
    }
}

/// Opaque NAM payload crossing the runner -> host -> lint path.
///
/// `data` points at a plugin-or-host-owned buffer; `len` is the byte
/// length; `version` declares which schema to apply when interpreting
/// `data`. Ownership and lifetime are governed by the producer; the
/// host MUST NOT free.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct NamPayload {
    pub version: NamVersion,
    pub data: *const c_void,
    pub len: usize,
}

// SAFETY: NamPayload carries a raw pointer into producer-owned memory
// stable for the duration of the run pass. The host reads only.
unsafe impl Send for NamPayload {}
unsafe impl Sync for NamPayload {}

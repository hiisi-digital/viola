//! Stable capability identifiers and the capability table entry shape.
//!
//! A capability is an identifier the plugin advertises ("I can do X")
//! paired with a thin extension-owned vtable pointer the host calls.
//! The vtable layout behind [`CapabilityEntry::vtable_ptr`] is specific
//! to the capability id; this crate treats it as opaque.
//!
//! Capability ids are computed at compile time as FNV-1a 64 over the
//! ASCII capability name. The const-fn hash means well-known ids are
//! constant-folded at the call site with no runtime cost.

use core::ffi::c_void;

/// Stable capability identifier. Compile-time FNV-1a 64 of the ASCII name.
///
/// `#[repr(transparent)]` over `u64` so wire representation matches a
/// plain `u64` across platforms.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct CapabilityId(pub u64);

impl CapabilityId {
    /// Compute the capability id from an ASCII name at compile time.
    ///
    /// FNV-1a 64. Constant-folded at the call site. Identical
    /// algorithm to the hash used in `hilavitkutin-extensions`, so
    /// names hashed by either crate compare equal when the inputs are
    /// equal byte sequences.
    pub const fn from_name(name: &str) -> Self {
        const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
        const FNV_PRIME: u64 = 0x100000001b3;
        let bytes = name.as_bytes();
        let mut hash: u64 = FNV_OFFSET_BASIS;
        let mut i = 0;
        while i < bytes.len() {
            hash ^= bytes[i] as u64;
            hash = hash.wrapping_mul(FNV_PRIME);
            i += 1;
        }
        Self(hash)
    }
}

/// Single capability entry in a plugin descriptor's capability table.
///
/// `vtable_ptr` is an extension-owned pointer to a `#[repr(C)]` table
/// of function pointers whose layout matches the capability id's
/// contract. The host treats it as opaque until it knows the id.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct CapabilityEntry {
    pub id: CapabilityId,
    pub vtable_ptr: *const c_void,
}

// SAFETY: CapabilityEntry carries a raw pointer that is plugin-owned
// and stable for the loaded library's lifetime. Send + Sync are sound
// because the host never mutates through the pointer.
unsafe impl Send for CapabilityEntry {}
unsafe impl Sync for CapabilityEntry {}

/// Runner role's primary capability: execute the configured run scope
/// once and produce a NAM snapshot.
///
/// vtable contract: see runner role documentation in
/// `docs/PLUGIN-ABI-V1-DESIGN.md` section 7.3.
pub const CAP_RUNNER_EXECUTE_SCOPE: CapabilityId =
    CapabilityId::from_name("viola.runner.execute_scope.v1");

/// Grammar role's primary capability: extract grammar contributions
/// for a document, runner-mediated.
pub const CAP_GRAMMAR_EXTRACT: CapabilityId =
    CapabilityId::from_name("viola.grammar.extract.v1");

/// Lint role's primary capability: evaluate lints against a NAM
/// snapshot and emit a diagnostic batch.
pub const CAP_LINT_EVALUATE: CapabilityId =
    CapabilityId::from_name("viola.lint.evaluate.v1");

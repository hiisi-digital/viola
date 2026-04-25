//! Shared `(ptr, len)` carrier for UTF-8 / byte slices crossing the
//! C-ABI boundary.
//!
//! Every variable-length string or byte buffer in this crate's
//! descriptor and diagnostic shapes is plugin-or-host-owned static
//! memory whose lifetime equals the producer. The host reads only.
//!
//! Replacing duplicated `(ptr_field, len_field)` pairs with a single
//! `BytesRef` keeps the wire layout identical (two adjacent words)
//! while making the contract surface read consistently.

/// `(ptr, len)` carrier for a byte slice that crosses the C-ABI boundary.
///
/// `data` points into producer-owned static memory; `len` is the byte
/// length. The consumer reads only and MUST NOT free.
///
/// `#[repr(C)]` so the wire layout is two adjacent words (pointer,
/// usize) regardless of how the type is composed into a parent struct.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct BytesRef {
    pub data: *const u8,
    pub len: usize,
}

impl BytesRef {
    /// Empty `BytesRef` (null pointer, zero length).
    ///
    /// Valid when the slot is optional and the producer wants to
    /// signal absence.
    pub const EMPTY: Self = Self { data: core::ptr::null(), len: 0 };

    /// Whether this reference signals absence (`len == 0`). Note that
    /// a zero-length reference with a non-null pointer is also
    /// considered empty for consumer purposes.
    pub const fn is_empty(self) -> bool {
        self.len == 0
    }
}

// SAFETY: BytesRef carries a raw pointer into producer-owned memory.
// Send + Sync are sound for the host's read-only use.
unsafe impl Send for BytesRef {}
unsafe impl Sync for BytesRef {}

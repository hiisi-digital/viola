//! NAM (Normalized Analysis Model) payload carrier.
//!
//! Per `docs/PLUGIN-ABI-V1-DESIGN.md` §9, NAM is the single stable
//! structure consumed by all lints. The wire shape of the payload is
//! versioned via [`NamVersion`]; the v1 carrier ([`NamPayload`]) reserves
//! the version axis and an opaque `data` pointer so the runtime contract
//! is fixed independently of the concrete schema.
//!
//! # NAM v1.x wire schema
//!
//! The `data` pointer points at a contiguous slice of [`NamFileEntry`]
//! records; `len / size_of::<NamFileEntry>()` gives the entry count.
//! Plugin authors use the [`nam_file_entries`] accessor to walk the
//! slice safely; it accepts any v1.x carrier (the entry layout is
//! shared across the line) and returns `None` if the carrier's major
//! version is not `1`.
//!
//! [`NamVersion::V1_1_0`] adds a per-file serialised AST: each
//! [`NamFileEntry`] carries a [`NamNode`] array via its `nodes`
//! carrier, walked with [`nam_file_nodes`]. A v1.0.0 producer leaves
//! `nodes` empty.

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

    /// Selects the v1.1.0 wire schema: the v1.0.0 file-entry slice plus a
    /// per-file [`NamNode`] array addressed by [`NamFileEntry::nodes`].
    /// The `NamFileEntry` layout is unchanged from v1.0.0 except for the
    /// appended `nodes` carrier, so both versions walk via
    /// [`nam_file_entries`].
    pub const V1_1_0: Self = Self::new(1, 1, 0);
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

/// Per-file entry under the NAM wire schema.
///
/// `path` identifies the file, `language` tags its source language,
/// `source` carries the UTF-8 source bytes, and `nodes` (v1.1.0)
/// addresses the flat [`NamNode`] array serialised from the file's
/// parsed AST. All fields are `#[repr(C)]` or `#[repr(transparent)]`
/// types, so the struct layout is stable across compilation units.
///
/// The layout is shared across the v1.x line: v1.0.0 producers leave
/// `nodes` empty ([`crate::BytesRef::EMPTY`]); v1.1.0 producers
/// populate it. Both versions walk via [`nam_file_entries`].
#[repr(C)]
#[derive(Copy, Clone)]
pub struct NamFileEntry {
    pub path: crate::BytesRef,
    pub language: arvo::USize,
    pub source: crate::BytesRef,
    pub nodes: crate::BytesRef,
}

// SAFETY: NamFileEntry's pointers reference plugin-owned static memory
// stable for the loaded library's lifetime. Host reads only.
unsafe impl Send for NamFileEntry {}
unsafe impl Sync for NamFileEntry {}

/// One node of a file's serialised AST under NAM v1.1.0.
///
/// The host pre-walks the parsed tree once and serialises it into a
/// flat array addressed by [`NamFileEntry::nodes`]; a consumer walks
/// the array by index arithmetic without linking a parser. Tree
/// topology is encoded by indices into the same slice: `parent` is the
/// index of the enclosing node and `first_child` is the index of the
/// first child. A `parent` or `first_child` equal to the slice length
/// is the one-past-the-end sentinel: the root has no parent, a leaf has
/// no first child. `kind` is an id from the [`node_kind`] table;
/// `start_byte` / `end_byte` and `start_row` / `end_row` bound the
/// node's span in the source.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct NamNode {
    pub kind: arvo::USize,
    pub parent: arvo::USize,
    pub first_child: arvo::USize,
    pub start_byte: arvo::USize,
    pub end_byte: arvo::USize,
    pub start_row: arvo::USize,
    pub end_row: arvo::USize,
}

// SAFETY: NamNode is plain-old-data with no pointers; the array it
// lives in references plugin-owned memory stable for the borrow.
unsafe impl Send for NamNode {}
unsafe impl Sync for NamNode {}

/// Walk the file-entry slice behind a [`NamPayload`].
///
/// Accepts any v1.x carrier: the [`NamFileEntry`] layout is stable
/// across the v1.x line (v1.1.0 only appended the `nodes` carrier), so
/// v1.0.0 and v1.1.0 payloads walk the same slice. Returns `None` if
/// the carrier's major version is not `1`. Returns `Some(&[])` if the
/// slice is empty but the version matches.
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
    if payload.version.major != 1 {
        return None;
    }
    if payload.data.is_null() {
        return Some(&[]);
    }
    let entry_size = core::mem::size_of::<NamFileEntry>();
    debug_assert!(
        payload.len.0 % entry_size == 0,
        "NamPayload len must be a whole multiple of size_of::<NamFileEntry>()",
    );
    let count = payload.len.0 / entry_size;
    // SAFETY: caller upholds (data, len) describing a contiguous slice
    // of NamFileEntry records, `data` aligned for NamFileEntry, valid
    // for the borrow's lifetime.
    let slice = unsafe {
        core::slice::from_raw_parts(payload.data as *const NamFileEntry, count)
    };
    Some(slice)
}

/// Walk the v1.1.0 [`NamNode`] array addressed by a [`NamFileEntry`].
///
/// Returns `None` when the entry carries no serialised tree (its
/// `nodes` carrier is null, as for a v1.0.0 producer or an unparsed
/// file). Otherwise returns the node slice; `nodes.len` is a byte
/// length, so the count is `nodes.len / size_of::<NamNode>()`.
pub fn nam_file_nodes<'a>(entry: &'a NamFileEntry) -> Option<&'a [NamNode]> {
    if entry.nodes.data.is_null() {
        return None;
    }
    let node_size = core::mem::size_of::<NamNode>();
    debug_assert!(
        entry.nodes.len.0 % node_size == 0,
        "NamFileEntry nodes len must be a whole multiple of size_of::<NamNode>()",
    );
    let count = entry.nodes.len.0 / node_size;
    // SAFETY: the entry's `nodes` carrier addresses a contiguous slice
    // of NamNode records, `data` aligned for NamNode, owned by the
    // plugin and immutable for the borrow tied to `entry`.
    let slice = unsafe {
        core::slice::from_raw_parts(entry.nodes.data as *const NamNode, count)
    };
    Some(slice)
}

/// Workspace-canonical node-kind ids for [`NamNode::kind`].
///
/// Every consumer agrees on what an id means without sharing a parser
/// grammar. `UNKNOWN` (0) is the catch-all for any kind not yet in the
/// table. Initial coverage is the common Rust structural kinds the
/// bucket-2 lints identify (items, comments, visibility). Ids are
/// stable and append-only; new kinds and non-Rust grammars ship in
/// later schema sub-versions and never renumber an existing id.
pub mod node_kind {
    use arvo::USize;

    /// Catch-all for any kind not represented in the table.
    pub const UNKNOWN: USize = USize(0);
    /// The crate / file root node.
    pub const SOURCE_FILE: USize = USize(1);
    pub const FUNCTION_ITEM: USize = USize(2);
    pub const STRUCT_ITEM: USize = USize(3);
    pub const ENUM_ITEM: USize = USize(4);
    pub const UNION_ITEM: USize = USize(5);
    pub const TRAIT_ITEM: USize = USize(6);
    pub const IMPL_ITEM: USize = USize(7);
    pub const MOD_ITEM: USize = USize(8);
    /// A `type` alias item.
    pub const TYPE_ITEM: USize = USize(9);
    pub const CONST_ITEM: USize = USize(10);
    pub const STATIC_ITEM: USize = USize(11);
    pub const USE_DECLARATION: USize = USize(12);
    pub const MACRO_DEFINITION: USize = USize(13);
    pub const MACRO_INVOCATION: USize = USize(14);
    /// A `pub` / `pub(...)` visibility modifier.
    pub const VISIBILITY_MODIFIER: USize = USize(15);
    pub const LINE_COMMENT: USize = USize(16);
    pub const BLOCK_COMMENT: USize = USize(17);
    /// An `#[...]` attribute item.
    pub const ATTRIBUTE_ITEM: USize = USize(18);
    /// An `extern "..." { ... }` block.
    pub const FOREIGN_MOD_ITEM: USize = USize(19);
}

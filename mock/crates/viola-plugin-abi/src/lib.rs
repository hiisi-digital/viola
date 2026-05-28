#![no_std]
#![deny(unsafe_op_in_unsafe_fn)]

//! Viola Plugin ABI.
//!
//! Viola plugins are `hilavitkutin_extensions::Extension` instances
//! specialized for the lint-runtime domain. The descriptor surface,
//! lifecycle, provider dispatch, and version gating all come from
//! `hilavitkutin-extensions`. This crate adds the viola-specific
//! layer on top:
//!
//! - the well-known provider ids
//!   ([`PROVIDER_RUNNER_EXECUTE_SCOPE`], [`PROVIDER_GRAMMAR_EXTRACT`],
//!   [`PROVIDER_LINT_EVALUATE`], [`PROVIDER_LINT_EVALUATE_PROJECT`]) and
//!   their `#[repr(C)]` vtable shapes;
//! - the [`NamPayload`] / [`NamVersion`] carriers for the normalized
//!   analysis model produced once per run;
//! - the [`Diagnostic`] wire shape the lint role writes into the
//!   host-owned output buffer;
//! - viola-specific helpers ([`BytesRef`], [`RunSurface`],
//!   [`PluginError`]) used only inside the viola domain layering.
//!
//! Plugin authors compile against `hilavitkutin-extensions` for the
//! descriptor + lifecycle and against this crate for the role-specific
//! shapes, then declare the export with
//! `#[hilavitkutin_extensions_macros::export_extension]`.
//!
//! # No std, no alloc
//!
//! `#![no_std]` and zero allocations across the FFI boundary. All
//! variable-length data crosses as `(ptr, len)` carriers into
//! plugin-owned static memory whose lifetime equals the loaded library.

pub use hilavitkutin_extensions::{
    ProviderEntry, ProviderExport, ProviderId, DESCRIPTOR_SYMBOL,
    ExtensionAbiStatus, ExtensionDescriptor, ExtensionMeta, ExtensionVersion,
    HOST_ABI_VERSION, InitHandler, ShutdownHandler,
};

/// Historical alias for [`ExtensionAbiStatus`]. Plugin authors used
/// to import `AbiStatus` from this crate before the substrate
/// rebase; the alias preserves that callsite without forcing a
/// rename. New code should prefer the canonical `ExtensionAbiStatus`
/// name (and import it directly from `hilavitkutin_extensions` or
/// via `viola_core`).
pub type AbiStatus = ExtensionAbiStatus;

mod diagnostic;
mod nam;
mod vtable;

pub use diagnostic::{
    Diagnostic, DiagnosticSeverity, SourceLocation, SourceRange,
};
pub use nam::{
    NamFileEntry, NamNode, NamPayload, NamVersion, nam_file_entries,
    nam_file_nodes, node_kind,
};
pub use vtable::{
    FileEntry, GrammarExtractVtable, IndexBatch, LintEvaluateProjectIndexVtable,
    LintEvaluateVtable, MAX_INDEX_ENTRIES, RunScope, RunnerExecuteScopeVtable,
};

/// Two-word `(ptr, len)` carrier for byte slices crossing the boundary.
///
/// Identical pattern to hilavitkutin's name slice convention. Pointer
/// references plugin-owned static memory stable for the loaded
/// library's lifetime.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct BytesRef {
    pub data: *const u8,
    pub len: arvo::USize,
}

// SAFETY: BytesRef references plugin-owned static memory; host reads.
unsafe impl Send for BytesRef {}
unsafe impl Sync for BytesRef {}

impl BytesRef {
    pub const EMPTY: Self = Self {
        data: core::ptr::null(),
        len: arvo::USize(0),
    };

    pub const fn is_empty(&self) -> bool {
        self.len.0 == 0
    }
}

/// Provider id for the runner role's scope-execution entrypoint.
pub const PROVIDER_RUNNER_EXECUTE_SCOPE: ProviderId =
    ProviderId::from_name("viola.runner.execute_scope.v1");

/// Provider id for the grammar role's extraction entrypoint.
pub const PROVIDER_GRAMMAR_EXTRACT: ProviderId =
    ProviderId::from_name("viola.grammar.extract.v1");

/// Provider id for the lint role's evaluation entrypoint.
///
/// v2 carries the host-owned output buffer shape (see
/// [`LintEvaluateVtable`]); v1's plugin-owned batch return was deleted
/// outright per the no-legacy-shims-pre-1.0 rule.
pub const PROVIDER_LINT_EVALUATE: ProviderId =
    ProviderId::from_name("viola.lint.evaluate.v2");

/// Provider id for the project-scoped lint role's two-phase entrypoint.
///
/// Distinct from [`PROVIDER_LINT_EVALUATE`]: it points at a
/// [`LintEvaluateProjectIndexVtable`] (index then per-file evaluate)
/// rather than extending the single-phase lint vtable, keeping the
/// vtable shapes append-only.
pub const PROVIDER_LINT_EVALUATE_PROJECT: ProviderId =
    ProviderId::from_name("viola.lint.evaluate-project.v1");

/// Run surface tag mirrored into NAM `run_context.surface`.
///
/// `#[repr(u32)]` so the wire shape is stable; values match the NAM v1
/// `run_context.surface` encoding.
#[repr(u32)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum RunSurface {
    Cli = 0,
    Hook = 1,
    Ci = 2,
    Lsp = 3,
    Test = 4,
    Other = 0xFFFF,
}

/// Viola host-side error categories.
///
/// Distinct from [`hilavitkutin_extensions::ExtensionError`]: that
/// covers descriptor-level failures (load / abi / required-host-cap),
/// while these are viola-domain failures the host raises after the
/// extension has loaded successfully.
#[repr(u32)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum PluginError {
    /// Plugin claims a viola role but does not export the corresponding
    /// well-known provider id.
    RoleProviderMissing = 1,
    /// Lint produced a NAM-version-incompatible diagnostic batch.
    ModelVersionMismatch = 2,
    /// Provider invocation returned a non-`Ok` status.
    InvocationFailed = 3,
    /// Configuration could not be resolved or validated.
    ConfigInvalid = 4,
}

/// Wire shape of the normative error envelope per
/// `docs/PLUGIN-ABI-V1-DESIGN.md` §11.
///
/// `details_schema` is a [`ProviderId`] (`#[repr(transparent)] u64`)
/// matching the same schema-tag convention as
/// [`Diagnostic::metadata_schema`]. A zero id signals absent details.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct StructuredError {
    pub code: PluginError,
    pub message: BytesRef,
    pub details_schema: ProviderId,
    pub details_ptr: *const core::ffi::c_void,
    pub details_len: arvo::USize,
    /// `u8` (0 or 1) on the wire so the layout is stable across
    /// platforms; not Rust `bool`. lint:allow(arvo-types-only, no-bare-numeric, no-public-raw-field) tracked: #207
    pub retryable: u8,
    /// Reserved for future flag bits. lint:allow(arvo-types-only, no-bare-numeric, no-public-raw-field) tracked: #207
    pub _reserved: [u8; 3],
}

// SAFETY: pointers reference plugin-owned static memory; host reads.
unsafe impl Send for StructuredError {}
unsafe impl Sync for StructuredError {}

#[cfg(test)]
mod tests {
    use super::*;
    use core::mem::{align_of, size_of};

    #[test]
    fn well_known_providers_distinct() {
        assert_ne!(PROVIDER_RUNNER_EXECUTE_SCOPE.0, PROVIDER_GRAMMAR_EXTRACT.0);
        assert_ne!(PROVIDER_GRAMMAR_EXTRACT.0, PROVIDER_LINT_EVALUATE.0);
        assert_ne!(PROVIDER_RUNNER_EXECUTE_SCOPE.0, PROVIDER_LINT_EVALUATE.0);
        assert_ne!(PROVIDER_LINT_EVALUATE.0, PROVIDER_LINT_EVALUATE_PROJECT.0);
        assert_ne!(PROVIDER_RUNNER_EXECUTE_SCOPE.0, PROVIDER_LINT_EVALUATE_PROJECT.0);
        assert_ne!(PROVIDER_GRAMMAR_EXTRACT.0, PROVIDER_LINT_EVALUATE_PROJECT.0);
    }

    #[test]
    fn provider_id_is_transparent_u64() {
        assert_eq!(size_of::<ProviderId>(), size_of::<u64>());
        assert_eq!(align_of::<ProviderId>(), align_of::<u64>());
    }

    #[test]
    fn run_surface_is_repr_u32() {
        assert_eq!(size_of::<RunSurface>(), 4);
        assert_eq!(RunSurface::Cli as u32, 0);
        assert_eq!(RunSurface::Other as u32, 0xFFFF);
    }

    #[test]
    fn vtable_function_pointers_are_one_word() {
        assert_eq!(
            size_of::<RunnerExecuteScopeVtable>(),
            size_of::<*const ()>(),
        );
        assert_eq!(
            size_of::<GrammarExtractVtable>(),
            size_of::<*const ()>(),
        );
        assert_eq!(
            size_of::<LintEvaluateVtable>(),
            size_of::<*const ()>(),
        );
    }

    #[test]
    fn project_index_vtable_is_two_words() {
        use core::mem::offset_of;
        let ptr = size_of::<*const ()>();
        assert_eq!(size_of::<LintEvaluateProjectIndexVtable>(), ptr * 2);
        // pin the slot order: index_phase first, then evaluate_phase.
        assert_eq!(offset_of!(LintEvaluateProjectIndexVtable, index_phase), 0);
        assert_eq!(offset_of!(LintEvaluateProjectIndexVtable, evaluate_phase), ptr);
    }

    #[test]
    fn index_batch_layout_pointer_plus_three_usize() {
        use core::mem::offset_of;
        let ptr = size_of::<*mut core::ffi::c_void>();
        let usize_w = size_of::<arvo::USize>();
        // pin field order and the no-padding layout across pointer widths.
        assert_eq!(offset_of!(IndexBatch, entries), 0);
        assert_eq!(offset_of!(IndexBatch, capacity), ptr);
        assert_eq!(offset_of!(IndexBatch, len), ptr + usize_w);
        assert_eq!(offset_of!(IndexBatch, needed), ptr + usize_w * 2);
        assert_eq!(size_of::<IndexBatch>(), ptr + usize_w * 3);
    }

    #[test]
    fn bytes_ref_is_two_words() {
        assert_eq!(
            size_of::<BytesRef>(),
            size_of::<*const u8>() + size_of::<arvo::USize>(),
        );
    }

    #[test]
    fn structured_error_layout_pins_retryable_byte() {
        use core::mem::offset_of;
        let _ = offset_of!(StructuredError, code);
        let _ = offset_of!(StructuredError, message);
        let _ = offset_of!(StructuredError, retryable);
        let _ = offset_of!(StructuredError, _reserved);
    }

    #[test]
    fn nam_v1_0_0_is_one_zero_zero() {
        assert_eq!(NamVersion::V1_0_0.major, 1);
        assert_eq!(NamVersion::V1_0_0.minor, 0);
        assert_eq!(NamVersion::V1_0_0.patch, 0);
        assert_eq!(NamVersion::V1_0_0._reserved, 0);
    }

    #[test]
    fn nam_file_entry_layout_four_fields() {
        use core::mem::offset_of;
        let _ = offset_of!(NamFileEntry, path);
        let _ = offset_of!(NamFileEntry, language);
        let _ = offset_of!(NamFileEntry, source);
        let _ = offset_of!(NamFileEntry, nodes);
        assert_eq!(
            size_of::<NamFileEntry>(),
            size_of::<BytesRef>() * 3 + size_of::<arvo::USize>(),
        );
    }

    #[test]
    fn nam_file_entries_returns_none_on_null() {
        let entries = unsafe { nam_file_entries(core::ptr::null()) };
        assert!(entries.is_none());
    }

    #[test]
    fn nam_file_entries_returns_none_on_version_mismatch() {
        let payload = NamPayload {
            version: NamVersion::new(2, 0, 0),
            data: core::ptr::null(),
            len: arvo::USize(0),
        };
        let entries = unsafe { nam_file_entries(&payload) };
        assert!(entries.is_none());
    }

    #[test]
    fn nam_file_entries_returns_empty_on_null_data_v1() {
        let payload = NamPayload {
            version: NamVersion::V1_0_0,
            data: core::ptr::null(),
            len: arvo::USize(0),
        };
        let entries = unsafe { nam_file_entries(&payload) }.expect("v1 with null data yields Some(&[])");
        assert_eq!(entries.len(), 0);
    }

    #[test]
    fn nam_file_entries_walks_v1_slice() {
        let payload_bytes: &[NamFileEntry] = &[
            NamFileEntry {
                path: BytesRef::EMPTY,
                language: arvo::USize(0),
                source: BytesRef::EMPTY,
                nodes: BytesRef::EMPTY,
            },
            NamFileEntry {
                path: BytesRef::EMPTY,
                language: arvo::USize(1),
                source: BytesRef::EMPTY,
                nodes: BytesRef::EMPTY,
            },
        ];
        let payload = NamPayload {
            version: NamVersion::V1_0_0,
            data: payload_bytes.as_ptr() as *const core::ffi::c_void,
            len: arvo::USize(payload_bytes.len() * size_of::<NamFileEntry>()),
        };
        let entries = unsafe { nam_file_entries(&payload) }.expect("v1 with valid data yields slice");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].language.0, 0);
        assert_eq!(entries[1].language.0, 1);
    }

    #[test]
    fn nam_v1_1_0_is_one_one_zero() {
        assert_eq!(NamVersion::V1_1_0.major, 1);
        assert_eq!(NamVersion::V1_1_0.minor, 1);
        assert_eq!(NamVersion::V1_1_0.patch, 0);
        assert_eq!(NamVersion::V1_1_0._reserved, 0);
    }

    #[test]
    fn nam_file_entries_walks_v1_1_0_slice() {
        let entries: &[NamFileEntry] = &[NamFileEntry {
            path: BytesRef::EMPTY,
            language: arvo::USize(7),
            source: BytesRef::EMPTY,
            nodes: BytesRef::EMPTY,
        }];
        let payload = NamPayload {
            version: NamVersion::V1_1_0,
            data: entries.as_ptr() as *const core::ffi::c_void,
            len: arvo::USize(entries.len() * size_of::<NamFileEntry>()),
        };
        let walked =
            unsafe { nam_file_entries(&payload) }.expect("v1.1.0 payload walks the entry slice");
        assert_eq!(walked.len(), 1);
        assert_eq!(walked[0].language.0, 7);
    }

    #[test]
    fn nam_file_nodes_returns_none_when_no_tree() {
        let entry = NamFileEntry {
            path: BytesRef::EMPTY,
            language: arvo::USize(0),
            source: BytesRef::EMPTY,
            nodes: BytesRef::EMPTY,
        };
        assert!(nam_file_nodes(&entry).is_none());
    }

    #[test]
    fn nam_file_nodes_walks_node_slice() {
        let nodes: &[NamNode] = &[
            NamNode {
                kind: node_kind::SOURCE_FILE,
                parent: arvo::USize(1),
                first_child: arvo::USize(1),
                start_byte: arvo::USize(0),
                end_byte: arvo::USize(20),
                start_row: arvo::USize(0),
                end_row: arvo::USize(2),
            },
            NamNode {
                kind: node_kind::FUNCTION_ITEM,
                parent: arvo::USize(0),
                first_child: arvo::USize(2),
                start_byte: arvo::USize(0),
                end_byte: arvo::USize(20),
                start_row: arvo::USize(0),
                end_row: arvo::USize(2),
            },
        ];
        let entry = NamFileEntry {
            path: BytesRef::EMPTY,
            language: arvo::USize(0),
            source: BytesRef::EMPTY,
            nodes: BytesRef {
                data: nodes.as_ptr() as *const u8,
                len: arvo::USize(nodes.len() * size_of::<NamNode>()),
            },
        };
        let walked = nam_file_nodes(&entry).expect("populated nodes carrier yields a slice");
        assert_eq!(walked.len(), 2);
        assert_eq!(walked[0].kind.0, node_kind::SOURCE_FILE.0);
        // The root's parent index equals the slice length (sentinel).
        assert_eq!(walked[1].kind.0, node_kind::FUNCTION_ITEM.0);
        assert_eq!(walked[1].parent.0, 0);
    }

    #[test]
    fn node_kind_ids_are_contiguous_and_distinct() {
        use node_kind::*;
        // the full table in id order; each id must equal its position, which
        // proves distinctness AND append-only contiguity (a duplicate or a
        // renumbering breaks the equality).
        let ids = [
            UNKNOWN.0,
            SOURCE_FILE.0,
            FUNCTION_ITEM.0,
            STRUCT_ITEM.0,
            ENUM_ITEM.0,
            UNION_ITEM.0,
            TRAIT_ITEM.0,
            IMPL_ITEM.0,
            MOD_ITEM.0,
            TYPE_ITEM.0,
            CONST_ITEM.0,
            STATIC_ITEM.0,
            USE_DECLARATION.0,
            MACRO_DEFINITION.0,
            MACRO_INVOCATION.0,
            VISIBILITY_MODIFIER.0,
            LINE_COMMENT.0,
            BLOCK_COMMENT.0,
            ATTRIBUTE_ITEM.0,
            FOREIGN_MOD_ITEM.0,
            CALL_EXPRESSION.0,
            FIELD_EXPRESSION.0,
            FIELD_DECLARATION.0,
            PARAMETER.0,
            ENUM_VARIANT.0,
            TYPE_IDENTIFIER.0,
            PRIMITIVE_TYPE.0,
            ASSOCIATED_TYPE.0,
            IDENTIFIER.0,
        ];
        for (i, &id) in ids.iter().enumerate() {
            assert_eq!(id, i, "node_kind id at position {i} must equal {i}");
        }
        // the v1.2.0 additions occupy 20..=27.
        assert_eq!(CALL_EXPRESSION.0, 20);
        assert_eq!(ASSOCIATED_TYPE.0, 27);
        // the v1.3.0 addition is the next contiguous id.
        assert_eq!(IDENTIFIER.0, 28);
    }

    #[test]
    fn nam_version_v1_2_0() {
        assert_eq!(NamVersion::V1_2_0.major, 1);
        assert_eq!(NamVersion::V1_2_0.minor, 2);
        assert_eq!(NamVersion::V1_2_0.patch, 0);
    }

    #[test]
    fn nam_version_v1_3_0() {
        assert_eq!(NamVersion::V1_3_0.major, 1);
        assert_eq!(NamVersion::V1_3_0.minor, 3);
        assert_eq!(NamVersion::V1_3_0.patch, 0);
    }
}

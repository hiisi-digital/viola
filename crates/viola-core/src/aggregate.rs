//! Deterministic diagnostic aggregation per
//! `docs/PLUGIN-ABI-V1-DESIGN.md` §10.
//!
//! The §10 sort key is `(path, start_line, start_col, plugin_id, rule_id)`.
//! The host MUST sort by this key before final emission; lints MAY emit
//! in any order. This module ships the comparator and a slice-sort
//! helper that operate over [`Diagnostic`] in place. `Diagnostic` carries
//! [`viola_plugin_abi::BytesRef`] borrows into plugin memory; the sort
//! is byte-string lexicographic over those borrows. Callers that need to
//! retain diagnostics past plugin shutdown copy the bytes into their own
//! storage first and define an analogous comparator there.

use core::cmp::Ordering;

use viola_plugin_abi::{BytesRef, Diagnostic};

/// Compare two diagnostics by the §10 sort key.
///
/// Equal entries return [`Ordering::Equal`], leaving relative order to a
/// stable sort. The byte-string comparisons are lexicographic over the
/// raw bytes the plugin emitted; UTF-8 validity is not asserted here.
pub fn cmp_diag(a: &Diagnostic, b: &Diagnostic) -> Ordering {
    cmp_bytes(&a.path, &b.path)
        .then_with(|| a.range.start.line.cmp(&b.range.start.line))
        .then_with(|| a.range.start.column.cmp(&b.range.start.column))
        .then_with(|| cmp_bytes(&a.plugin_id, &b.plugin_id))
        .then_with(|| cmp_bytes(&a.rule_id, &b.rule_id))
}

fn cmp_bytes(a: &BytesRef, b: &BytesRef) -> Ordering {
    as_slice(a).cmp(as_slice(b))
}

fn as_slice(b: &BytesRef) -> &[u8] {
    if b.data.is_null() || b.len.0 == 0 {
        return &[];
    }
    // SAFETY: BytesRef points at plugin-owned static memory whose
    // lifetime equals the loaded library. Callers must invoke this
    // helper only while the originating Extension is alive; the public
    // entry points enforce that via borrow lifetimes.
    unsafe { core::slice::from_raw_parts(b.data, b.len.0) }
}

/// Insertion-sort the slice in place by the §10 key.
///
/// Insertion sort is the right primitive for a no_std host: it allocates
/// nothing, runs in O(n^2) which is acceptable for the per-run
/// diagnostic counts a single host invocation realistically produces
/// (tens to low thousands), and keeps the binary surface tiny. Consumers
/// that handle large batches and have their own scratch buffer can call
/// [`cmp_diag`] directly with their preferred algorithm.
///
/// # Lifetime contract
///
/// Every [`Diagnostic`] in `slice` carries [`BytesRef`] borrows into
/// plugin-owned static memory. The caller MUST guarantee that every
/// originating `Extension` is still alive for the duration of this
/// call; reading a `BytesRef` whose extension has dropped is undefined
/// behaviour. The contract is documented rather than compiler-enforced
/// because [`Diagnostic`] is a `#[repr(C)]` wire type without lifetime
/// parameters. Consumers that retain diagnostics past extension drop
/// MUST copy the bytes into owned storage and define their own
/// comparator over that storage.
pub fn sort_diagnostics(slice: &mut [Diagnostic]) {
    let n = slice.len();
    let mut i = 1;
    while i < n {
        let mut j = i;
        while j > 0 && cmp_diag(&slice[j - 1], &slice[j]) == Ordering::Greater {
            slice.swap(j - 1, j);
            j -= 1;
        }
        i += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use viola_plugin_abi::{
        DiagnosticSeverity, SourceLocation, SourceRange,
    };

    fn br(bytes: &'static [u8]) -> BytesRef {
        BytesRef {
            data: bytes.as_ptr(),
            len: arvo::USize(bytes.len()),
        }
    }

    fn make(
        path: &'static [u8],
        line: u32,
        col: u32,
        plugin: &'static [u8],
        rule: &'static [u8],
    ) -> Diagnostic {
        Diagnostic {
            plugin_id: br(plugin),
            rule_id: br(rule),
            severity: DiagnosticSeverity::Warn,
            message: BytesRef::EMPTY,
            path: br(path),
            range: SourceRange {
                start: SourceLocation { line, column: col },
                end: SourceLocation { line, column: col },
            },
            suggestion: BytesRef::EMPTY,
            metadata_schema: viola_plugin_abi::CapabilityId(0),
            metadata_ptr: core::ptr::null(),
            metadata_len: arvo::USize(0),
        }
    }

    #[test]
    fn cmp_orders_by_path_then_line_then_col_then_plugin_then_rule() {
        let a = make(b"a.rs", 1, 0, b"p", b"r");
        let b = make(b"b.rs", 1, 0, b"p", b"r");
        assert_eq!(cmp_diag(&a, &b), Ordering::Less);

        let a = make(b"a.rs", 1, 0, b"p", b"r");
        let b = make(b"a.rs", 2, 0, b"p", b"r");
        assert_eq!(cmp_diag(&a, &b), Ordering::Less);

        let a = make(b"a.rs", 1, 0, b"p", b"r");
        let b = make(b"a.rs", 1, 5, b"p", b"r");
        assert_eq!(cmp_diag(&a, &b), Ordering::Less);

        let a = make(b"a.rs", 1, 0, b"alpha", b"r");
        let b = make(b"a.rs", 1, 0, b"beta", b"r");
        assert_eq!(cmp_diag(&a, &b), Ordering::Less);

        let a = make(b"a.rs", 1, 0, b"p", b"r1");
        let b = make(b"a.rs", 1, 0, b"p", b"r2");
        assert_eq!(cmp_diag(&a, &b), Ordering::Less);
    }

    #[test]
    fn sort_diagnostics_pins_canonical_order() {
        let mut slice = [
            make(b"b.rs", 5, 0, b"p", b"r"),
            make(b"a.rs", 10, 0, b"p", b"r"),
            make(b"a.rs", 1, 5, b"p", b"r"),
            make(b"a.rs", 1, 0, b"p", b"r2"),
            make(b"a.rs", 1, 0, b"p", b"r1"),
        ];
        sort_diagnostics(&mut slice);

        assert_eq!(slice[0].range.start.line, 1);
        assert_eq!(slice[0].range.start.column, 0);
        assert_eq!(as_slice(&slice[0].rule_id), b"r1");
        assert_eq!(as_slice(&slice[1].rule_id), b"r2");
        assert_eq!(slice[2].range.start.column, 5);
        assert_eq!(slice[3].range.start.line, 10);
        assert_eq!(as_slice(&slice[4].path), b"b.rs");
    }
}

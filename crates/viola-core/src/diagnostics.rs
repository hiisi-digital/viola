//! Aggregate per-lint `DiagnosticBatch`es into an owned, deterministic
//! list.
//!
//! Per `docs/PLUGIN-ABI-V1-DESIGN.md` §10, the host MUST sort the
//! aggregated diagnostics by `(path, start_line, start_col, plugin_id,
//! rule_id)` before final emission. Lints MAY emit in any order; the
//! sort is the host's responsibility.
//!
//! Each `Diagnostic` on the wire carries `BytesRef` slots that point
//! into plugin-owned static memory stable until the next call into the
//! same plugin instance. The host copies the bytes into owned
//! [`OwnedDiagnostic`] records before sorting; once copied, the owned
//! list is independent of plugin lifetime.

use viola_plugin_abi::{
    BytesRef, Diagnostic, DiagnosticBatch, DiagnosticSeverity, SourceRange,
};

/// Host-owned diagnostic. Copied from plugin-owned wire memory at
/// aggregation time; safe to retain across plugin shutdown.
#[derive(Debug, Clone)]
pub struct OwnedDiagnostic {
    pub plugin_id: String,
    pub rule_id: String,
    pub severity: DiagnosticSeverity,
    pub message: String,
    pub path: String,
    pub range: SourceRange,
    pub suggestion: Option<String>,
    pub metadata_schema: u64,
    pub metadata: Vec<u8>,
}

impl OwnedDiagnostic {
    fn from_wire(d: &Diagnostic) -> Self {
        Self {
            plugin_id: bytes_to_string(d.plugin_id),
            rule_id: bytes_to_string(d.rule_id),
            severity: d.severity,
            message: bytes_to_string(d.message),
            path: bytes_to_string(d.path),
            range: d.range,
            suggestion: if d.suggestion.is_empty() {
                None
            } else {
                Some(bytes_to_string(d.suggestion))
            },
            metadata_schema: d.metadata_schema,
            metadata: if d.metadata_ptr.is_null() || d.metadata_len == 0 {
                Vec::new()
            } else {
                let bytes = unsafe {
                    core::slice::from_raw_parts(
                        d.metadata_ptr as *const u8,
                        d.metadata_len,
                    )
                };
                bytes.to_vec()
            },
        }
    }
}

fn bytes_to_string(r: BytesRef) -> String {
    if r.data.is_null() || r.len == 0 {
        return String::new();
    }
    let bytes = unsafe { core::slice::from_raw_parts(r.data, r.len) };
    String::from_utf8_lossy(bytes).into_owned()
}

/// Copy a wire batch into owned host memory.
///
/// # Safety
///
/// `batch.entries` MUST point at a valid array of `batch.len`
/// [`Diagnostic`]s in plugin-owned static memory, stable for the
/// duration of this call.
pub unsafe fn copy_batch(batch: &DiagnosticBatch) -> Vec<OwnedDiagnostic> {
    if batch.entries.is_null() || batch.len == 0 {
        return Vec::new();
    }
    let entries =
        unsafe { core::slice::from_raw_parts(batch.entries, batch.len) };
    entries.iter().map(OwnedDiagnostic::from_wire).collect()
}

/// Aggregate multiple wire batches and apply the §10 deterministic sort.
///
/// # Safety
///
/// Same caller invariants as [`copy_batch`] for every batch in the
/// input slice.
pub unsafe fn aggregate_and_sort(
    batches: &[DiagnosticBatch],
) -> Vec<OwnedDiagnostic> {
    let mut out = Vec::new();
    for batch in batches {
        let mut copied = unsafe { copy_batch(batch) };
        out.append(&mut copied);
    }
    sort_deterministic(&mut out);
    out
}

/// Apply the §10 sort to an owned list in place.
pub fn sort_deterministic(diags: &mut [OwnedDiagnostic]) {
    diags.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then(a.range.start.line.cmp(&b.range.start.line))
            .then(a.range.start.column.cmp(&b.range.start.column))
            .then(a.plugin_id.cmp(&b.plugin_id))
            .then(a.rule_id.cmp(&b.rule_id))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use viola_plugin_abi::SourceLocation;

    fn diag(
        plugin_id: &str,
        rule_id: &str,
        path: &str,
        line: u32,
        col: u32,
    ) -> OwnedDiagnostic {
        OwnedDiagnostic {
            plugin_id: plugin_id.into(),
            rule_id: rule_id.into(),
            severity: DiagnosticSeverity::Warn,
            message: String::new(),
            path: path.into(),
            range: SourceRange {
                start: SourceLocation { line, column: col },
                end: SourceLocation { line, column: col + 1 },
            },
            suggestion: None,
            metadata_schema: 0,
            metadata: Vec::new(),
        }
    }

    #[test]
    fn sort_uses_path_then_line_then_col_then_plugin_then_rule() {
        let mut v = vec![
            diag("p2", "r1", "b.rs", 1, 0),
            diag("p1", "r2", "a.rs", 5, 0),
            diag("p1", "r1", "a.rs", 5, 0),
            diag("p1", "r1", "a.rs", 1, 4),
            diag("p1", "r1", "a.rs", 1, 0),
        ];
        sort_deterministic(&mut v);
        // Expected order: a.rs:1:0 p1 r1, a.rs:1:4 p1 r1, a.rs:5:0 p1 r1,
        //                 a.rs:5:0 p1 r2, b.rs:1:0 p2 r1.
        assert_eq!(v[0].path, "a.rs");
        assert_eq!(v[0].range.start.line, 1);
        assert_eq!(v[0].range.start.column, 0);
        assert_eq!(v[1].range.start.column, 4);
        assert_eq!(v[2].range.start.line, 5);
        assert_eq!(v[2].rule_id, "r1");
        assert_eq!(v[3].rule_id, "r2");
        assert_eq!(v[4].path, "b.rs");
    }
}

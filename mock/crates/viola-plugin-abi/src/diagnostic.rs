//! Diagnostic schema emitted by lints and aggregated by the host.
//!
//! Diagnostics are the lint role's wire-side output. The schema is
//! deliberately minimal at v1: enough to render an actionable message
//! with location and severity, plus opaque metadata slots that
//! follow-up rounds extend (workflow context, confidence, structured
//! suggestion, fix patches per #233).
//!
//! Determinism: the host sorts the aggregated batch by
//! `(path, start_line, start_col, plugin_id, rule_id)` before final
//! emission. Lints MAY emit in any order.

use core::ffi::c_void;

use crate::{BytesRef, ProviderId};

/// Severity classification for a diagnostic.
///
/// `#[repr(u32)]` so it transits as a plain word. Wire ordering is
/// `Info < Warn < Error`; the host MAY filter or escalate based on
/// configuration.
#[repr(u32)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum DiagnosticSeverity {
    Info = 0,
    Warn = 1,
    Error = 2,
}

/// Source position in a document.
///
/// Line is 1-based, column is 0-based, matching the NAM convention
/// from `docs/PLUGIN-ABI-V1-DESIGN.md` §9.3.
#[repr(C)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct SourceLocation {
    /// 1-based line. lint:allow(arvo-types-only, no-bare-numeric, no-public-raw-field) tracked: #207
    pub line: u32,
    /// 0-based column. lint:allow(arvo-types-only, no-bare-numeric, no-public-raw-field) tracked: #207
    pub column: u32,
}

/// Half-open source range within a document.
///
/// `start` and `end` use the same conventions as [`SourceLocation`].
/// A zero-width range (start == end) marks a point.
#[repr(C)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct SourceRange {
    pub start: SourceLocation,
    pub end: SourceLocation,
}

/// Single diagnostic emitted by a lint.
///
/// All [`BytesRef`] slots point at plugin-owned buffers stable until
/// `shutdown_fn` is called. The host copies the bytes before any
/// persistence step; it does not retain pointers across shutdown.
///
/// `metadata` carries opaque structured metadata. Layout of the
/// pointee is governed by `metadata_schema` (a [`crate::ProviderId`]
/// hash); v1 reserves the slot, follow-up rounds (#233) populate
/// concrete schemas for confidence, suggestion, fix patches, and
/// workflow context.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct Diagnostic {
    pub plugin_id: BytesRef,
    pub rule_id: BytesRef,
    pub severity: DiagnosticSeverity,
    pub message: BytesRef,
    pub path: BytesRef,
    pub range: SourceRange,
    pub suggestion: BytesRef,

    /// Schema tag (FNV-1a 64-bit). Zero signals absent details.
    pub metadata_schema: ProviderId,
    pub metadata_ptr: *const c_void,
    pub metadata_len: arvo::USize,
}

// SAFETY: Diagnostic holds raw pointers into plugin-owned buffers that
// outlive the host's read of the batch. The host reads only.
unsafe impl Send for Diagnostic {}
unsafe impl Sync for Diagnostic {}

// Output-buffer ownership note: a lint invocation writes its
// [`Diagnostic`] records into a host-owned buffer passed to
// `LintEvaluateVtable.evaluate` as `out_entries` + `out_capacity`, and
// reports the written count via `out_len`. There is no plugin-owned
// batch carrier; the host allocates, the plugin writes through, and the
// host reads `*out_len` entries after the call returns.

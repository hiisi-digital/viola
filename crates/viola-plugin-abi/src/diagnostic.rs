//! Diagnostic schema emitted by lints and aggregated by the host.
//!
//! Diagnostics are the lint role's wire-side output. The schema is
//! deliberately minimal at v1: enough to render an actionable message
//! with location and severity, plus opaque metadata slots that
//! follow-up rounds extend (workflow context, confidence, structured
//! suggestion, fix patches).
//!
//! Determinism: the host sorts the aggregated batch by
//! `(path, start_line, start_col, plugin_id, rule_id)` before final
//! emission. Lints MAY emit in any order.

use core::ffi::c_void;

/// Severity classification for a diagnostic.
///
/// `#[repr(u32)]` so it transits as a plain word. Wire ordering is
/// `Info < Warn < Error`; the host MAY filter or escalate based on
/// configuration.
#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum DiagnosticSeverity {
    Info = 0,
    Warn = 1,
    Error = 2,
}

/// Source position in a document.
///
/// Line is 1-based, column is 0-based; the same convention NAM uses.
#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct SourceLocation {
    pub line: u32,
    pub column: u32,
}

/// Half-open source range within a document.
///
/// `start` and `end` use the same line/column conventions as
/// [`SourceLocation`]. A zero-width range (start == end) marks a
/// point.
#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct SourceRange {
    pub start: SourceLocation,
    pub end: SourceLocation,
}

/// Single diagnostic emitted by a lint.
///
/// All `(ptr, len)` UTF-8 string slots point at plugin-owned buffers
/// stable until `shutdown_fn` is called. The host copies the bytes
/// before any persistence step; it does not retain pointers across
/// shutdown.
///
/// `metadata_ptr` carries opaque structured metadata (confidence,
/// suggestion, workflow-context fields). Layout of the pointee is
/// governed by `metadata_schema` (a [`crate::CapabilityId`] hash); v1
/// reserves the slot, follow-up rounds populate concrete schemas.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct Diagnostic {
    pub plugin_id_ptr: *const u8,
    pub plugin_id_len: usize,

    pub rule_id_ptr: *const u8,
    pub rule_id_len: usize,

    pub severity: DiagnosticSeverity,

    pub message_ptr: *const u8,
    pub message_len: usize,

    pub path_ptr: *const u8,
    pub path_len: usize,

    pub range: SourceRange,

    pub suggestion_ptr: *const u8,
    pub suggestion_len: usize,

    pub metadata_schema: u64,
    pub metadata_ptr: *const c_void,
    pub metadata_len: usize,
}

// SAFETY: Diagnostic holds raw pointers into plugin-owned buffers that
// outlive the host's read of the batch. The host reads only.
unsafe impl Send for Diagnostic {}
unsafe impl Sync for Diagnostic {}

/// Batch of diagnostics returned by a single lint invocation.
///
/// `entries` points at an array of [`Diagnostic`] of length `len`.
/// Buffer ownership is plugin-side; the host copies before the next
/// invocation.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct DiagnosticBatch {
    pub entries: *const Diagnostic,
    pub len: usize,
}

// SAFETY: see Diagnostic.
unsafe impl Send for DiagnosticBatch {}
unsafe impl Sync for DiagnosticBatch {}

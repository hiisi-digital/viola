//! Hand-rolled JSON emitter for the host-to-worker direction. Replaces
//! `serde_json::to_writer` with a stack-buffer encoder. The two outgoing
//! frame shapes are `LintRequest` (`{"op":"lint","scope":{...}}`) and
//! `ShutdownRequest` (`{"op":"shutdown"}`); both build inline into a
//! `FrameWriter` and write to stdin in one `write_all` plus newline.

use crate::error::DenoRuntimeError;
use crate::FRAME_CAP;
use notko::Outcome;
use viola_plugin_abi::{BytesRef, RunScope};

/// Stack-allocated JSON output buffer. The host builds one frame per
/// outgoing message into this buffer, then writes the validated slice
/// to the worker's stdin in a single `write_all` plus newline.
pub(crate) struct FrameWriter {
    buf: [u8; FRAME_CAP],
    len: arvo::USize,
}

impl FrameWriter {
    pub(crate) fn new() -> Self {
        Self { buf: [0; FRAME_CAP], len: arvo::USize(0) }
    }

    pub(crate) fn reset(&mut self) {
        self.len.0 = 0;
    }

    fn push_byte(&mut self, b: u8) -> Outcome<(), DenoRuntimeError> {
        if self.len.0 >= FRAME_CAP {
            return Outcome::Err(DenoRuntimeError::EncodeBufferFull);
        }
        self.buf[self.len.0] = b;
        self.len.0 += 1;
        Outcome::Ok(())
    }

    fn push_bytes(&mut self, src: &[u8]) -> Outcome<(), DenoRuntimeError> {
        let end = match self.len.0.checked_add(src.len()) {
            Some(e) if e <= FRAME_CAP => e,
            _ => return Outcome::Err(DenoRuntimeError::EncodeBufferFull),
        };
        self.buf[self.len.0..end].copy_from_slice(src);
        self.len.0 = end;
        Outcome::Ok(())
    }

    /// Emit `src` as a JSON string literal. Handles the mandatory
    /// escapes (`\"`, `\\`, control characters); UTF-8 multi-byte
    /// sequences pass through unchanged since the JSON specs accept
    /// raw UTF-8 inside string literals.
    fn push_json_string(&mut self, src: &[u8]) -> Outcome<(), DenoRuntimeError> {
        if let Outcome::Err(e) = self.push_byte(b'"') { return Outcome::Err(e); }
        for &b in src {
            let escaped: Outcome<(), DenoRuntimeError> = match b {
                b'"' => self.push_bytes(b"\\\""),
                b'\\' => self.push_bytes(b"\\\\"),
                b'\n' => self.push_bytes(b"\\n"),
                b'\r' => self.push_bytes(b"\\r"),
                b'\t' => self.push_bytes(b"\\t"),
                0x08 => self.push_bytes(b"\\b"),
                0x0c => self.push_bytes(b"\\f"),
                0..=0x1f => {
                    let hex = b"0123456789abcdef";
                    if let Outcome::Err(e) = self.push_bytes(b"\\u00") { return Outcome::Err(e); }
                    if let Outcome::Err(e) = self.push_byte(hex[(b >> 4) as usize]) { return Outcome::Err(e); }
                    self.push_byte(hex[(b & 0x0f) as usize])
                }
                _ => self.push_byte(b),
            };
            if let Outcome::Err(e) = escaped { return Outcome::Err(e); }
        }
        self.push_byte(b'"')
    }

    pub(crate) fn as_slice(&self) -> &[u8] {
        &self.buf[..self.len.0]
    }
}

fn bytes_ref_to_bytes(b: &BytesRef) -> &[u8] {
    if b.data.is_null() || b.len.0 == 0 {
        return &[];
    }
    // SAFETY: contract guarantees the BytesRef is valid for the call duration.
    unsafe { core::slice::from_raw_parts(b.data, b.len.0) }
}

pub(crate) fn build_lint_request(
    fw: &mut FrameWriter,
    scope: &RunScope,
) -> Outcome<(), DenoRuntimeError> {
    if let Outcome::Err(e) = fw.push_bytes(b"{\"op\":\"lint\",\"scope\":{\"workspace_root\":") {
        return Outcome::Err(e);
    }
    if let Outcome::Err(e) = fw.push_json_string(bytes_ref_to_bytes(&scope.workspace_root)) {
        return Outcome::Err(e);
    }
    if let Outcome::Err(e) = fw.push_bytes(b",\"files\":[") { return Outcome::Err(e); }
    if !scope.files.is_null() && scope.files_len.0 > 0 {
        // SAFETY: contract guarantees the slice is valid for this call.
        let files = unsafe {
            core::slice::from_raw_parts(scope.files, scope.files_len.0)
        };
        for (i, f) in files.iter().enumerate() {
            if i > 0 {
                if let Outcome::Err(e) = fw.push_byte(b',') { return Outcome::Err(e); }
            }
            if let Outcome::Err(e) = fw.push_bytes(b"{\"path\":") { return Outcome::Err(e); }
            if let Outcome::Err(e) = fw.push_json_string(bytes_ref_to_bytes(&f.path)) {
                return Outcome::Err(e);
            }
            if let Outcome::Err(e) = fw.push_bytes(b",\"language\":") { return Outcome::Err(e); }
            if let Outcome::Err(e) = fw.push_json_string(bytes_ref_to_bytes(&f.language)) {
                return Outcome::Err(e);
            }
            if let Outcome::Err(e) = fw.push_byte(b'}') { return Outcome::Err(e); }
        }
    }
    fw.push_bytes(b"]}}")
}

pub(crate) fn build_shutdown_request(fw: &mut FrameWriter) -> Outcome<(), DenoRuntimeError> {
    fw.push_bytes(b"{\"op\":\"shutdown\"}")
}

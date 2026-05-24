//! Fixed-cap bump arena holding the owned bytes a `Diagnostic`
//! references via `BytesRef`, plus the `Diagnostic` records themselves.
//! Rebuilt on each lint invocation. The v1 contract guarantees the host
//! copies the batch before the next invocation, so pointers stay valid
//! only until the next `clear()`.

use crate::error::DenoRuntimeError;
use crate::{ARENA_BYTES, MAX_DIAGS};
use core::mem::MaybeUninit;
use notko::Outcome;
use viola_plugin_abi::{BytesRef, Diagnostic};

pub(crate) struct Arena {
    buf: [u8; ARENA_BYTES],
    used: arvo::USize,
    diagnostics: [MaybeUninit<Diagnostic>; MAX_DIAGS],
    pub(crate) diag_count: arvo::USize,
}

impl Arena {
    pub(crate) fn new() -> Self {
        // SAFETY: an array of `MaybeUninit<T>` is itself an arbitrary
        // bit pattern (each element is `MaybeUninit::uninit()`); the
        // outer array's `MaybeUninit::assume_init` is sound because
        // the element type is `MaybeUninit<Diagnostic>`.
        let diagnostics = unsafe {
            MaybeUninit::<[MaybeUninit<Diagnostic>; MAX_DIAGS]>::uninit().assume_init()
        };
        Self {
            buf: [0; ARENA_BYTES],
            used: arvo::USize(0),
            diagnostics,
            diag_count: arvo::USize(0),
        }
    }

    pub(crate) fn clear(&mut self) {
        self.used.0 = 0;
        self.diag_count.0 = 0;
    }

    pub(crate) fn intern(&mut self, src: &[u8]) -> Outcome<BytesRef, DenoRuntimeError> {
        if src.is_empty() {
            return Outcome::Ok(BytesRef::EMPTY);
        }
        let start = self.used.0;
        let end = match start.checked_add(src.len()) {
            Some(e) if e <= ARENA_BYTES => e,
            _ => return Outcome::Err(DenoRuntimeError::ArenaBytesFull),
        };
        self.buf[start..end].copy_from_slice(src);
        let ptr = self.buf[start..].as_ptr();
        self.used.0 = end;
        Outcome::Ok(BytesRef {
            data: ptr,
            len: arvo::USize(src.len()),
        })
    }

    pub(crate) fn push_diag(&mut self, d: Diagnostic) -> Outcome<(), DenoRuntimeError> {
        if self.diag_count.0 >= MAX_DIAGS {
            return Outcome::Err(DenoRuntimeError::ArenaDiagsFull);
        }
        self.diagnostics[self.diag_count.0] = MaybeUninit::new(d);
        self.diag_count.0 += 1;
        Outcome::Ok(())
    }

    pub(crate) fn diagnostics_ptr(&self) -> *const Diagnostic {
        self.diagnostics.as_ptr().cast()
    }
}

//! Fixed-cap UTF-8 path buffer replacing `std::path::PathBuf` at every
//! host-owned position. Drops down to `&Path` only at the std boundary
//! calls (Command, fs).

use crate::error::DenoRuntimeError;
use crate::PATH_CAP;
use notko::Outcome;
use std::path::Path;                                                 // lint:allow(forbidden-imports, no-std) -- &Path is the std boundary handoff to Command::arg and fs::write. tracked: #197

pub(crate) struct PathBuf64 {
    pub(crate) bytes: [u8; PATH_CAP],
    pub(crate) len: arvo::USize,
}

impl PathBuf64 {
    pub(crate) const fn empty() -> Self {
        Self { bytes: [0; PATH_CAP], len: arvo::USize(0) }
    }

    pub(crate) fn from_str(s: &str) -> Outcome<Self, DenoRuntimeError> {
        let bytes = s.as_bytes();
        if bytes.len() > PATH_CAP {
            return Outcome::Err(DenoRuntimeError::ConfigPathTooLong);
        }
        let mut buf = Self::empty();
        buf.bytes[..bytes.len()].copy_from_slice(bytes);
        buf.len = arvo::USize(bytes.len());
        Outcome::Ok(buf)
    }

    pub(crate) fn as_bytes(&self) -> &[u8] {
        &self.bytes[..self.len.0]
    }

    pub(crate) fn as_str(&self) -> &str {
        // SAFETY: bytes originate from a validated &str at construction.
        unsafe { core::str::from_utf8_unchecked(self.as_bytes()) }
    }

    pub(crate) fn as_path(&self) -> &Path {
        Path::new(self.as_str())
    }
}

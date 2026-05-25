//! Concrete `EmitWriter` impl: stderr via libc::write.
//!
//! Slice 8b.1 ships `StderrEmitter` as viola-cli's choice of egress
//! writer for the post-#254 lint flow. ZST so there is no
//! per-Resource allocation overhead; `libc::write(2, ptr, len)`
//! retry loop drains the buffer one syscall at a time;
//! panic-on-syscall-failure routes through the existing
//! panic_handler in `main.rs` (which calls libc::abort on unix).
//! Unbuffered: `flush` is a no-op. Pre-1.0; the trait can switch
//! to buffered or non-panicking later without API change.
//!
//! Slice 8b.1 ships this type but does not yet wire it through the
//! scheduler-build chain; that wiring lands in Slice 8b.2.

use viola_core::wus::EmitWriter;

/// No-allocation, unbuffered stderr emitter. Writes go to fd 2 via
/// libc::write; syscall failures panic.
pub struct StderrEmitter;

impl EmitWriter for StderrEmitter {
    fn write_str(&mut self, s: &str) {
        write_all_to_stderr(s.as_bytes());
    }

    fn write_bytes(&mut self, bytes: &[u8]) {
        write_all_to_stderr(bytes);
    }

    fn flush(&mut self) {
        // No-op: unbuffered emitter. Each write_str / write_bytes
        // call already issues a syscall.
    }
}

/// Drain `bytes` to stderr fd 2 in a retry loop. Panics on syscall
/// failure or zero-progress retry exhaustion.
///
/// `libc::write` may return fewer bytes than requested; the loop
/// re-attempts the unwritten remainder until the buffer drains. A
/// return of `-1` indicates an errno-bearing failure; the loop
/// panics to surface the I/O failure visibly rather than silently
/// dropping output. Zero-progress retries beyond a small cap also
/// panic to avoid a hang on a misbehaving fd.
fn write_all_to_stderr(bytes: &[u8]) {
    let mut offset: usize = 0; // lint:allow(no-bare-numeric) reason: byte-loop counter; tracked: #72
    let mut zero_progress_attempts: usize = 0; // lint:allow(no-bare-numeric) reason: progress-watchdog counter; tracked: #72
    const MAX_ZERO_PROGRESS: usize = 4; // lint:allow(no-bare-numeric) reason: small cap on zero-byte retries; tracked: #72
    while offset < bytes.len() {
        let remainder = &bytes[offset..];
        // SAFETY: stderr (fd 2) is process-lifetime; `remainder.as_ptr()`
        // is valid for read of `remainder.len()` bytes for the call
        // duration. libc::write follows the POSIX contract.
        debug_assert!(
            remainder.len() <= libc::ssize_t::MAX as usize,
            "remainder must fit ssize_t for libc::write",
        );
        let written = unsafe {
            libc::write(
                2, // lint:allow(no-bare-numeric) reason: fd 2 = stderr POSIX constant; tracked: #207
                remainder.as_ptr() as *const core::ffi::c_void,
                remainder.len(),
            )
        };
        if written < 0 {
            // errno-bearing failure; panic routes to libc::abort.
            panic!("viola-cli: stderr write failed (libc::write returned -1)");
        }
        let progress = written as usize;
        if progress == 0 { // lint:allow(no-bare-numeric) reason: zero-progress check; tracked: #72
            zero_progress_attempts += 1; // lint:allow(no-bare-numeric) reason: watchdog increment; tracked: #72
            if zero_progress_attempts >= MAX_ZERO_PROGRESS {
                panic!(
                    "viola-cli: stderr write made no progress after retries; aborting",
                );
            }
            continue;
        }
        zero_progress_attempts = 0; // lint:allow(no-bare-numeric) reason: reset on progress; tracked: #72
        offset += progress;
    }
}

//! libc-backed file I/O and stderr emission helpers.
//!
//! All helpers operate on raw byte buffers; no `alloc`, no `core::fmt`.
//! Paths crossing into libc must be C-strings (null-terminated). The
//! [`write_to_buf_with_nul`] helper copies a byte slice into a fixed
//! buffer and appends `\0`, so the result is suitable for
//! [`libc::open`] and [`hilavitkutin_extensions::ExtensionHost::load`]
//! (which also expects a null-terminated path per
//! `hilavitkutin-linking`'s contract).

use core::ffi::c_void;

/// Standard file descriptors.
pub const STDERR: i32 = 2; // lint:allow(arvo-types-only, no-bare-numeric) tracked: #207

/// Write a byte slice to stderr. Errors are swallowed; the CLI's
/// stderr path is best-effort by design.
pub fn eprint(bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    // SAFETY: libc::write is the documented platform syscall; STDERR
    // is a process-stable file descriptor. Bytes ptr+len describe a
    // borrowed slice valid for this call.
    unsafe {
        let _ = libc::write(
            STDERR,
            bytes.as_ptr() as *const c_void,
            bytes.len(),
        );
    }
}

/// Write a byte slice plus a `\n` to stderr.
pub fn eprintln(bytes: &[u8]) {
    eprint(bytes);
    eprint(b"\n");
}

/// Open a file by C-string path and read up to `out.len()` bytes.
///
/// Returns the number of bytes read. The buffer is treated as raw
/// storage; callers slice it with the returned count. On failure
/// (open error, read error, file too large) returns
/// [`notko::Maybe::Isnt`].
pub fn read_file<'a>(
    c_path: &[u8],
    out: &'a mut [u8],
) -> notko::Maybe<&'a [u8]> {
    if c_path.is_empty() || c_path[c_path.len() - 1] != 0 {
        return notko::Maybe::Isnt;
    }
    // SAFETY: c_path is null-terminated by precondition; libc::open
    // wraps the platform syscall.
    let fd = unsafe { libc::open(c_path.as_ptr() as *const i8, libc::O_RDONLY) };
    if fd < 0 {
        return notko::Maybe::Isnt;
    }

    let mut total = 0usize;
    loop {
        if total >= out.len() {
            // File larger than buffer; signal failure rather than
            // silently truncate.
            // SAFETY: fd is a live descriptor returned by open.
            unsafe {
                libc::close(fd);
            }
            return notko::Maybe::Isnt;
        }
        // SAFETY: out[total..] is a valid host-owned mutable slice;
        // libc::read writes into it up to remaining length.
        let n = unsafe {
            libc::read(
                fd,
                out.as_mut_ptr().add(total) as *mut c_void,
                out.len() - total,
            )
        };
        if n < 0 {
            // SAFETY: fd live.
            unsafe {
                libc::close(fd);
            }
            return notko::Maybe::Isnt;
        }
        if n == 0 {
            break;
        }
        total += n as usize;
    }
    // SAFETY: fd live.
    unsafe {
        libc::close(fd);
    }
    notko::Maybe::Is(&out[..total])
}

/// Copy `bytes` into `out` and append a trailing `\0`.
///
/// Returns the populated prefix on success, `Maybe::Isnt` if the
/// input plus terminator does not fit. Callers pass the returned
/// slice (already null-terminated) to libc and hilavitkutin-linking
/// surfaces.
pub fn write_to_buf_with_nul<'a>(
    bytes: &[u8],
    out: &'a mut [u8],
) -> notko::Maybe<&'a [u8]> {
    if bytes.len() + 1 > out.len() {
        return notko::Maybe::Isnt;
    }
    out[..bytes.len()].copy_from_slice(bytes);
    out[bytes.len()] = 0;
    notko::Maybe::Is(&out[..bytes.len() + 1])
}

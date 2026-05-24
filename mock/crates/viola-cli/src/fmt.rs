//! Tiny integer-to-bytes formatter for diagnostic emission.
//!
//! `core::fmt` is allocation-free in principle but the formatter
//! state and trait machinery balloon binary size and depend on
//! formatting infrastructure the no_std cli avoids. The CLI's only
//! formatting need is decimal `u32` and `usize` for line/column and
//! summary counts. A 30-line hand-rolled formatter covers it.
//!
//! Note: the canonical workspace shape for byte-stream encoding is
//! [`hilavitkutin_api::codec::Encoder`] writing through a
//! [`hilavitkutin_api::sink::ByteEmitter`]. This module is a
//! deliberate deviation, scoped to viola-cli's `#![no_std]`
//! `#![no_main]` host binary, kept because pulling the codec trait
//! family + a sink wrapper around `&mut [u8]` adds linkage overhead
//! the binary explicitly avoids. New host code that already pulls
//! the codec layer in (anything above the cli's argv loop) should
//! prefer `Encoder<T>` over these free functions.

/// Format `n` as decimal into the tail of `buf`. Returns the populated
/// suffix slice. `buf.len()` must be at least 10 for `u32` or 20 for
/// `usize` on 64-bit platforms; callers size buffers to the maximum.
pub fn u32_to_dec<'a>(mut n: u32, buf: &'a mut [u8]) -> &'a [u8] {
    if n == 0 {
        let last = buf.len() - 1;
        buf[last] = b'0';
        return &buf[last..];
    }
    let mut i = buf.len();
    while n > 0 {
        i -= 1;
        buf[i] = b'0' + (n % 10) as u8;
        n /= 10;
    }
    &buf[i..]
}

/// Same as [`u32_to_dec`] for `usize`.
pub fn usize_to_dec<'a>(mut n: usize, buf: &'a mut [u8]) -> &'a [u8] {
    if n == 0 {
        let last = buf.len() - 1;
        buf[last] = b'0';
        return &buf[last..];
    }
    let mut i = buf.len();
    while n > 0 {
        i -= 1;
        buf[i] = b'0' + (n % 10) as u8;
        n /= 10;
    }
    &buf[i..]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_renders_as_zero() {
        let mut buf = [0u8; 10];
        assert_eq!(u32_to_dec(0, &mut buf), b"0");
    }

    #[test]
    fn small_number() {
        let mut buf = [0u8; 10];
        assert_eq!(u32_to_dec(42, &mut buf), b"42");
    }

    #[test]
    fn boundary_max_u32() {
        let mut buf = [0u8; 10];
        assert_eq!(u32_to_dec(u32::MAX, &mut buf), b"4294967295");
    }

    #[test]
    fn usize_renders() {
        let mut buf = [0u8; 20];
        assert_eq!(usize_to_dec(123456, &mut buf), b"123456");
    }
}

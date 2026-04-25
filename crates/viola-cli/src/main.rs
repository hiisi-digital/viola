#![no_std]
#![no_main]

//! `viola-cli` — host executable.
//!
//! `#![no_std]` + `#![no_main]` skeleton. Hand-rolled libc entry to
//! stay off `std`; full implementation (check / build / lint /
//! explain / new / etc.) scheduled for #195 and #169.

use core::panic::PanicInfo;

const MSG: &[u8] =
    b"viola-cli: host wiring scheduled for #195. Use `viola-core` from a downstream embedder until then.\n";

#[cfg(unix)]
#[unsafe(no_mangle)]
pub extern "C" fn main(_argc: i32, _argv: *const *const u8) -> i32 {
    // SAFETY: stderr fd 2; MSG is a static byte slice with stable
    // pointer + length for the process lifetime. libc::write is the
    // documented platform syscall wrapper.
    unsafe {
        libc::write(2, MSG.as_ptr() as *const _, MSG.len());
    }
    2
}

#[cfg(not(unix))]
#[unsafe(no_mangle)]
pub extern "C" fn main(_argc: i32, _argv: *const *const u8) -> i32 {
    2
}

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    #[cfg(unix)]
    // SAFETY: documented libc abort wrapper; never returns.
    unsafe {
        libc::abort();
    }
    #[cfg(not(unix))]
    loop {}
}

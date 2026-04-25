//! Static-trait surface that the proc-macro SDK builds on.
//!
//! These traits are pure metadata holders: associated constants and
//! `unsafe extern "C"` function pointers that the macro picks up at
//! emission time and folds into the descriptor's static tables. They
//! impose no runtime cost and carry no `dyn` dispatch.
//!
//! Plugin authors normally implement these via the `#[export_plugin]`,
//! `#[capability]`, `#[init_handler]`, and `#[shutdown_handler]`
//! attribute macros in `viola-plugin-abi-macros`. Hand-implementing is
//! supported for plugin authors who want to avoid the macro crate.

use core::ffi::c_void;

use crate::capability::CapabilityId;
use crate::error::AbiStatus;

/// A single capability provided by a plugin.
///
/// The macro reads `<T as CapabilityExport>::ID` and
/// `<T as CapabilityExport>::VTABLE_PTR` and folds them into a
/// [`crate::CapabilityEntry`] in the descriptor's capability table.
///
/// `VTABLE_PTR` points at a plugin-owned `#[repr(C)]` struct of
/// function pointers whose layout matches the capability's contract.
/// The capability contract crate (or sub-module) defines that layout;
/// `viola-plugin-abi` treats it as opaque.
pub trait CapabilityExport {
    const ID: CapabilityId;
    const VTABLE_PTR: *const c_void;
}

/// Init lifecycle handler.
///
/// `host_ctx` is a host-allocated opaque pointer threaded through to
/// matching shutdown calls. Plugins MAY ignore it.
///
/// # Safety
///
/// `host_ctx` is host-owned and stable until the matching `shutdown`
/// returns. Implementors MUST NOT free it.
pub trait InitHandler {
    /// # Safety
    ///
    /// See [`InitHandler`].
    unsafe extern "C" fn init(host_ctx: *mut c_void) -> AbiStatus;
}

/// Shutdown lifecycle handler.
///
/// # Safety
///
/// `host_ctx` is the same opaque pointer passed at init. Implementors
/// MUST NOT free it.
pub trait ShutdownHandler {
    /// # Safety
    ///
    /// See [`ShutdownHandler`].
    unsafe extern "C" fn shutdown(host_ctx: *mut c_void) -> AbiStatus;
}

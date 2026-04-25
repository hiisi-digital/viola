//! Status codes, error categories, and the structured error envelope.
//!
//! The C-ABI boundary uses [`AbiStatus`] (a `#[repr(u32)]` enum) for
//! all init / shutdown / capability invocation returns. Non-`Ok`
//! statuses are mapped by the host into the richer [`PluginError`]
//! categories for diagnostic display and policy decisions (fail-closed
//! vs fail-open).
//!
//! [`StructuredError`] is the wire shape for the normative error
//! envelope from `docs/PLUGIN-ABI-V1-DESIGN.md` §11
//! (`code`, `message`, `details`, `retryable`). Plugins MAY populate
//! it on failure paths that need richer context than `AbiStatus`
//! alone; the host serializes it for output.

use core::ffi::c_void;

use crate::bytes_ref::BytesRef;

/// C-ABI status returned by every plugin function pointer.
///
/// `#[repr(u32)]` so it transits as a plain word. The host wraps a
/// non-`Ok` status into a [`StructuredError`] alongside the originating
/// plugin id and capability id for actionable diagnostics.
#[repr(u32)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum AbiStatus {
    Ok = 0,
    /// Initialization could not complete; plugin is unusable.
    InitFailed = 1,
    /// One or more arguments did not satisfy the capability contract.
    InvalidArg = 2,
    /// The capability is recognised but not supported by this build.
    NotSupported = 3,
    /// Internal plugin error; host treats as opaque.
    Internal = 4,
    /// Resource budget (memory, time, descriptor count) exceeded.
    ResourceExhausted = 5,
    /// Plugin reports a transient failure; host policy decides retry.
    Transient = 6,
}

impl AbiStatus {
    pub const fn is_ok(self) -> bool {
        matches!(self, Self::Ok)
    }
}

/// Structured error category the host raises when load or invocation
/// fails. Each variant maps onto an [`AbiStatus`] or onto a host-side
/// validation outcome that has no equivalent on the wire.
///
/// `#[repr(u32)]` so it can travel through structured error envelopes.
#[repr(u32)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum PluginError {
    /// Required exported symbol was missing from the library.
    DescriptorMissing = 1,
    /// Descriptor pointer was null.
    DescriptorNull = 2,
    /// Plugin's `abi_version` major differs from
    /// [`crate::HOST_ABI_MAJOR`].
    AbiVersionMismatch = 3,
    /// Manifest version major differs from any version this host can
    /// read.
    ManifestVersionMismatch = 4,
    /// NAM model version is incompatible (major mismatch).
    ModelVersionMismatch = 5,
    /// Declared role bit lacks the required capability id in the
    /// capability table.
    RoleCapabilityMissing = 6,
    /// Plugin requires a host capability the host does not advertise.
    HostCapabilityMissing = 7,
    /// Init handler returned non-`Ok`.
    InitFailed = 8,
    /// Shutdown handler returned non-`Ok`.
    ShutdownFailed = 9,
    /// A capability invocation returned non-`Ok`.
    InvocationFailed = 10,
    /// Configuration could not be resolved or validated.
    ConfigInvalid = 11,
    /// Generic structured error; details carried out-of-band.
    Internal = 99,
}

/// Wire shape of the normative error envelope.
///
/// The four fields match `docs/PLUGIN-ABI-V1-DESIGN.md` §11 exactly:
/// `code`, `message`, `details`, `retryable`. Plugins that need to
/// surface richer error context than [`AbiStatus`] alone allows
/// populate this struct, store it in plugin-owned static memory, and
/// expose its address through a capability that returns
/// `*const StructuredError`. The host policy layer then decides
/// fail-closed vs fail-open based on the `retryable` flag.
///
/// `details_schema` follows the same pattern as
/// [`crate::Diagnostic::metadata_schema`]: an FNV-1a hash of the
/// schema name behind `details_ptr` / `details_len`. Zero signals
/// absent details.
///
/// `retryable` is `u8` (0 or 1) on the wire so the layout is stable
/// across platforms; it does NOT travel as Rust `bool`.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct StructuredError {
    pub code: PluginError,
    pub message: BytesRef,
    pub details_schema: u64,
    pub details_ptr: *const c_void,
    pub details_len: usize,
    pub retryable: u8,
    /// Reserved for future flag bits. Must be zero on emission.
    pub _reserved: [u8; 3],
}

// SAFETY: pointers reference plugin-owned static memory; host reads.
unsafe impl Send for StructuredError {}
unsafe impl Sync for StructuredError {}

//! Status codes returned by ABI calls and structured error categories.
//!
//! The C-ABI boundary uses [`AbiStatus`] (a `#[repr(u32)]` enum) for
//! all init / shutdown / capability invocation returns. Non-`Ok`
//! statuses are mapped by the host into the richer [`PluginError`]
//! categories for diagnostic display and policy decisions (fail-closed
//! vs fail-open).

/// C-ABI status returned by every plugin function pointer.
///
/// `#[repr(u32)]` so it transits as a plain word. The host wraps a
/// non-`Ok` status into a [`PluginError`] alongside the originating
/// plugin id and capability id for actionable diagnostics.
#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
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
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum PluginError {
    /// Required exported symbol was missing from the library.
    DescriptorMissing = 1,
    /// Descriptor pointer was null.
    DescriptorNull = 2,
    /// Plugin's `abi_version` major differs from [`super::HOST_ABI_MAJOR`].
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

//! ABI, manifest, and plugin version primitives plus compatibility rules.
//!
//! Three orthogonal version axes flow across the ABI boundary:
//!
//! 1. [`AbiVersion`]: the wire-shape contract between host and plugin
//!    (this crate's `1`).
//! 2. [`ManifestVersion`]: the manifest schema the plugin's static
//!    metadata follows.
//! 3. [`PluginVersion`]: the plugin's own semver, opaque to the host
//!    except for diagnostic display.
//!
//! NAM model versioning is a fourth axis; see [`crate::NamVersion`].

/// Three-component semver record.
///
/// `#[repr(C)]` POD so it crosses the boundary by value. The reserved
/// `u16` slot is currently zero; future minor revisions may use it for
/// build-kind or pre-release flags without changing layout.
#[repr(C)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct VersionTriple {
    pub major: u16,
    pub minor: u16,
    pub patch: u16,
    pub _reserved: u16,
}

impl VersionTriple {
    pub const fn new(major: u16, minor: u16, patch: u16) -> Self {
        Self { major, minor, patch, _reserved: 0 }
    }

    /// Whether `self` is compatible with `other` under
    /// equal-major-and-self-greater-or-equal-minor rules.
    ///
    /// This is the rule for **manifest** and **plugin** version
    /// comparisons, where additive minor revisions are accepted. ABI
    /// version compatibility is major-only and uses
    /// [`AbiVersion::is_compatible_with`]; do not use this helper for
    /// ABI checks.
    pub const fn is_compatible_with(self, other: Self) -> bool {
        self.major == other.major && self.minor >= other.minor
    }
}

/// Wire-shape contract version for the viola plugin ABI.
///
/// Plugins declare which ABI major they target via
/// [`PluginDescriptor::abi_version`](crate::PluginDescriptor). The host
/// rejects any plugin whose major differs from [`HOST_ABI_MAJOR`].
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct AbiVersion(pub u32);

impl AbiVersion {
    /// Whether the host ABI version is compatible with a plugin
    /// declaring `plugin_major`.
    ///
    /// Per `docs/PLUGIN-ABI-V1-DESIGN.md` §3.2: ABI compatibility is
    /// **major-equality only**. Minor and patch components are not
    /// part of the ABI version axis at the wire shape; they are
    /// carried for diagnostic display only.
    pub const fn is_compatible_with(self, plugin_major: u32) -> bool {
        self.0 == plugin_major
    }
}

/// Major component of the ABI version this crate speaks.
///
/// v1 of the contract. Bumping the major is a breaking change to the
/// wire shapes of any `#[repr(C)]` type in this crate.
pub const HOST_ABI_MAJOR: u32 = 1;

/// The full ABI version string this crate speaks.
///
/// Plugins built against this crate compare the value of
/// `PluginDescriptor::abi_version` against `VIOLA_ABI_VERSION` and
/// fail-fast on mismatch.
pub const VIOLA_ABI_VERSION: AbiVersion = AbiVersion(HOST_ABI_MAJOR);

/// Manifest schema version reported by the plugin's static metadata.
///
/// The host validates `manifest_version` major equals what it knows how
/// to read; minor differences are accepted (additive fields only).
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct ManifestVersion(pub VersionTriple);

/// Plugin's own semver, opaque to the host except for diagnostic
/// display and dependency resolution between plugins.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct PluginVersion(pub VersionTriple);

//! Load-time validation of a `PluginDescriptor` per
//! `docs/PLUGIN-ABI-V1-DESIGN.md` §4.3.
//!
//! Six validation paths, each producing a distinct
//! [`viola_plugin_abi::PluginError`] category on failure:
//!
//! 1. **AbiVersionMismatch** — `descriptor.abi_version` major must equal
//!    [`viola_plugin_abi::HOST_ABI_MAJOR`]. Comparison uses
//!    [`viola_plugin_abi::AbiVersion::is_compatible_with`] (major-only),
//!    NOT `VersionTriple::is_compatible_with` (which is for manifest /
//!    plugin version axes with looser minor rules).
//! 2. **ManifestVersionMismatch** — manifest major outside what the host
//!    knows how to read.
//! 3. **ModelVersionMismatch** — NAM produces / consumes versions
//!    outside what the host can pair runner→lints across. v1 host
//!    speaks NAM 1.x; major drift fails.
//! 4. **RoleCapabilityMissing** — role bit declared without the
//!    corresponding well-known capability id present in the table.
//! 5. **HostCapabilityMissing** — plugin's `required_host_caps` lists a
//!    capability the host does not advertise via [`crate::HostContext`].
//! 6. **DescriptorMissing / DescriptorNull** — handled in
//!    [`crate::loader`]; included here for completeness of the §4.3
//!    surface.
//!
//! [`PluginError::ConfigInvalid`] is reserved for configuration-load
//! failures handled in [`crate::resolution`]; it is not part of the §4.3
//! load-time check.

use viola_plugin_abi::{
    CapabilityId, PluginDescriptor, PluginError, Role, AbiVersion,
    CAP_GRAMMAR_EXTRACT, CAP_LINT_EVALUATE, CAP_RUNNER_EXECUTE_SCOPE,
    HOST_ABI_MAJOR,
};

use crate::context::HostContext;
use crate::error::{HostError, Result};

/// Manifest major versions this v1 host can read. Adding entries is
/// an ABI-stable operation (manifest schema is allowed to add fields
/// within a major).
const HOST_MANIFEST_MAJORS_SUPPORTED: &[u16] = &[1];

/// NAM model majors this v1 host can pair runner→lints across.
const HOST_NAM_MAJORS_SUPPORTED: &[u16] = &[1];

/// Run all six §4.3 checks against a descriptor.
///
/// Errors carry the plugin id (when readable) and the originating
/// path so the host's diagnostic boundary can emit a structured error.
pub fn validate_descriptor(
    desc: &PluginDescriptor,
    path: &std::path::Path,
    host: &HostContext,
) -> Result<()> {
    let plugin_id = read_plugin_id(desc);

    check_abi_version(desc, host, &plugin_id, path)?;
    check_manifest_version(desc, &plugin_id, path)?;
    check_nam_versions(desc, &plugin_id, path)?;
    check_role_capability_table(desc, &plugin_id, path)?;
    check_required_host_caps(desc, host, &plugin_id, path)?;

    Ok(())
}

fn check_abi_version(
    desc: &PluginDescriptor,
    host: &HostContext,
    plugin_id: &str,
    path: &std::path::Path,
) -> Result<()> {
    if !host.abi_version.is_compatible_with(desc.abi_version) {
        return Err(HostError::from_descriptor(
            PluginError::AbiVersionMismatch,
            plugin_id,
            path,
            format!(
                "plugin abi major {} incompatible with host abi major {}",
                desc.abi_version, HOST_ABI_MAJOR,
            ),
        ));
    }
    let _ = AbiVersion(desc.abi_version);
    Ok(())
}

fn check_manifest_version(
    desc: &PluginDescriptor,
    plugin_id: &str,
    path: &std::path::Path,
) -> Result<()> {
    let major = desc.manifest_version.0.major;
    if !HOST_MANIFEST_MAJORS_SUPPORTED.contains(&major) {
        return Err(HostError::from_descriptor(
            PluginError::ManifestVersionMismatch,
            plugin_id,
            path,
            format!(
                "manifest major {major} not supported (host reads majors {HOST_MANIFEST_MAJORS_SUPPORTED:?})",
            ),
        ));
    }
    Ok(())
}

fn check_nam_versions(
    desc: &PluginDescriptor,
    plugin_id: &str,
    path: &std::path::Path,
) -> Result<()> {
    if desc.roles.contains(Role::Runner) {
        let major = desc.nam_produces.0.major;
        if major != 0 && !HOST_NAM_MAJORS_SUPPORTED.contains(&major) {
            return Err(HostError::from_descriptor(
                PluginError::ModelVersionMismatch,
                plugin_id,
                path,
                format!(
                    "runner produces NAM major {major}; host pairs against {HOST_NAM_MAJORS_SUPPORTED:?}",
                ),
            ));
        }
    }
    if desc.roles.contains(Role::Lint) {
        let major = desc.nam_consumes.0.major;
        if major != 0 && !HOST_NAM_MAJORS_SUPPORTED.contains(&major) {
            return Err(HostError::from_descriptor(
                PluginError::ModelVersionMismatch,
                plugin_id,
                path,
                format!(
                    "lint consumes NAM major {major}; host pairs against {HOST_NAM_MAJORS_SUPPORTED:?}",
                ),
            ));
        }
    }
    Ok(())
}

fn check_role_capability_table(
    desc: &PluginDescriptor,
    plugin_id: &str,
    path: &std::path::Path,
) -> Result<()> {
    let caps = capability_ids(desc);

    if desc.roles.contains(Role::Runner)
        && !caps.iter().any(|c| c.0 == CAP_RUNNER_EXECUTE_SCOPE.0)
    {
        return Err(HostError::from_descriptor(
            PluginError::RoleCapabilityMissing,
            plugin_id,
            path,
            "runner role declared but viola.runner.execute_scope.v1 capability absent",
        ));
    }
    if desc.roles.contains(Role::Grammar)
        && !caps.iter().any(|c| c.0 == CAP_GRAMMAR_EXTRACT.0)
    {
        return Err(HostError::from_descriptor(
            PluginError::RoleCapabilityMissing,
            plugin_id,
            path,
            "grammar role declared but viola.grammar.extract.v1 capability absent",
        ));
    }
    if desc.roles.contains(Role::Lint)
        && !caps.iter().any(|c| c.0 == CAP_LINT_EVALUATE.0)
    {
        return Err(HostError::from_descriptor(
            PluginError::RoleCapabilityMissing,
            plugin_id,
            path,
            "lint role declared but viola.lint.evaluate.v1 capability absent",
        ));
    }
    Ok(())
}

fn check_required_host_caps(
    desc: &PluginDescriptor,
    host: &HostContext,
    plugin_id: &str,
    path: &std::path::Path,
) -> Result<()> {
    // Guard both the zero-length case AND a null pointer with non-zero
    // length (a malformed or adversarial descriptor): `from_raw_parts`
    // is UB on a null pointer regardless of length.
    if desc.required_host_caps_ptr.is_null()
        || desc.required_host_caps_len == 0
    {
        return Ok(());
    }
    // SAFETY: ptr verified non-null above; len verified non-zero. The
    // descriptor contract pins this slice to plugin-owned static
    // memory stable for the loaded library's lifetime.
    let required: &[CapabilityId] = unsafe {
        core::slice::from_raw_parts(
            desc.required_host_caps_ptr,
            desc.required_host_caps_len,
        )
    };
    for cap in required {
        if !host.advertises(*cap) {
            return Err(HostError::from_descriptor(
                PluginError::HostCapabilityMissing,
                plugin_id,
                path,
                format!(
                    "plugin requires host cap {:#x} which the host does not advertise",
                    cap.0,
                ),
            ));
        }
    }
    Ok(())
}

/// Read the descriptor's `plugin_id` from its `BytesRef`, falling back
/// to an empty string on malformed pointers (defensive: a zero-length
/// id is permitted by the layout but unusual).
pub(crate) fn read_plugin_id(desc: &PluginDescriptor) -> String {
    let r = desc.identity.plugin_id;
    if r.data.is_null() || r.len == 0 {
        return String::new();
    }
    // SAFETY: ptr verified non-null and len verified non-zero above.
    // Plugin-owned static memory stable for the library's lifetime;
    // bytes are copied out via `from_utf8_lossy`.
    let bytes = unsafe { core::slice::from_raw_parts(r.data, r.len) };
    String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use viola_plugin_abi::{
        BytesRef, CapabilityEntry, ManifestVersion, NamVersion,
        PluginIdentity, PluginVersion, RoleSet, VersionTriple,
    };

    fn fake_path() -> PathBuf {
        PathBuf::from("/synthetic/test/plugin.dylib")
    }

    fn host_with_caps(caps: Vec<CapabilityId>) -> HostContext {
        HostContext::new(PathBuf::from("/tmp")).with_host_caps(caps)
    }

    /// Build a minimal descriptor for tests. All slots default to
    /// values the host accepts; tests mutate the one field under test.
    fn baseline_descriptor() -> PluginDescriptor {
        const ID: &[u8] = b"org.viola.test.synthetic";
        const NAME: &[u8] = b"Synthetic";
        PluginDescriptor {
            abi_version: HOST_ABI_MAJOR,
            manifest_version: ManifestVersion(VersionTriple::new(1, 0, 0)),
            identity: PluginIdentity {
                plugin_id: BytesRef { data: ID.as_ptr(), len: ID.len() },
                display_name: BytesRef { data: NAME.as_ptr(), len: NAME.len() },
                plugin_version: PluginVersion(VersionTriple::new(0, 1, 0)),
            },
            roles: RoleSet::EMPTY,
            capabilities_ptr: core::ptr::null(),
            capabilities_len: 0,
            nam_produces: NamVersion(VersionTriple::new(0, 0, 0)),
            nam_consumes: NamVersion(VersionTriple::new(0, 0, 0)),
            required_host_caps_ptr: core::ptr::null(),
            required_host_caps_len: 0,
            config_schema: BytesRef::EMPTY,
            init_fn: None,
            shutdown_fn: None,
        }
    }

    #[test]
    fn baseline_descriptor_validates() {
        let desc = baseline_descriptor();
        let host = host_with_caps(Vec::new());
        validate_descriptor(&desc, &fake_path(), &host).expect("baseline ok");
    }

    #[test]
    fn abi_version_major_mismatch_rejected() {
        let mut desc = baseline_descriptor();
        desc.abi_version = HOST_ABI_MAJOR + 1;
        let host = host_with_caps(Vec::new());
        let err = validate_descriptor(&desc, &fake_path(), &host)
            .expect_err("must reject");
        assert_eq!(err.kind, PluginError::AbiVersionMismatch);
    }

    #[test]
    fn manifest_major_mismatch_rejected() {
        let mut desc = baseline_descriptor();
        desc.manifest_version = ManifestVersion(VersionTriple::new(99, 0, 0));
        let host = host_with_caps(Vec::new());
        let err = validate_descriptor(&desc, &fake_path(), &host)
            .expect_err("must reject");
        assert_eq!(err.kind, PluginError::ManifestVersionMismatch);
    }

    #[test]
    fn nam_consumes_major_mismatch_rejected() {
        let mut desc = baseline_descriptor();
        desc.roles = RoleSet::single(Role::Lint);
        desc.nam_consumes = NamVersion(VersionTriple::new(2, 0, 0));
        // capability table will fail role-cap check before NAM in the
        // current ordering; add the lint cap entry first to isolate.
        let entries: &'static [CapabilityEntry] = &[CapabilityEntry {
            id: CAP_LINT_EVALUATE,
            vtable_ptr: core::ptr::null(),
        }];
        desc.capabilities_ptr = entries.as_ptr();
        desc.capabilities_len = entries.len();

        let host = host_with_caps(Vec::new());
        let err = validate_descriptor(&desc, &fake_path(), &host)
            .expect_err("must reject");
        assert_eq!(err.kind, PluginError::ModelVersionMismatch);
    }

    #[test]
    fn role_without_capability_rejected() {
        let mut desc = baseline_descriptor();
        desc.roles = RoleSet::single(Role::Runner);
        let host = host_with_caps(Vec::new());
        let err = validate_descriptor(&desc, &fake_path(), &host)
            .expect_err("must reject");
        assert_eq!(err.kind, PluginError::RoleCapabilityMissing);
    }

    #[test]
    fn missing_required_host_cap_rejected() {
        let mut desc = baseline_descriptor();
        const REQUIRED: &[CapabilityId] =
            &[CapabilityId::from_name("host.unknown.cap.v1")];
        desc.required_host_caps_ptr = REQUIRED.as_ptr();
        desc.required_host_caps_len = REQUIRED.len();

        let host = host_with_caps(Vec::new());
        let err = validate_descriptor(&desc, &fake_path(), &host)
            .expect_err("must reject");
        assert_eq!(err.kind, PluginError::HostCapabilityMissing);
    }

    #[test]
    fn declared_required_host_cap_satisfied() {
        let mut desc = baseline_descriptor();
        let cap = CapabilityId::from_name("host.known.cap.v1");
        let required: &[CapabilityId] = &[cap];
        desc.required_host_caps_ptr = required.as_ptr();
        desc.required_host_caps_len = required.len();

        let host = host_with_caps(vec![cap]);
        validate_descriptor(&desc, &fake_path(), &host).expect("ok");
    }
}

/// Read the descriptor's capability id table.
pub(crate) fn capability_ids(desc: &PluginDescriptor) -> Vec<CapabilityId> {
    if desc.capabilities_ptr.is_null() || desc.capabilities_len == 0 {
        return Vec::new();
    }
    // SAFETY: ptr verified non-null and len verified non-zero above.
    // The descriptor contract pins this slice to plugin-owned static
    // memory stable for the library's loaded lifetime.
    let entries = unsafe {
        core::slice::from_raw_parts(
            desc.capabilities_ptr,
            desc.capabilities_len,
        )
    };
    entries.iter().map(|e| e.id).collect()
}

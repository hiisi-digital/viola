//! Plugin path resolution per `docs/PLUGIN-ABI-V1-DESIGN.md` §16.3.
//!
//! Three-tier precedence (highest first):
//!
//! 1. Explicit plugin paths from resolved config.
//! 2. Explicit environment overrides (`VIOLA_PLUGIN_PATH`, colon-
//!    separated on Unix, semicolon-separated on Windows).
//! 3. Host / CLI default plugin directories.
//!
//! Missing required plugins MUST produce structured fail-closed errors
//! by default; the policy decision is left to the caller because the
//! "required" axis is configuration-controlled. This module's
//! responsibility is path discovery only; the caller composes
//! discovery with config to decide what to load.

use std::path::{Path, PathBuf};

/// Environment variable the host honors for plugin path overrides.
pub const PLUGIN_PATH_ENV: &str = "VIOLA_PLUGIN_PATH";

#[cfg(unix)]
const PATH_SEP: char = ':';
#[cfg(windows)]
const PATH_SEP: char = ';';

/// Inputs the host folds into a resolved plugin path list.
#[derive(Debug, Default, Clone)]
pub struct ResolutionInputs {
    /// Tier 1: explicit paths from resolved config (e.g. `viola.toml`).
    pub config_paths: Vec<PathBuf>,
    /// Tier 3: host or CLI default plugin directories. Searched only
    /// after config and env tiers.
    pub default_dirs: Vec<PathBuf>,
}

/// Resolved plugin path list, ordered by §16.3 precedence.
///
/// Paths are returned as the host found them. The caller is responsible
/// for deduplicating, expanding directories, and filtering by platform
/// dylib extension.
pub fn resolve(inputs: &ResolutionInputs) -> Vec<PathBuf> {
    let mut out = Vec::new();
    out.extend(inputs.config_paths.iter().cloned());
    out.extend(env_paths());
    out.extend(inputs.default_dirs.iter().cloned());
    out
}

fn env_paths() -> Vec<PathBuf> {
    match std::env::var(PLUGIN_PATH_ENV) {
        Ok(s) if !s.is_empty() => {
            s.split(PATH_SEP).map(PathBuf::from).collect()
        }
        _ => Vec::new(),
    }
}

/// Platform-correct cdylib filename for a plugin's bare name.
///
/// Plugins are named `<bare>` and their compiled artefact is
/// `lib<bare>.dylib` on macOS, `lib<bare>.so` on Linux,
/// `<bare>.dll` on Windows. Cargo's cdylib emit strips a leading
/// underscore from the crate name; this helper does not — pass the
/// already-mangled name when calling.
pub fn cdylib_filename(bare_name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{bare_name}.dll")
    } else if cfg!(target_os = "macos") {
        format!("lib{bare_name}.dylib")
    } else {
        format!("lib{bare_name}.so")
    }
}

/// Search a directory for a plugin's cdylib by bare name.
pub fn find_in_dir(dir: &Path, bare_name: &str) -> Option<PathBuf> {
    let candidate = dir.join(cdylib_filename(bare_name));
    if candidate.is_file() { Some(candidate) } else { None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn precedence_is_config_then_env_then_defaults() {
        let inputs = ResolutionInputs {
            config_paths: vec![PathBuf::from("/cfg/a")],
            default_dirs: vec![PathBuf::from("/def/b")],
        };
        // SAFETY: This test mutates a process-global env var. It runs
        // single-threaded under cargo test by default for this module
        // when no other test reads PLUGIN_PATH_ENV; we accept that
        // limitation rather than gating the test.
        unsafe {
            std::env::set_var(PLUGIN_PATH_ENV, "/env/x");
        }
        let r = resolve(&inputs);
        unsafe {
            std::env::remove_var(PLUGIN_PATH_ENV);
        }
        assert_eq!(r[0], PathBuf::from("/cfg/a"));
        assert_eq!(r[1], PathBuf::from("/env/x"));
        assert_eq!(r[2], PathBuf::from("/def/b"));
    }

    #[test]
    fn cdylib_filename_platform_aware() {
        let n = cdylib_filename("viola_test_plugin_fixture");
        if cfg!(target_os = "windows") {
            assert!(n.ends_with(".dll"));
        } else if cfg!(target_os = "macos") {
            assert!(n.starts_with("lib") && n.ends_with(".dylib"));
        } else {
            assert!(n.starts_with("lib") && n.ends_with(".so"));
        }
    }
}

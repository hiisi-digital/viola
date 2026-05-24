//! Resource value types for viola's hilavitkutin pipeline.
//!
//! Slice 2a ships the field-bearing shapes the body slices need.
//! `Workspace` carries the workspace path as a `Str` handle interned
//! in the host shim's long-lived interner. `CiState` carries CI flags
//! and the invoking-agent classification.

/// Workspace-context Resource. The `path` is a `Str` handle into the
/// host shim's long-lived interner (registered at scheduler-builder
/// time; not exposed as a scheduler Resource per the Slice 2 DOC CL).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct Workspace {
    /// Absolute workspace root, interned by the host shim's long-lived
    /// string interner. The interner is registered at scheduler-builder
    /// time (not as a scheduler-side `Resource`); the `Str` handle is
    /// valid for the duration of the scheduler run.
    pub path: hilavitkutin_str::Str,
}

/// CI-invocation-context Resource. The host shim sets these fields at
/// scheduler-builder time based on environment detection.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct CiState {
    pub is_ci: arvo::Bool,
    pub agent: AgentKind,
}

impl Default for CiState {
    fn default() -> Self {
        Self {
            is_ci: arvo::Bool::FALSE,
            agent: AgentKind::Unknown,
        }
    }
}

/// Classifies the invoking actor behind a viola run. Detected from
/// environment by the host shim; absence of signal stays as `Unknown`.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum AgentKind {
    /// No detection signal yet (the safer default).
    #[default]
    Unknown,
    /// Host shim positively determined no agent is involved.
    None,
    /// A human invoked viola directly.
    Human,
    /// A bot or automation invoked viola.
    Bot,
}

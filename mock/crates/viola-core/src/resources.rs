//! Resource value types for viola's hilavitkutin pipeline.
//!
//! Slice 1 ships these as `Copy` zero-sized structs so the WU stubs
//! that read or write them via `Resource<T>` type-check. Real fields
//! land per the body slice that first needs each.

/// Workspace-context Resource. Slice 2 (LoadConfig body) adds the
/// `path: hilavitkutin_str::Str` and `surface: viola_plugin_abi::RunSurface`
/// fields once those deps enter the viola-core graph.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct Workspace;

/// CI-invocation-context Resource. Slice 2 adds the `is_ci: arvo::Bool`
/// flag and `agent: AgentKind` enum once `AgentKind` is defined.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct CiState;

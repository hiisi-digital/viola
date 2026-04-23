# Viola Rust crates (planned)

This directory is the planned Rust-side crate workspace for Viola’s host/plugin architecture.

## Status

Planned scaffold only.  
No implementation is required here yet.

The active design source of truth is:

- `../docs/PLUGIN-ABI-V1-DESIGN.md`

## Why this exists

Viola is moving to a host-loaded plugin model with a strict, stable ABI contract.

This `crates/` directory will contain the Rust crates that define and host that contract, while keeping responsibilities clearly separated.

## Planned crates

## `viola-plugin-abi`

Purpose:

- Define the stable plugin ABI contract surface used by host and plugins.
- Hold shared contract constants and type definitions.
- Prevent contract drift between host and plugin implementations.

Expected contents (high-level):

- ABI/version constants
- Role identifiers (`runner`, `grammar`, `lint`)
- Descriptor/manifest-aligned contract structs
- Error code model and structured load/invoke failure types
- FFI-safe contract types for load/lifecycle boundaries
- Normative symbol naming constants

This crate should be minimal and stable-first.

## `viola-host` (name under consideration; previously referred to as `viola-core`)

Purpose:

- Implement the in-process host runtime that loads and executes ABI-conforming plugins.
- Run the config-driven execution lifecycle:
  - resolve config
  - load/validate plugins
  - execute runner once per scope
  - fan out lints over normalized analysis model
  - aggregate diagnostics

Expected contents (high-level):

- Plugin discovery/loading integration
- Strict load-time ABI validation
- Role dispatch orchestration
- Run lifecycle and deterministic diagnostics aggregation
- Host error/reporting behavior for load/invoke failures

### Naming note

`viola-host` may be clearer than `viola-core` for this crate, because it directly describes the crate’s role as plugin host runtime. Final naming can be decided after workspace shape is finalized.

## Relationship to existing TS/Deno side

This Rust crate workspace does **not** replace the TS/Deno ecosystem surface.

Current intended packaging direction:

- `viola-cli` runs the host runtime and attaches plugins
- TS-side `viola` package provides TS-facing ecosystem surfaces and bridge artifacts
- Rust-native plugins implement ABI directly without bridge requirements

## Non-goals for this directory (for now)

- No runtime implementation yet
- No ABI finalization here beyond what is already documented
- No speculative extra crates until the first two crate boundaries are locked

## Next step

When implementation starts:

1. Create `viola-plugin-abi` first (contract-first).
2. Create `viola-host` using that ABI crate.
3. Keep this README synchronized with `PLUGIN-ABI-V1-DESIGN.md` as decisions evolve.
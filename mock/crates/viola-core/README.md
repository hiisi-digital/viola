# `viola-core`

Status: placeholder (design-first, implementation pending)

## Purpose

`viola-core` is the native **host runtime** crate for Viola’s plugin
architecture.

It is responsible for:

- loading ABI-conforming native plugins (as strict `cdylib` binaries) in-process
  via explicit symbol extraction
- validating plugin compatibility and required shape at load time
- orchestrating the config-driven execution lifecycle
- running configured runner pipelines once per scope
- dispatching lint passes over the shared normalized analysis model
- aggregating and returning deterministic diagnostics

This crate is the host/orchestration layer, not the ABI definition crate.

## Scope (planned)

Planned responsibilities include:

- plugin discovery integration from resolved config (pull-based, no
  `inventory`/linker magic)
- plugin loading/linking integration (enforcing `cdylib` optimization barriers)
- strict load-time ABI validation
- plugin lifecycle management (`initialize`, role invocation, `shutdown`)
- run planning and execution orchestration
- normalized analysis model handoff to lint plugins
- diagnostics aggregation/sorting
- structured host-side error handling and failure policy behavior

## Non-goals

`viola-core` should **not** own:

- ABI type/source-of-truth definitions (belongs in `viola-plugin-abi`)
- language-specific parser internals
- lint rule implementations
- grammar implementation logic
- TS ecosystem packaging concerns
- external CLI UX details beyond host runtime integration points

## Contract relationship

`viola-core` depends on `viola-plugin-abi` for the stable plugin contract
surface.

Expected direction:

- `viola-core` consumes ABI definitions
- native plugins consume ABI definitions
- both sides compile against the same ABI crate to prevent contract drift

## Position in architecture

In the current design profile:

- `viola-core` = host runtime
- `viola-cli` = executable that runs `viola-core` and attaches plugins
- TS/Deno side integrates via bridge plugin artifacts
- Rust-native plugins fulfill ABI directly

## Source of truth

Current design authority:

- `../../docs/PLUGIN-ABI-V1-DESIGN.md`

This README should remain synchronized with that design as it evolves.

## Next steps (when implementation starts)

1. define crate skeleton and module boundaries
2. wire ABI-aware loader and validation path
3. implement lifecycle orchestration
4. implement runner-once + lint-fanout execution pipeline
5. add deterministic aggregation and compatibility/failure tests

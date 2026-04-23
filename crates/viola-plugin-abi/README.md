# `viola-plugin-abi`

Status: placeholder (design-first, implementation pending)

## Purpose

`viola-plugin-abi` is the canonical Rust crate for the **stable Plugin ABI** shared between:

- the Viola host runtime (currently documented as `viola-core` / host layer), and
- all native plugins (`runner`, `grammar`, `lint`) loaded by that host.

This crate exists to prevent ABI drift and to keep host/plugin contracts explicit, versioned, and testable. It enforces a strict `cdylib` C-ABI boundary while preserving safe Rust ergonomics for plugin authors via macro-driven static monomorphization.

## Scope (planned)

This crate will contain only ABI contract surface, not runtime/plugin-loader behavior.

Planned contents include:

- ABI version constants and compatibility helpers
- stable exported symbol identifiers
- role identifiers (`runner`, `grammar`, `lint`)
- plugin descriptor structures
- lifecycle contract structures (`init`, `invoke`, `shutdown`)
- operation tables for role-specific functions
- shared error/result codes and envelope structures
- memory ownership and boundary rules for host/plugin interaction
- schema/version markers for normalized model compatibility
- procedural macros (e.g., `#[export_plugin]`) for static monomorphization of generic Rust traits into `extern "C"` function pointers

## Non-goals

This crate should **not** contain:

- dynamic loading/linking machinery
- plugin discovery logic
- host orchestration logic
- grammar parsing logic
- lint execution logic
- CLI concerns

Those belong in host/runtime crates and supporting infrastructure crates.

## Source of truth

Current design authority is:

- `docs/PLUGIN-ABI-V1-DESIGN.md`

This README is intentionally minimal and should evolve only in lockstep with that design.

## Intended relationships

Planned dependency direction:

- host/runtime crate depends on `viola-plugin-abi`
- native plugin crates depend on `viola-plugin-abi`
- both sides compile against the same ABI definitions to ensure strict shape compatibility

## Initial crate policy

Until implementation starts:

1. Keep this crate as a documented placeholder.
2. Avoid speculative API additions outside the design doc.
3. Treat ABI compatibility discipline as the primary constraint.
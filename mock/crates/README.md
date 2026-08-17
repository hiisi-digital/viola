# Viola Rust crates

This directory is the Rust-side crate workspace for Viola's host and plugin architecture. The
workspace manifest is `../Cargo.toml`; the design source of truth is
`../../docs/PLUGIN-ABI-V1-DESIGN.md`.

## Status

Implemented. Five crates ship the host runtime, the plugin contract, the config parser, the CLI and
the Deno bridge plugin. Two further crates are cdylib fixtures that exercise the plugin shape in
tests and are marked `publish = false`.

The crate naming question this file used to carry is settled: the host runtime crate is
`viola-core`.

## Workspace members

| Crate | Role |
|---|---|
| `viola-plugin-abi` | Plugin contract: viola-specific roles, providers, vtables, NAM, and diagnostics layered over `hilavitkutin-extensions`. |
| `viola-core` | Host runtime: viola-domain layering over `hilavitkutin-extensions` (cdylib loading, lifecycle, provider dispatch, deterministic diagnostic aggregation). |
| `viola-config` | `viola.toml` config schema plus a zero-copy `no_std` `no_alloc` TOML subset parser. Produces `&[u8]` slices into caller-provided input bytes. |
| `viola-cli` | Host CLI executable. `no_std` `no_main` entry on libc; reads `viola.toml`, loads configured plugins via `ExtensionHost`, runs the pipeline, emits sorted diagnostics, exits with status. |
| `viola-deno-runtime` | Plugin that runs TS lint projects through a long-lived sibling deno worker process and bridges results into the v1 plugin ABI. |
| `viola-test-plugin-fixture` | Internal cdylib fixture exercising the v1 plugin shape. Not published. |
| `viola-test-runner-fixture` | Internal cdylib fixture exposing `PROVIDER_RUNNER_EXECUTE_SCOPE`. Pairs with the plugin fixture to exercise `pipeline::run` end to end. Not published. |

## Relationship to the TS and Deno side

This Rust crate workspace does not replace the TS and Deno ecosystem surface.

- `viola-cli` runs the host runtime and attaches plugins.
- The TS-side `viola` package provides the TS-facing ecosystem surfaces and bridge artifacts.
- Rust-native plugins implement the ABI directly, with no bridge involved.

## Dependencies outside this repo

Every crate here depends on `notko`, `arvo` and `hilavitkutin` through git references on their `dev`
branches, declared in `../Cargo.toml`. Those references are what a build resolves against, and no
crates.io release exists to pin instead.

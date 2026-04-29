# `viola-cli`

Host executable for Viola plugin runs. Reads a `viola.toml` config,
loads the configured plugins through `viola-core`'s `ExtensionHost`,
drives the `runner-once` + `lint-fan-out` pipeline against the empty
default `RunScope`, sorts captured diagnostics per
`docs/PLUGIN-ABI-V1-DESIGN.md` §10, and emits one line per diagnostic
to stderr.

`#![no_std]` `#![no_main]` libc entry on unix. No `alloc`, no
`core::fmt`, no formatting infrastructure beyond the decimal converter
in `src/fmt.rs`. Every buffer is fixed-cap and lives on the entry
frame.

## Status

v1 ABI plumbing landed (#193, #194). Configuration parser and v2
schema landing in flight (#221). This crate's role in
PLUGIN-ABI-V1-DESIGN §16.1 is the `native host / CLI distribution`
profile: it ships the host runtime plus optional default plugin
profile wiring.

## Invocation

```
viola-cli [path-to-config.toml] [--gate <name>]
```

Positional config path is optional; defaults to `./viola.toml`. A
second positional is silently ignored (matches typical CLI behaviour
and keeps the parser branch free).

`--gate <name>` selects one of the `[[severity]]` rule's
gate-threshold conditions. Without `--gate`, fall back to v1 semantics:
any diagnostic at all causes a non-zero exit.

There is no `--config <path>` flag yet. The positional form is the
sole way to override the default. Adding `--config` as an alias is
tracked in `TODO.md`.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Config parsed, plugins ran, zero diagnostics (or none above the configured gate). |
| `1` | Config parsed, plugins ran, at least one diagnostic met the gate threshold. |
| `2` | Config could not be read or parsed. |
| `3` | Plugin load or pipeline invocation failed. |
| `127` | Passthrough mode failed to `execvp` deno. POSIX-conventional "command not found". |

`127` is distinct from `3` so tooling that inspects exit codes can
tell "missing runtime" apart from "plugin failed".

## Plugin loading

Two paths.

**v2 schema (`[viola] version = 2`).** Walk the `plugins = [...]` array,
load each plugin through `viola_core::ExtensionHost`, classify by
descriptor capability:

- A descriptor exporting `CAP_RUNNER_EXECUTE_SCOPE` is the runner.
  At most one plugin may export this; the second is a load error.
- A descriptor exporting `CAP_LINT_EVALUATE` is a lint. Multiple lints
  are fine.
- A descriptor exporting both is multi-role and registers in both
  positions.

All loaded plugins live in a single `viola_core::Session<MAX_PLUGINS>`
(currently `MAX_PLUGINS = 16`). The session's `Drop` runs each
plugin's `shutdown_fn` in reverse-insertion order, so shutdown is LIFO
across the run regardless of which plugin failed.

**TS passthrough.** When `[ts]` is present in the config and no Rust
plugins are configured, `viola-cli` `execvp`s `deno run -A
jsr:@hiisi/viola-cli` with the user's argv. The byte-for-byte output
guarantee (stdout, stderr, exit code) is structural; the conformance
test in `tests/passthrough_conformance.rs` locks it in.

A hybrid path (Rust plugins plus TS bridge for `viola-deno-runtime`
loading TS plugins as a `cdylib` in the same process) is designed to
route through the v2 plugin loader once `viola-deno-runtime` is
verified end-to-end. That verification is tracked in #197.

## Plugin resolution precedence

PLUGIN-ABI-V1-DESIGN §16.3 specifies three steps in order:

1. Explicit plugin paths from the resolved config.
2. Explicit environment overrides.
3. Host / CLI default plugin directories.

Today only step 1 is implemented. Steps 2 and 3 are tracked in
`TODO.md`; both need a small design pass to pin the env-var name and
the default directory layout before they land.

Missing required plugins produce a structured fail-closed error
(`EXIT_PLUGIN`).

## Assembly profiles

PLUGIN-ABI-V1-DESIGN §16.1 + §22 names three profiles. `viola-cli`
fits all three by composition.

| Profile | Shape |
|---|---|
| CLI-on-PATH | `viola-cli` installed standalone; loads plugins from a `viola.toml` in the working directory or pointed-at path. |
| Embedded host | A consumer binary embeds `viola-core` directly and skips `viola-cli`. The binary still reads `viola.toml` through `viola-config`. |
| Bundled CLI with app | An application ships `viola-cli` next to its own binary plus a curated default plugin profile. |

Each profile is an explicit composition of the same pieces. There is
no implicit packaging.

## Configuration

Canonical form is TOML; `viola-config` parses it. The TS builder API
emits the same resolved shape (PLUGIN-ABI-V1-DESIGN §17). For
Rust-first consumers, hand-author the TOML.

A minimal v2 config:

```toml
[viola]
version = 2

[[plugins]]
path = "./target/release/libfoo_lint.dylib"
```

Full schema reference, including `[[severity]]` rules and
`[lint.<id>]` per-lint config blocks, lives at `docs/VIOLA-CONFIG.md`
(see also #221 for the v2 schema design).

## Tests

```bash
cargo test -p viola-cli
```

Currently:

- `tests/passthrough_conformance.rs`: TS passthrough byte-equality
  guarantee.

A Rust-plugin smoke test using the workspace's
`viola-test-plugin-fixture` and `viola-test-runner-fixture` cdylibs
is tracked in `TODO.md`.

## Layout

```
crates/viola-cli/
  Cargo.toml
  build.rs       workspace build wiring
  src/
    main.rs      libc entry, arg parsing, runner / lint dispatch, passthrough
    fmt.rs       decimal converter (no core::fmt)
    io.rs        fixed-cap stdio + file read on libc primitives
  tests/
    passthrough_conformance.rs   TS passthrough byte-equality
```

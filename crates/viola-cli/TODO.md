# TODO for `viola-cli`

Status: host wiring landed (#194 merged viola-core, #221 PR-A through
PR-D-2 landed v2 plugin loading and gate-threshold filtering).

## Landed

- [x] `#![no_std]` `#![no_main]` libc entry, fixed-cap buffers, no
      `alloc` (#188, #194).
- [x] Positional config path with `./viola.toml` default (#194).
- [x] `--gate <name>` flag for `[[severity]]` gate-threshold
      filtering (#221 PR-D-2).
- [x] v2 plugin loading: walk `cfg.plugins[]`, classify by descriptor
      capability, load through `ExtensionHost` into `Session` (#221
      PR-D-1).
- [x] Runner-once + lint-fan-out pipeline against empty default
      `RunScope` (#194).
- [x] Diagnostic sort per PLUGIN-ABI-V1-DESIGN §10 then stderr emit
      one line per diagnostic (#194).
- [x] Exit codes: 0/1/2/3 + 127 for passthrough exec failures (#194).
- [x] TS passthrough mode via `libc::execvp` to `deno run -A
      jsr:@hiisi/viola-cli`, byte-for-byte output guarantee, locked
      in by `tests/passthrough_conformance.rs` (#194).
- [x] LIFO plugin shutdown via `Session<MAX_PLUGINS>::Drop` (#194).

## Plugin resolution precedence (§16.3)

PLUGIN-ABI-V1-DESIGN §16.3 names three resolution steps. Only the
first lands today.

- [ ] **Step 2: explicit environment overrides.** Pin the env var
      name (likely `VIOLA_PLUGIN_PATH` plus a singular
      `VIOLA_PLUGIN_RUNNER` for an explicit single-runner override),
      semantics (PATH-style colon-separated list, first match wins),
      and precedence relative to a TOML-declared path. Needs a small
      design pass before it lands.
- [ ] **Step 3: host / CLI default plugin directories.** Pin the
      directory layout (`$XDG_DATA_HOME/viola/plugins`,
      platform-specific fallbacks). Needs a small design pass.
- [ ] Structured fail-closed error when a required plugin is missing
      across all three steps. Today the error path returns
      `EXIT_PLUGIN` on the first load failure; the categorical
      "no resolution path matched" diagnostic should call out which
      steps were checked.

## CLI surface

- [ ] `--config <path>` flag as an alias for the positional. Helpful
      for shells that struggle with positional disambiguation in long
      command chains.
- [ ] `--help` / `-h`. Currently absent because `core::fmt` is not
      linked; the help text would need to live in `src/help.rs` as
      hand-encoded byte slices and be emitted by `io::eprintln`.
- [ ] `--version`. Same constraint as `--help`.

## Tests

- [ ] Rust-plugin smoke test using `viola-test-plugin-fixture` +
      `viola-test-runner-fixture`. Build the cdylibs, write a minimal
      `viola.toml` pointing at them, run `viola-cli`, verify the
      pipeline runs and the diagnostic emit shape matches the §10
      contract.
- [ ] Negative test: missing config produces `EXIT_CONFIG` (2),
      malformed config produces `EXIT_CONFIG` (2), unloadable plugin
      produces `EXIT_PLUGIN` (3).
- [ ] Hybrid-path test: viola.toml declares both `[ts]` and Rust
      plugins; verify v2 plugin loader runs (no passthrough) and
      diagnostics from both surfaces emit through the same channel.

## Documentation

- [ ] `docs/VIOLA-CONFIG.md` (or equivalent) needs to land alongside
      #221's v2 schema work. README link is a forward reference until
      then.
- [ ] When `viola-deno-runtime` reaches stability (#197), document
      the hybrid composition (Rust plugins + TS bridge cdylib) in
      this README under "Plugin loading" with a worked config.

## Cross-task pointers

- #197: TS ecosystem verification through `viola-deno-runtime`.
  Closes the hybrid-path docs gap above.
- #220: rust-native viola plugin (rust-grammar + rust-runner). When
  this lands the README should gain a fully Rust-native worked
  example.
- #221: viola.toml v2 schema. The v2 schema docs are the canonical
  reference for what `viola-cli` parses.
- #198 + #199: viola adoption inside mockspace. After those land,
  `viola-cli` becomes mockspace's primary lint runtime; the
  "Assembly profiles" section gains a fourth row for that
  composition.

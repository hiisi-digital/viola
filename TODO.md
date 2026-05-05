# TODO: Viola implementation roadmap (normalized checklist)

Status: planning + active rollout.
Scope: top-level coordination for Rust host + plugin ABI transition and TS bridge integration.

---

## Phase 1: Design lock

- [x] Lock Plugin ABI v1 decisions in `docs/PLUGIN-ABI-V1-DESIGN.md`
  - [x] Confirm strict in-process host-loaded model
  - [x] Confirm unified roles (`runner`, `grammar`, `lint`)
  - [x] Confirm fail-closed load behavior for required plugins
  - [x] Confirm canonical TOML config + TS builder parity
- [x] Add distribution matrix to design doc
  - [x] Define package/artifact responsibilities (`viola-cli`, TS package, bridge dylibs)
  - [x] Define supported platform matrix (initial targets)
- [x] Freeze naming decisions
  - [x] Confirm crate naming (`viola-core` vs `viola-host`)
  - [x] Confirm plugin/bridge naming conventions

## Phase 2: Repo scaffolding

- [x] Create/maintain `crates/` workspace docs
  - [x] Keep `crates/README.md` aligned with design doc
  - [x] Add missing crate README/TODO placeholders consistently
- [x] Add Rust workspace metadata
  - [x] Top-level Cargo workspace setup for planned crates
  - [x] Lint/format/test baseline config for Rust crates

## Phase 3: Contracts and schemas

- [x] Define ABI contract source files in `viola-plugin-abi` (contract-first)
  - [x] Version constants
  - [x] Role IDs and capability IDs
  - [x] Descriptor and lifecycle contract shapes
  - [x] Structured error/result model
  - [x] Normative symbol constants
- [x] Define host-side schema boundaries
  - [x] Resolved config model schema
  - [x] NAM model schema/version markers
  - [x] Diagnostics schema/version markers

## Phase 4: Host runtime (`viola-core`)

- [x] Implement plugin loading pipeline (using shared extension/plugin machinery later)
  - [x] Discovery inputs from resolved config
  - [x] Strict load-time validation
  - [x] Graceful structured load failure reporting
- [x] Implement execution lifecycle
  - [x] Resolve config
  - [x] Initialize plugins
  - [x] Runner pass once per scope
  - [x] Lint fan-out pass over single NAM snapshot
  - [x] Deterministic aggregation/sort
  - [x] Shutdown lifecycle
- [x] Implement failure policy behavior
  - [x] Required plugin fail-closed
  - [x] Optional plugin fail-open/fail-closed by config

## Phase 5: CLI and assembly profiles

- [x] Implement `viola-cli` host wiring profile
  - [x] Launch host runtime
  - [x] Resolve plugin search paths deterministically
  - [x] Attach default profile(s) (including TS bridge where configured)
- [x] Document assembly profiles
  - [x] CLI-on-PATH profile
  - [x] Embedded-host profile
  - [x] Bundled-CLI-with-app profile

## Phase 6: TS/Deno bridge profile

- [ ] Integrate Deno bridge plugin profile contract
  - [ ] Bridge loading and validation in host
  - [ ] Role mapping contract at host boundary
- [ ] Package responsibilities
  - [ ] TS package ships bridge dylib artifacts + TS tooling
  - [ ] CLI ships core runtime artifacts
  - [ ] No requirement for TS package to bundle core runtime

## Phase 7: Testing and determinism

- [ ] Add compatibility tests
  - [ ] ABI mismatch rejection
  - [ ] Missing symbol rejection
  - [ ] Model version mismatch rejection
- [ ] Add lifecycle tests
  - [ ] Init/invoke/shutdown ordering
  - [ ] Plugin failure policy paths
- [ ] Add determinism tests
  - [ ] Repeated identical run produces stable output order/content
  - [ ] Stable diagnostic sort invariants
- [ ] Add cross-platform smoke matrix (initially for release targets)

## Phase 8: Docs and rollout

- [ ] Keep all docs synchronized
  - [ ] `docs/PLUGIN-ABI-V1-DESIGN.md`
  - [ ] `crates/README.md`
  - [ ] crate README/TODO files
- [ ] Publish migration guidance
  - [ ] Rust-native plugin path (direct ABI)
  - [ ] TS ecosystem path (bridge)
  - [ ] Consumer assembly requirements
- [ ] Define release cut checklist for first implementation milestone

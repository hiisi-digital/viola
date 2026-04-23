# TODO — Viola implementation roadmap (normalized checklist)

Status: planning-only.  
Scope: top-level coordination for Rust host + plugin ABI transition and TS bridge integration.

---

## Phase 1 — Design lock

- [ ] Lock Plugin ABI v1 decisions in `docs/PLUGIN-ABI-V1-DESIGN.md`
  - [ ] Confirm strict in-process host-loaded model
  - [ ] Confirm unified roles (`runner`, `grammar`, `lint`)
  - [ ] Confirm fail-closed load behavior for required plugins
  - [ ] Confirm canonical TOML config + TS builder parity
- [ ] Add distribution matrix to design doc
  - [ ] Define package/artifact responsibilities (`viola-cli`, TS package, bridge dylibs)
  - [ ] Define supported platform matrix (initial targets)
- [ ] Freeze naming decisions
  - [ ] Confirm crate naming (`viola-core` vs `viola-host`)
  - [ ] Confirm plugin/bridge naming conventions

## Phase 2 — Repo scaffolding

- [ ] Create/maintain `crates/` workspace docs
  - [ ] Keep `crates/README.md` aligned with design doc
  - [ ] Add missing crate README/TODO placeholders consistently
- [ ] Add Rust workspace metadata (when implementation starts)
  - [ ] Top-level Cargo workspace setup for planned crates
  - [ ] Lint/format/test baseline config for Rust crates

## Phase 3 — Contracts and schemas

- [ ] Define ABI contract source files in `viola-plugin-abi` (contract-first)
  - [ ] Version constants
  - [ ] Role IDs and capability IDs
  - [ ] Descriptor and lifecycle contract shapes
  - [ ] Structured error/result model
  - [ ] Normative symbol constants
- [ ] Define host-side schema boundaries
  - [ ] Resolved config model schema
  - [ ] NAM model schema/version markers
  - [ ] Diagnostics schema/version markers

## Phase 4 — Host runtime (`viola-core`/`viola-host`)

- [ ] Implement plugin loading pipeline (using shared extension/plugin machinery later)
  - [ ] Discovery inputs from resolved config
  - [ ] Strict load-time validation
  - [ ] Graceful structured load failure reporting
- [ ] Implement execution lifecycle
  - [ ] Resolve config
  - [ ] Initialize plugins
  - [ ] Runner pass once per scope
  - [ ] Lint fan-out pass over single NAM snapshot
  - [ ] Deterministic aggregation/sort
  - [ ] Shutdown lifecycle
- [ ] Implement failure policy behavior
  - [ ] Required plugin fail-closed
  - [ ] Optional plugin fail-open/fail-closed by config

## Phase 5 — CLI and assembly profiles

- [ ] Implement `viola-cli` host wiring profile
  - [ ] Launch host runtime
  - [ ] Resolve plugin search paths deterministically
  - [ ] Attach default profile(s) (including TS bridge where configured)
- [ ] Document assembly profiles
  - [ ] CLI-on-PATH profile
  - [ ] Embedded-host profile
  - [ ] Bundled-CLI-with-app profile

## Phase 6 — TS/Deno bridge profile

- [ ] Integrate Deno bridge plugin profile contract
  - [ ] Bridge loading and validation in host
  - [ ] Role mapping contract at host boundary
- [ ] Package responsibilities
  - [ ] TS package ships bridge dylib artifacts + TS tooling
  - [ ] CLI ships core runtime artifacts
  - [ ] No requirement for TS package to bundle core runtime

## Phase 7 — Testing and determinism

- [ ] Add compatibility tests
  - [ ] ABI mismatch rejection
  - [ ] Missing symbol rejection
  - [ ] Model version mismatch rejection
- [ ] Add lifecycle tests
  - [ ] Init/invoke/shutdown ordering
  - [ ] Plugin failure policy paths
- [ ] Add determinism tests
  - [ ] Repeated identical run => stable output order/content
  - [ ] Stable diagnostic sort invariants
- [ ] Add cross-platform smoke matrix (initially for release targets)

## Phase 8 — Docs and rollout

- [ ] Keep all docs synchronized
  - [ ] `docs/PLUGIN-ABI-V1-DESIGN.md`
  - [ ] `crates/README.md`
  - [ ] crate README/TODO files
- [ ] Publish migration guidance
  - [ ] Rust-native plugin path (direct ABI)
  - [ ] TS ecosystem path (bridge)
  - [ ] Consumer assembly requirements
- [ ] Define release cut checklist for first implementation milestone
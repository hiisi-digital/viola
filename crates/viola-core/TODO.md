# TODO — `viola-core`

Status: planning scaffold only (no implementation yet)

## Design

- [ ] Confirm crate identity and naming
  - [ ] Decide final crate name (`viola-core` vs `viola-host`) and document rationale
  - [ ] Align naming with `viola-cli` and docs (`PLUGIN-ABI-V1-DESIGN.md`)
- [ ] Lock execution model invariants
  - [ ] Confirm strict `cdylib` / C-ABI optimization boundary
  - [ ] Confirm explicit, pull-based discovery model (no `inventory`/linker magic)
  - [ ] Single in-process host model
  - [ ] Unified role ABI (`runner` / `grammar` / `lint`)
  - [ ] Runner executes configured scope exactly once
  - [ ] Lints execute in one fan-out pass over shared NAM snapshot
- [ ] Lock plugin failure policy defaults
  - [ ] Required plugin load failure => fail-closed
  - [ ] Optional plugin failure policy => config-controlled
  - [ ] Runner failure => abort lint phase

## API / Contracts

- [ ] Define host-facing integration boundary with `viola-plugin-abi`
  - [ ] Loader expects strict ABI shape and version compatibility
  - [ ] Lifecycle hooks: initialize / invoke / shutdown
  - [ ] Role dispatch contract: runner / grammar / lint operation tables
- [ ] Define core internal contracts
  - [ ] Resolved run plan contract (from canonical config)
  - [ ] NAM handoff contract (producer/consumer boundary)
  - [ ] Diagnostic aggregation contract and stable sort key
- [ ] Define plugin resolution contract
  - [ ] Precedence: explicit config paths > env overrides > host defaults
  - [ ] Required plugin absence/error format
  - [ ] Platform artifact selection behavior

## Implementation

- [ ] Scaffold crate structure
  - [ ] `loader/` (discovery + dynamic loading integration)
  - [ ] `lifecycle/` (init/invoke/shutdown orchestration)
  - [ ] `dispatch/` (role dispatch wiring)
  - [ ] `run/` (runner pass + lint fan-out)
  - [ ] `report/` (diagnostic aggregation/emission)
  - [ ] `config/` (resolved plan ingestion)
- [ ] Implement plugin loading pipeline
  - [ ] Discover candidate plugin artifacts
  - [ ] Actively extract descriptors via explicit symbol calls (`dlsym`)
  - [ ] Load and validate ABI compatibility
  - [ ] Register role-capable plugins
  - [ ] Surface structured load failures
- [ ] Implement run lifecycle
  - [ ] Resolve run scope from config
  - [ ] Execute runner exactly once
  - [ ] Execute lint plugins over immutable NAM snapshot
  - [ ] Aggregate and emit deterministic diagnostics
- [ ] Implement host error paths
  - [ ] ABI mismatch errors
  - [ ] Missing symbol/contract errors
  - [ ] Invocation failure and graceful shutdown behavior

## Tests

- [ ] Add compatibility tests
  - [ ] Reject ABI major mismatch
  - [ ] Reject malformed/incomplete plugin contract
  - [ ] Reject NAM major mismatch
- [ ] Add lifecycle tests
  - [ ] Initialize/invoke/shutdown happy path
  - [ ] Required plugin load fail-closed behavior
  - [ ] Optional plugin fail-open/closed config behavior
- [ ] Add determinism tests
  - [ ] Same input/config => stable NAM handoff
  - [ ] Stable diagnostic ordering across repeated runs
- [ ] Add concurrency tests
  - [ ] Parallel lint fan-out correctness
  - [ ] No mutation of shared NAM during lint phase

## Docs / Release

- [ ] Keep crate README aligned with implementation reality
  - [ ] Update naming decision once finalized
  - [ ] Document host responsibilities and non-goals
  - [ ] Document architectural rationale (why pull-based discovery and strict C-ABI)
- [ ] Sync with top-level design docs
  - [ ] Ensure parity with `docs/PLUGIN-ABI-V1-DESIGN.md`
  - [ ] Record any contract clarifications back into design doc
- [ ] Prepare initial implementation milestone
  - [ ] Define “v1 host load+run” acceptance criteria
  - [ ] Track remaining gaps for CLI integration
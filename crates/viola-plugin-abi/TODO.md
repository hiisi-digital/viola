# TODO — `viola-plugin-abi`

Status: planning  
Scope: contract-first work only (no host/runtime implementation here)

## Phase 1 — Design

- [ ] Lock ABI v1 boundary and scope
  - [ ] Confirm strict `cdylib` / C-ABI optimization boundary
  - [ ] Confirm explicit ban on linker-magic discovery (no `inventory`)
  - [ ] Confirm macro-driven static monomorphization for Rust ergonomics
  - [ ] Confirm crate contains only shared ABI contract surface
  - [ ] Confirm non-goals (no loader/orchestration/runtime behavior)
  - [ ] Confirm naming and ownership conventions for ABI items
- [ ] Freeze v1 compatibility policy
  - [ ] Define major/minor compatibility rules
  - [ ] Define contract for future additive fields
  - [ ] Define rejection rules for incompatible plugin versions
- [ ] Finalize role model
  - [ ] Confirm role identifiers (`runner`, `grammar`, `lint`)
  - [ ] Confirm role capability declaration shape
  - [ ] Confirm multi-role plugin expectations

## Phase 2 — API / Contracts

- [ ] Define canonical ABI constants
  - [ ] ABI version constants
  - [ ] manifest/model version constants
  - [ ] stable role/capability identifiers
- [ ] Define required exported symbol constants
  - [ ] Explicit, pull-based descriptor/provider symbol names (e.g., `__viola_plugin_descriptor`)
  - [ ] Lifecycle symbol names (`init`, `invoke`, `shutdown`)
  - [ ] Role operation table symbol names
- [ ] Define macro-driven SDK ergonomics
  - [ ] `#[export_plugin]` or similar proc-macro API
  - [ ] Monomorphization wrappers mapping generic traits to `extern "C"`
- [ ] Define shared contract types
  - [ ] Plugin descriptor structs
  - [ ] Lifecycle input/output structs
  - [ ] Role op-table structs
  - [ ] Diagnostics/result envelope structs
  - [ ] Error code + structured error types
- [ ] Define memory and ownership boundary rules
  - [ ] Allocation/deallocation ownership
  - [ ] String/buffer ownership and lifetime rules
  - [ ] Nullability/invalid pointer behavior
- [ ] Define threading/reentrancy contract
  - [ ] Thread-safety expectations for plugin calls
  - [ ] Reentrancy guarantees/restrictions
  - [ ] Determinism expectations at ABI boundary

## Phase 3 — Implementation

- [ ] Add crate scaffolding
  - [ ] `Cargo.toml` with minimal dependencies
  - [ ] module layout for constants/types/errors/versioning
  - [ ] `viola-plugin-macros` sub-crate for proc-macros
  - [ ] feature flags policy (if needed)
- [ ] Implement ABI constants and identifiers
  - [ ] version constants
  - [ ] symbol constants
  - [ ] role/capability constants
- [ ] Implement contract type definitions
  - [ ] FFI-safe repr and layout constraints
  - [ ] constructor/validation helpers where appropriate
  - [ ] conversion helpers for host/plugin usage
- [ ] Implement compatibility helpers
  - [ ] version compatibility checks
  - [ ] capability matching helpers
  - [ ] mismatch classification helpers
- [ ] Implement SDK procedural macros
  - [ ] Macro parsing of user generic trait impls
  - [ ] Code generation of `repr(C)` descriptors and `extern "C"` wrappers

## Phase 4 — Tests

- [ ] Add layout and stability tests
  - [ ] size/alignment checks for ABI structs
  - [ ] compile-time assertions where possible
  - [ ] symbol/name invariance checks
- [ ] Add compatibility tests
  - [ ] ABI major mismatch cases
  - [ ] manifest/model compatibility cases
  - [ ] role/capability mismatch cases
- [ ] Add boundary validation tests
  - [ ] invalid/null input handling
  - [ ] malformed descriptor handling
  - [ ] deterministic error code mapping

## Phase 5 — Docs / Release

- [ ] Add crate-level contract docs
  - [ ] “what this crate owns” vs “what it does not own”
  - [ ] Architectural rationale: `cdylib` optimization barriers and `inventory` bans
  - [ ] Authoring guide: how macro-driven static monomorphization works
  - [ ] normative type/symbol reference
  - [ ] memory/threading rules summary
- [ ] Align docs with design source
  - [ ] cross-check with `docs/PLUGIN-ABI-V1-DESIGN.md`
  - [ ] update TODO and README after each design revision
- [ ] Prepare v1 release checklist
  - [ ] versioning policy confirmed
  - [ ] public API review completed
  - [ ] changelog + migration notes template prepared
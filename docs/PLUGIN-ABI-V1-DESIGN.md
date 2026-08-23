# Viola Plugin ABI v1: Design Specification

**Status:** Draft (implementation-targeted)\
**Audience:** `viola-core` maintainers, plugin authors (`runner`, `grammar`,
`lint`), integrators\
**Primary goal:** Provide a tight, stable, host-loaded plugin ABI that is
immediately implementable.

---

## Part I: Normative Specification

This section is normative. Terms like **MUST**, **MUST NOT**, **SHOULD**, and
**MAY** are used in the RFC sense.

### 1. Scope

Plugin ABI v1 defines:

- In-process plugin loading by `viola-core`
- Unified plugin contract for roles:
  - `runner`
  - `grammar`
  - `lint`
- Strict plugin shape validation at load time
- Configuration-driven execution lifecycle
- A single normalized analysis structure shared by all lints
- Deterministic diagnostic aggregation and reporting

Out of scope for v1:

- Inter-process plugin protocol as a primary path
- Remote plugin execution
- Plugin marketplace/signing infra
- Alternative competing analysis model families

---

### 2. Core invariants

1. **Single host model:** Plugins are loaded and executed by one host process
   (`viola-core`) in-process.
2. **Strict load contract:** Every plugin MUST present the same required ABI
   shape for v1.
3. **Fail-fast on mismatch:** Invalid or incompatible plugin shape/version MUST
   fail loading with structured, graceful errors.
4. **Unified ABI:** Runners, grammars, and lints share one ABI and lifecycle,
   with role-specific operations.
5. **Config-driven run:** Host behavior is determined by resolved configuration
   artifacts.
6. **Single analysis snapshot:** A configured run scope is processed once by the
   selected runner pipeline; lints run against that same snapshot.
7. **Language-agnostic core:** `viola-core` knows roles/contracts, not language
   internals.

---

### 3. Versioning model

#### 3.1 Version fields

- `abi_version`: Plugin ABI compatibility target (semver string)
- `manifest_version`: Manifest schema version (semver string)
- `model_version`: Normalized Analysis Model (NAM) schema version (semver
  string)

#### 3.2 Compatibility rules

- Host and plugin **MUST** share `abi_version` major (v1 host loads v1 plugins).
- Host **MUST** reject incompatible major versions at load.
- NAM major mismatch **MUST** be treated as incompatible.
- Additive optional fields are allowed in minor revisions.
- Breaking semantic changes require major version bump.

---

### 4. Plugin package and loading

#### 4.1 Normative loading form (v1)

Plugins are native dynamic libraries compiled to a strict C-ABI boundary (e.g.,
Rust `cdylib`):

- macOS: `.dylib`
- Linux: `.so`
- Windows: `.dll`

Host discovers plugin artifacts from configured plugin roots and explicit plugin
references. The boundary MUST be a stable C-ABI to prevent compiler-version
coupling and cross-boundary optimization bleeding.

#### 4.2 Required exported symbol set

Each plugin library MUST export a stable v1 descriptor/provider entrypoint and
operation table according to ABI v1.

Plugins MUST NOT rely on linker constructor magic (e.g., `.init_array`,
`inventory` crate) for registration. Discovery is strictly pull-based: the host
actively loads the library and calls the explicit exported symbol.

At minimum, the host MUST be able to resolve:

- plugin descriptor (identity, versions, roles, compatibility)
- role operation table(s)
- lifecycle functions:
  - initialize
  - invoke role operation(s)
  - shutdown

> Exact symbol names are implementation-defined but MUST be fixed and documented
> in the SDK for ABI v1.

#### 4.3 Load-time validation

On load, host MUST validate:

- Required symbol presence
- ABI major compatibility
- Manifest/schema validity
- Declared roles are supported by exported function table
- Model compatibility claims for produced/consumed NAM
- Required host capabilities declared by plugin

If any validation fails:

- Plugin MUST be rejected
- Error MUST be structured and actionable
- Host behavior (abort run vs continue without plugin) is config-controlled,
  defaulting to fail-closed for required plugins

---

### 5. Unified role model

A plugin MAY expose one or more roles.

#### 5.1 `runner` role

Responsibilities:

- Evaluate configured run scope once
- Coordinate configured grammar plugins for extraction
- Produce one NAM snapshot for the run scope

#### 5.2 `grammar` role

Responsibilities:

- Perform grammar/tree-walker extraction logic
- Map language-specific internals into NAM-conformant structure
- Preserve NAM required fields and invariants

#### 5.3 `lint` role

Responsibilities:

- Consume NAM snapshot + lint config
- Emit diagnostics in canonical schema
- Avoid host-internal language assumptions outside NAM contract

---

### 6. Manifest contract (normative shape)

A plugin manifest MUST include:

- `manifest_version`
- `plugin_id`
- `plugin_version`
- `abi_version` (or compatible range field defined by schema)
- `roles`
- compatibility metadata
- role capability declarations

Recommended fields:

- `display_name`
- plugin-specific config schema reference
- metadata (`license`, `homepage`, `repository`)
- defaults

Example shape:

```clause-dev/viola/docs/PLUGIN-ABI-V1-DESIGN.md#L146-173
{
  "manifest_version": "1.0.0",
  "plugin_id": "org.viola.grammar.ts",
  "plugin_version": "0.1.0",
  "display_name": "Viola TypeScript Grammar",
  "abi_version": "1.0.0",
  "roles": ["grammar"],
  "compatibility": {
    "host": ">=1.0.0 <2.0.0",
    "platforms": ["darwin-arm64", "darwin-x64", "linux-x64", "windows-x64"]
  },
  "capabilities": {
    "provides": ["grammar.extract"],
    "requires": ["workspace.read", "config.read"]
  },
  "model": {
    "produces": ["nam@1.0.0"]
  },
  "config_schema_ref": "schemas/grammar-ts.schema.json"
}
```

---

### 7. Lifecycle contract

#### 7.1 Host lifecycle stages

1. Resolve config
2. Discover and load plugins
3. Validate plugin set
4. Initialize plugin instances
5. Execute run:
   - Runner pass once per configured scope
   - Lint fan-out pass over single NAM snapshot
6. Aggregate diagnostics
7. Shutdown plugins

#### 7.2 Initialization input

Host passes:

- Resolved workspace context
- Run surface metadata (e.g. `cli`, `hook`, CI flag)
- Plugin-scoped configuration
- Version info for ABI/model contracts

#### 7.3 Invocation contract

Role invocations are direct in-process calls via the v1 function table.

- `runner.execute_scope(...) -> NAM`
- `grammar.extract(...) -> grammar contribution` (typically runner-mediated)
- `lint.evaluate(...) -> diagnostics`

#### 7.4 Shutdown

Plugins MUST release owned resources and return deterministically from shutdown.

---

### 8. Configuration contract

#### 8.1 Canonical textual form

Canonical persisted config artifact is **TOML**.

#### 8.2 Multi-format authoring

Other authoring surfaces (e.g. TS builder API) are allowed, but MUST
compile/emit into the same canonical TOML-equivalent resolved config model
before execution.

#### 8.3 Run semantics

Configuration determines:

- selected runner plugin
- grammar plugin set
- lint plugin set
- include/exclude scope
- lint levels/options
- failure policy (`fail_closed` / `fail_open` for optional plugin failures)

Runner MUST execute configured scope exactly once per run.

---

### 9. Normalized Analysis Model (NAM) v1

NAM is the single stable structure consumed by all lints.

#### 9.1 Goals

- Language-neutral at consumption boundary
- Grammar-friendly production
- Deterministic shape with explicit required fields
- Sufficient for current tree-walker + grammar abstraction used by Viola

#### 9.2 Top-level shape (normative categories)

- `model_version`
- `workspace`
- `documents`
- `index`
- `run_context`

#### 9.3 Required invariants

- Document/file paths are workspace-relative
- Location ranges use:
  - line: 1-based
  - column: 0-based
- Node IDs are unique per document
- Required fields are never omitted
- Optional fields follow schema null/omission rules consistently
- Same input + config MUST produce structurally equivalent NAM (ignoring
  approved non-semantic metadata fields)

Example sketch:

```clause-dev/viola/docs/PLUGIN-ABI-V1-DESIGN.md#L252-307
{
  "model_version": "1.0.0",
  "workspace": {
    "root": "/abs/path/project",
    "files": [
      { "path": "src/main.ts", "language": "typescript", "hash": "sha256:...", "size_bytes": 1234 }
    ]
  },
  "documents": [
    {
      "path": "src/main.ts",
      "language": "typescript",
      "nodes": [
        {
          "id": "n1",
          "kind": "function",
          "name": "buildPlan",
          "range": { "start_line": 10, "start_col": 0, "end_line": 24, "end_col": 1 },
          "attributes": { "async": false, "exported": true },
          "relations": [{ "kind": "contains", "target": "n2" }]
        }
      ],
      "metadata": {}
    }
  ],
  "index": {
    "by_kind": {
      "function": ["n1"]
    }
  },
  "run_context": {
    "surface": "cli",
    "ci": false
  }
}
```

---

### 10. Diagnostics contract

Lints return canonical diagnostics list.

Required diagnostic fields:

- `plugin_id`
- `rule_id`
- `severity` (`error` | `warn` | `info`)
- `message`
- `location` (path + range)

Recommended fields:

- `id`
- `suggestion`
- `tags`
- structured metadata (`confidence`, etc.)

Example:

```clause-dev/viola/docs/PLUGIN-ABI-V1-DESIGN.md#L328-357
{
  "diagnostics": [
    {
      "id": "org.viola.lint.no-yagni/avoid-shortcut-001",
      "plugin_id": "org.viola.lint.no-yagni",
      "rule_id": "avoid-shortcut",
      "severity": "error",
      "message": "Detected shortcut rationale in implementation note.",
      "location": {
        "path": "docs/design.md",
        "range": { "start_line": 42, "start_col": 4, "end_line": 42, "end_col": 30 }
      },
      "suggestion": "Replace shortcut rationale with extensible design justification.",
      "tags": ["policy", "design"],
      "metadata": { "confidence": "high" }
    }
  ]
}
```

Determinism rule:

- Diagnostics MUST be sorted by
  `(path, start_line, start_col, plugin_id, rule_id)` before final host
  emission.

---

### 11. Error model

Structured error shape (normative fields):

- `code`
- `message`
- `details` (object)
- `retryable` (boolean)

Example:

```clause-dev/viola/docs/PLUGIN-ABI-V1-DESIGN.md#L371-383
{
  "code": "PLUGIN_LOAD_ABI_MISMATCH",
  "message": "Plugin ABI major 2 is incompatible with host ABI major 1",
  "details": {
    "plugin_id": "org.viola.lint.example",
    "host_abi": "1.0.0",
    "plugin_abi": "2.0.0"
  },
  "retryable": false
}
```

Failure behavior:

- Required plugin load failure defaults to fail-closed
- Optional plugin failure behavior is config-controlled
- Runner failure aborts run (no NAM => no lint phase)

---

### 12. Concurrency model

- Host MAY run lint plugins concurrently.
- Lints MUST treat NAM as immutable input.
- Runner phase precedes lint phase.
- v1 does not require incremental protocol support; full configured scope
  execution is canonical.

---

## Part II: Integration Profile (Rust host + Deno ecosystem)

This section is prescriptive for the current intended architecture profile.

### 13. Profile overview

- `viola-core` is the single in-process native host runtime.
- `viola-cli` is the standard executable that runs `viola-core` and attaches
  configured plugins.
- Core loads native plugin `cdylib`s (`.dylib/.so/.dll`) using ABI v1.
- Rust-native plugins integrate directly via ABI v1 SDK, using macro-driven
  static monomorphization to maintain safe Rust ergonomics over the C-ABI
  boundary.
- TS/Deno ecosystem is integrated through a **Deno bridge plugin**.
- Packaging is intentionally composable: users/integrators assemble required
  pieces rather than relying on one package to include everything.

---

### 14. Deno bridge strategy (normative for this profile)

#### 14.1 Design decision

Do **not** require every TS package/plugin to compile to native dylib.

Instead:

- Provide one native plugin: `viola-plugin-deno-bridge`
- Bridge is loaded by host via ABI v1
- Bridge hosts/coordinates TS-side extension model and maps results to
  NAM/diagnostics contracts

This preserves existing TS ecosystem ergonomics and avoids mass migration.

#### 14.2 Bridge role support

The bridge MAY expose one or more roles:

- `runner` (primary)
- `grammar` proxy
- `lint` proxy

Role exposure MUST still satisfy same ABI v1 role contracts externally.

---

### 15. Runtime and assembly policy

The system is intentionally "bring the pieces together" and supports explicit
assembly profiles.

#### 15.1 Canonical execution options

Users/integrators choose one of:

1. Use `viola-cli` on PATH (`viola`) as the host executable.
2. Embed `viola-core` in their own native app and host plugins directly.
3. Bundle `viola-cli` with their app and invoke it as the executable host
   boundary.

No single package is required to complete the full loop automatically.

#### 15.2 Deno/TS package policy

The Deno/TS-side `viola` package SHOULD ship bridge plugin dylib artifacts
(platform coverage as available) and TS-facing config/builder surfaces.\
It MUST NOT be required to bundle `viola-core`.

#### 15.3 CLI policy

`viola-cli` SHOULD include `viola-core` and select the correct cross-compiled
host binary for the running platform at startup.

#### 15.4 Rust plugin policy

Rust plugins MUST be compiled as `cdylib` to enforce the optimization and ABI
boundary. They implement ABI v1 directly via the Rust SDK (which utilizes
procedural macros to generate the required `extern "C"` boilerplate) and do not
require the Deno bridge.

---

### 16. Packaging and plugin resolution guidance

#### 16.1 Native host / CLI distribution

`viola-cli` distribution SHOULD ship:

- `viola-core` host runtime (cross-compiled platform artifacts)
- plugin loader/runtime support
- optional default plugin profile wiring (e.g. TS bridge attachment by
  config/profile)

#### 16.2 Deno package distribution

`viola` (Deno/TS package) SHOULD ship:

- TS packages and builder tooling
- Deno bridge dylib artifacts for supported platforms
- no bundled `viola-core` requirement

#### 16.3 Plugin resolution precedence

Host plugin resolution SHOULD be deterministic in this order:

1. Explicit plugin paths from resolved config
2. Explicit environment overrides
3. Host/CLI default plugin directories

Missing required plugins MUST produce structured fail-closed errors by default.

---

### 17. Config authoring and artifact parity

- TOML is canonical textual config form.
- TS builder API MUST emit equivalent resolved config model (and/or TOML
  artifact) consumed identically by host execution.
- Rust-first consumers typically author TOML directly.
- Both paths MUST converge to the same resolved run plan.
- Docs MUST describe required assembly inputs per execution profile
  (`viola-cli`, embedded `viola-core`, bundled `viola-cli`) so composition
  remains explicit and predictable.

---

## Part III: Rationale (Non-normative)

### 18. Why host-loaded dylib first

- Matches requirement: one host loads plugins directly
- Avoids IPC complexity for v1
- Enables tight stable load contract with immediate fail-on-mismatch behavior
- Gives runners direct host-level capability surface within strict ABI
  boundaries

### 19. Why unified ABI across roles

- Reduces conceptual and implementation fragmentation
- Keeps plugin lifecycle coherent
- Makes load/validation and SDK ergonomics simpler
- Prevents divergent “runner ABI vs lint ABI” drift

### 20. Why one normalized model

- Supports “run once, lint many” efficiently
- Keeps lints language-agnostic at consumption boundary
- Preserves grammar plugin freedom internally while enforcing stable external
  structure

### 21. Why Deno bridge instead of per-TS dylibs

- Preserves TS ecosystem and extension mechanisms
- Avoids forcing all TS packages into native build pipelines
- Concentrates runtime compatibility and mapping logic in one maintained bridge
- Keeps migration and maintenance costs tractable
- Allows the `viola` TS package to remain bridge/artifact-focused without
  bundling core host runtime

### 22. Why explicit assembly profiles

- Keeps responsibilities clear: `viola-cli`/embedded host runs core; TS package
  provides bridge-facing ecosystem surface
- Avoids hidden packaging coupling between TS package and core host runtime
- Supports both CLI-first and embedded-host integrators without forcing one
  distribution style
- Makes requirements documentable and testable instead of implicit

### 23. Why `cdylib` and explicit exports instead of `dylib` and `inventory`

- **Rust ABI is unstable:** `dylib` requires host and plugins to be compiled
  with the exact same compiler version. `cdylib` provides a rock-solid C-ABI
  boundary.
- **LLVM Optimization Boundaries:** Compiling as `cdylib` and calling via
  `dlsym` creates a hard optimization barrier, preventing unfair LLVM
  devirtualization advantages and tight coupling (proven by `polka-dots`
  benchmarks).
- **Linker Magic is fragile:** Global constructors (`.init_array`, `inventory`)
  fail silently across dynamic boundaries on different OSs. Explicit symbol
  exports ensure deterministic, pull-based host registration.

### 24. How Rust ergonomics are preserved (Macro-driven Monomorphization)

Even though the boundary is strictly C-ABI, plugin authors write idiomatic,
safe, generic Rust. The `viola-plugin-abi` SDK uses procedural macros (e.g.,
`#[export_plugin]`) to statically monomorphize the user's generic code at
compile time _inside the plugin_. The macro generates the `repr(C)` descriptors
and `extern "C"` function wrappers, leaving the user experience clean and
`dyn`-free (a pattern proven by the `saalis` architecture).

### 25. Future evolution (informative only)

Possible future additions (not v1 requirements):

- Optional process-boundary transport profile
- Optional Wasm container profile
- Plugin signing/provenance policies
- Incremental NAM computation contracts
- Extended capability sandbox enforcement

None of these alter the v1 core decision: strict host-loaded in-process ABI with
unified role contract.

---

## 26. Implementation checklist (v1 readiness)

1. Finalize v1 manifest schema + validators
2. Finalize required exported symbol table in SDK
3. Implement host loader with strict validation and structured errors
4. Implement runner→NAM and lint→diagnostics call paths
5. Implement deterministic sorting/aggregation rules
6. Implement TOML canonical config resolution + TS builder parity path
7. Implement Deno bridge plugin and runtime resolution policy
8. Add compatibility tests:
   - ABI mismatch rejection
   - malformed plugin rejection
   - model version mismatch rejection
   - deterministic output on repeated identical runs

This checklist is sufficient to begin implementation immediately.

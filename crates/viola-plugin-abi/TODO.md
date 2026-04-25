# TODO — `viola-plugin-abi`

Status: v1 contract surface landed (#193).

## Landed in v1 (#193)

- [x] Crate scaffolding under `#![no_std]`, no deps beyond `core`
- [x] ABI version constants and compatibility helpers (`HOST_ABI_MAJOR`,
      `VIOLA_ABI_VERSION`, `VersionTriple::is_compatible_with`)
- [x] Manifest, plugin, NAM version newtypes
- [x] Exported-symbol constant `DESCRIPTOR_SYMBOL`
- [x] Role enum + `RoleSet` bitflag
- [x] `CapabilityId` (FNV-1a 64) + `CapabilityEntry`
- [x] Well-known capability constants for runner / grammar / lint
- [x] `PluginDescriptor` + `PluginIdentity` `#[repr(C)]` shapes with
      lifecycle, capabilities, NAM compat, host-cap requirements,
      config-schema reference
- [x] `AbiStatus` (`#[repr(u32)]`) + `PluginError` category enum
- [x] `Diagnostic`, `DiagnosticBatch`, `SourceLocation`, `SourceRange`,
      `DiagnosticSeverity`
- [x] `NamPayload` opaque carrier + `NamVersion`
- [x] `ConfigSchemaRef`, `RunSurface`
- [x] Layout-stability and FNV-1a determinism tests

## Follow-up rounds

### Companion macro crate (#232) — landed in PR #2

- [x] `viola-plugin-abi-macros` crate carrying `#[export_plugin]`
      attribute that statically monomorphizes a plugin's static metadata
      into the `repr(C)` `PluginDescriptor` + `extern "C"`
      `__viola_plugin_descriptor` symbol this crate defines.
- [x] `CapabilityExport` / `InitHandler` / `ShutdownHandler` traits in
      `viola-plugin-abi::traits` for the macro to reference.
- [ ] Future: dedicated `#[capability]` attribute that emits
      `CapabilityExport` impls plus the per-capability vtable struct
      (currently authors hand-write the vtable).

### NAM concrete shape (post-#193)

- [ ] Pin a `#[repr(C)]` or stable serialized layout for the NAM
      payload (CBOR / FlatBuffers / packed custom). v1 reserves the
      version axis; concrete shape lands as a minor revision.

### Substrate alignment

- [ ] Once `hilavitkutin-extensions` graduates from its mock workspace
      into a published crate, evaluate re-basing the `PluginDescriptor`
      shape onto `ExtensionDescriptor` + viola-specific capability
      vtables, or keep the two as parallel infrastructure with mutual
      capability-id compatibility.

### Host loader (#194)

- [ ] `viola-core` host loader implements:
  - [ ] symbol resolution against `DESCRIPTOR_SYMBOL`
  - [ ] structured validation per `PluginError` categories
  - [ ] role-bit / capability-id presence checks
  - [ ] fail-closed default for required plugins; config-controlled
        for optional plugins

### Diagnostic enrichment (#233)

- [ ] Issue model + workflow-aware diagnostic context: extend
      `Diagnostic.metadata_*` with concrete schema(s) for confidence,
      structured suggestion, fix patches, and workflow context
      (current task / phase / manifest references).

### Capability invocation contracts

- [ ] Document and pin the `repr(C)` vtable shape behind each
      well-known capability id (`viola.runner.execute_scope.v1`,
      `viola.grammar.extract.v1`, `viola.lint.evaluate.v1`). v1 of the
      contract crate names them; the vtable shapes live in adjacent
      contract files or sub-modules in a follow-up round.

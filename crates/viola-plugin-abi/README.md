# `viola-plugin-abi`

Stable C-ABI contract crate shared between the Viola host runtime
(`viola-core`) and any plugin compiled as a native `cdylib`.

Status: v1 contract surface landed. Companion proc-macro SDK
(`viola-plugin-abi-macros`) and host loader live in separate crates
and tasks.

## Scope

This crate owns the wire shapes and version primitives that cross the
C-ABI boundary at plugin load and invocation:

- `PluginDescriptor`, `PluginIdentity`, `ProviderEntry`,
  `ProviderId` (FNV-1a 64 over an ASCII name, const-evaluated)
- `BytesRef` shared `(ptr, len)` carrier used for every byte slice
  crossing the boundary
- Role and role-set bitflag (`Role`, `RoleSet`): runner, grammar, lint
- Well-known provider constants for each role's primary operation
- `RunnerExecuteScopeVtable`, `GrammarExtractVtable`,
  `LintEvaluateVtable`: the `#[repr(C)]` vtable shapes behind each
  well-known provider id, plus `RunScope` and `FileEntry` argument
  types
- Version primitives (`AbiVersion`, `ManifestVersion`, `PluginVersion`,
  `NamVersion`, `VersionTriple`). `AbiVersion::is_compatible_with` is
  major-only per spec; `VersionTriple::is_compatible_with` is
  major-equal + minor-greater-or-equal for manifest and plugin
  versions
- Lifecycle and invocation status codes (`AbiStatus`)
- Structured error envelope (`StructuredError` with `code`, `message`,
  `details`, `retryable`) and category enum (`PluginError`)
- Diagnostic schema (`Diagnostic`, `DiagnosticBatch`, `SourceRange`,
  `SourceLocation`, `DiagnosticSeverity`)
- NAM payload carrier and version marker (`NamPayload`, `NamVersion`)
- Configuration surface (`ConfigSchemaRef`, `RunSurface`)
- The exported-symbol constant `DESCRIPTOR_SYMBOL`

The crate is `#![no_std]`, allocates nothing, and has no dependencies
beyond `core`.

## Non-goals

Out of scope for this crate:

- dynamic loading and symbol resolution (lives in `viola-core` and
  the planned `hilavitkutin-linking` substrate)
- host orchestration: lifecycle scheduling, fan-out, aggregation
- plugin authoring ergonomics: the proc-macro `#[export_plugin]` lives
  in a separate `viola-plugin-abi-macros` crate so that the contract
  surface stays free of `syn`/`quote`/proc-macro tooling
- runtime discovery, plugin marketplaces, or signing infrastructure
- concrete NAM serialization: v1 reserves the version axis and an
  opaque payload; the binary shape lands in a follow-up round

## Source of truth

`docs/PLUGIN-ABI-V1-DESIGN.md` at the repository root is the normative
spec. This crate is the executable form of sections 3 through 8 plus
the diagnostic and error model in sections 10 and 11. Section 9 (NAM)
is reserved by version axis only.

## Compatibility policy

`HOST_ABI_MAJOR` is `1`. The host rejects any plugin whose
`abi_version` major differs. Additive minor changes are allowed and
do not bump the major; breaking layout or semantic changes do.

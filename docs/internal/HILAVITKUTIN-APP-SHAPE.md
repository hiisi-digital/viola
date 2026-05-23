# Viola as a hilavitkutin app

> Single source of truth for viola's runtime shape. Supersedes the prior "host runtime → pipeline::run → CaptureSink" mental model.

## The framing

Viola is a hilavitkutin app. The entire run is one `scheduler.run()` call dispatching a graph of WorkUnits over scheduler-owned Resources and Columns. There is no separate host runtime, no `pipeline::run`, no `CaptureSink`, no `RunScope` struct holding fields.

State for any hilavitkutin app reduces to one of three things:

1. `Resource<T>`: singleton, scheduler-managed, registered via `.resource::<T>(initial)`.
2. `Column<T>`: collection, N records, columnar layout, registered via `.column::<T>()`.
3. `Virtual<T>`: fired/event-shaped, used for cross-WorkUnit signalling at plan-time-determined boundaries.

Code lives in `WorkUnit`s with declared `type Read: AccessSet` and `type Write: AccessSet` over those stores. Access happens through Context's `Has<...>` accessors at dispatch time.

This is not aspirational; it is the structural target every viola PR moves toward. Pre-existing struct-and-pointer shapes (`pipeline::run`, `CaptureSink`, `Session<N>`) are interim scaffolding, not the destination.

See workspace rule `~/Dev/clause-dev/.claude/rules/hilavitkutin-workunit-mental-model.md` and skill `~/Dev/clause-dev/.claude/skills/hilavitkutin-workunit-thinking/SKILL.md` for the framing rules and decision tests.

## Stores registered on the scheduler builder

| Store | Kind | Populated by | Read by |
|---|---|---|---|
| `Workspace` | Resource | `LoadConfig` (CWD detection, Str-interned) | `RunRunner`, `DiscoverFiles` |
| `CiState` | Resource | `LoadConfig` (env detection) | `RunRunner` |
| `RunSurface` | Resource | `LoadConfig` (CLI mode flag) | `RunRunner` |
| `ViolaConfig` | Resource | `LoadConfig` (parses viola.toml) | `LoadPlugins`, `DiscoverFiles`, `EmitDiagnostics` |
| `StringInterner<A>` | Resource | bootstrap (provided by `hilavitkutin-providers`) | every WorkUnit handling Str |
| `ExtensionHost` | Resource | `LoadPlugins` (loads cdylibs) | `RunRunner`, `RunLint<L>` |
| `FileInfo` | Column | `DiscoverFiles` | `RunRunner` |
| `Nam` | Column | `RunRunner` | `RunLint<L>` |
| `Diagnostic` | Column | `RunLint<L>` | `EmitDiagnostics` |

## WorkUnits

| WorkUnit | Read | Write |
|---|---|---|
| `LoadConfig` | (CLI args, env via `Resource<Args>`/`Resource<Env>` providers) | `Workspace`, `CiState`, `RunSurface`, `ViolaConfig` |
| `LoadPlugins` | `ViolaConfig` | `ExtensionHost` |
| `DiscoverFiles` | `Workspace`, `ViolaConfig` | `Column<FileInfo>` |
| `RunRunner` | `ExtensionHost`, `Workspace`, `CiState`, `RunSurface`, `Column<FileInfo>` | `Column<Nam>` |
| `RunLint<L>` (one per loaded lint, parameterised over plugin index) | `ExtensionHost`, `Column<Nam>` | `Column<Diagnostic>` |
| `EmitDiagnostics` | `Column<Diagnostic>`, `ViolaConfig` | (writer provider) |

## Phase shape (computed by scheduler)

The scheduler derives this DAG from the declared AccessSets. Viola does not write a phase loop.

1. `LoadConfig`, then `LoadPlugins` (sequential; LoadPlugins reads ViolaConfig).
2. `DiscoverFiles` (reads Workspace + ViolaConfig).
3. `RunRunner` (writes Column<Nam>).
4. `RunLint<*>` parallel fan-out (all read Column<Nam>, all write Column<Diagnostic>; commutative on Column<Diagnostic>).
5. `EmitDiagnostics`.

## What dissolves

- **`pipeline::run`**: gone. The scheduler IS the pipeline.
- **`RunScope` as in-process state**: survives only as `#[repr(C)]` FFI wire shape, constructed inside `RunRunner::execute()` from Resources for one plugin call. Not where data lives.
- **`CaptureSink`**: gone. `Column<Diagnostic>` is the buffer.
- **`Session<N>` for plugin LIFO**: gone. `Resource<ExtensionHost>` lifetime is scheduler-owned; tear-down happens in scheduler shutdown.
- **`Push<Diagnostic>` / `Len` / `DiagnosticSink`** in viola code: gone. Push-into-column is whatever Context's writer accessor offers.
- **`viola_core::aggregate::sort_diagnostics`**: gone. Diagnostic ordering is a phase-boundary concern, not a standalone helper.
- **Manual MaybeUninit drop loops in viola-cli**: gone. Resource lifecycle is scheduler-owned.

## Pointers and refs in this picture

Per the workspace rule: refs and pointers inside cache-local intentional regions are fine. Refs into global storage = reinventing the heap (forbidden by `no_alloc`).

Concrete examples that ARE fine:

- Inside `RunRunner::execute()`, the FFI `RunScope` struct holds `*const FileEntry` pointing into the Column<FileInfo> morsel slice for the duration of the FFI call. Cache-local, intentional, scoped to the call.
- `interner.resolve(s) -> Maybe<&str>` returns a borrow into the arena Resource. Scoped to the WorkUnit's `execute()` call.
- A WorkUnit's `execute(&self, ctx: &Self::Ctx)` borrows from the Context for the call duration.

NOT fine:

- A `*Ref<T>` / `StoreHandle` / `RegistryKey` type whose purpose is "access scheduler data from outside a WorkUnit's execution".
- A `pub struct AppState` holding viola state with methods.
- A `pub static` / `OnceCell` carrying scheduler data.
- A `<'a>` lifetime on a consumer-public type tracking "borrowed from store".

## What's left in viola crates

- **`viola-plugin-abi`**: unchanged. The `#[repr(C)]` FFI wire types (RunScope, Nam, Diagnostic, FileEntry, descriptor, vtables, BytesRef) stay exactly as ABI v1 specifies. Plugins are unaffected by the host restructure.
- **`viola-config`**: parses viola.toml into `ViolaConfig` POD. The parsed value becomes the contents of `Resource<ViolaConfig>`.
- **`viola-core`**: defines:
  - The WorkUnit types (LoadConfig, LoadPlugins, DiscoverFiles, RunRunner, RunLint<L>, EmitDiagnostics) and their Read/Write AccessSets.
  - The Resource value types (Workspace, CiState, RunSurface, ExtensionHost POD container).
  - The Column record types (FileInfo, Nam, Diagnostic).
  - The Role enum (the `Role` itself, not the bitset: that's `arvo_bitmask::Mask64`).
  - Domain helpers used inside WorkUnits (FFI marshal helpers, severity classifiers, etc.).
- **`viola-cli`**: a thin `main()` that:
  1. Builds the scheduler with the WorkUnits + Resources + Columns registered.
  2. Wires `hilavitkutin-providers` defaults (InternerProvider, MemoryProvider, ColumnStorage, ThreadPool, Clock).
  3. Calls `.run()`.
  4. Exits with the right status (looked up from final `Resource<RunSummary>` or computed from Column<Diagnostic> stats).
  No state, no helpers, just builder + run.

## Prerequisite chain

Three sequential prereqs before #254 (this restructure) can land:

1. **#253: `hilavitkutin-providers` ships.** Sensible default Resource-backed providers (InternerProvider with arena impl, ColumnStorage default, MemoryProvider default for libc/Unix, ClockProvider). Mockspace design-round flow in `hilavitkutin/mock/design_rounds/` (TOPIC → DOC → SRC → DONE). Viola consumes the providers crate; viola does not roll its own arena, allocator, or storage.

2. **#225: viola repo gains mockspace workflow shape.** Adds `viola/mock/` scaffolding so the restructure happens under formal mockspace design-round flow, uniform with arvo/hilavitkutin/vehje/notko. Existing docs (this one, PLUGIN-ABI-V1-DESIGN.md, VIOLA-TOML-V2-SCHEMA.md) migrate into template form.

3. **#254: viola becomes a hilavitkutin app.** The structural shift described in this document, executed under viola's mockspace.

## Status

As of 2026-04-26: design phase. Tier 1 (#247) and Tier 2 (#248) substrate-reuse PRs are merged on dev. Tier 3/4/5 framing was abandoned in favour of this single structural shift. Implementation begins after #253 and #225 land.

## References

- Workspace rule: `~/Dev/clause-dev/.claude/rules/hilavitkutin-workunit-mental-model.md`
- Workspace skill: `~/Dev/clause-dev/.claude/skills/hilavitkutin-workunit-thinking/SKILL.md`
- Workspace rule (sibling): `~/Dev/clause-dev/.claude/rules/use-the-stack-not-reinvent.md`
- Hilavitkutin design: `~/Dev/clause-dev/hilavitkutin/mock/PRINCIPLES.md.tmpl` + scheduler section in `mock/crates/hilavitkutin/DESIGN.md.tmpl`
- WorkUnit/AccessSet contract: `~/Dev/clause-dev/hilavitkutin/mock/crates/hilavitkutin-api/DESIGN.md.tmpl`
- Plugin ABI: `viola/docs/PLUGIN-ABI-V1-DESIGN.md` (unchanged by this restructure)
- Config schema: `viola/docs/VIOLA-TOML-V2-SCHEMA.md` (parsed value becomes `Resource<ViolaConfig>`)

# Viola as a hilavitkutin app

> Single source of truth for viola's runtime shape. Supersedes the prior "host runtime → pipeline::run → CaptureSink" mental model. Updated 2026-05-24 against locked megaround 202605101036.

## The framing

Viola is a hilavitkutin app. The entire run is one `scheduler.run()` call dispatching a graph of WorkUnits over scheduler-owned Resources and Columns. There is no separate host runtime, no `pipeline::run`, no `CaptureSink`, no `RunScope` struct holding fields.

State for any hilavitkutin app reduces to one of three things:

1. `Resource<T>`: singleton, scheduler-managed, registered via `.with(Resource::new(value))`.
2. `Column<T>`: collection, N records, columnar layout, registered via `.with(Column::<T>::new())`.
3. `Virtual<T>`: zero-data DAG edge, used for cross-WorkUnit signalling at plan-time-determined boundaries, registered via `.with(Virtual::<T>::new())`.

Code lives in `WorkUnit`s with declared `type Read: AccessSet` and `type Write: AccessSet` over those stores. The `WorkUnit` trait requires a GAT `type Ctx<'frame>` satisfying seven specific accessor bounds: `HasColumnReader<Read>`, `HasColumnWriter<Write>`, `HasResourceProvider<Read>`, `HasVirtualFirer<Write>`, `HasEach<Read, Write>`, `HasBatch<Read, Write>`, and `HasReduce<Read, Write>`. Access happens through those accessors inside `fn execute<'frame>(&self, ctx: &Self::Ctx<'frame>)`. The `'frame` lifetime threads from the scheduler into per-phase resource snapshot views; consumer WorkUnit declarations do not carry this lifetime in their own types.

This is not aspirational; it is the structural target every viola PR moves toward. Pre-existing struct-and-pointer shapes (`pipeline::run`, `CaptureSink`, `Session<N>`) are interim scaffolding, not the destination.

See workspace rule `~/Dev/clause-dev/.claude/rules/hilavitkutin-workunit-mental-model.md` and skill `~/Dev/clause-dev/.claude/skills/hilavitkutin-workunit-thinking/SKILL.md` for the framing rules and decision tests.

## Scheduler shape

The scheduler type is `Scheduler<Cfg: RunCfg = DefaultRunCfg>`. The `RunCfg` associated type `Out` parameterises `run()`'s return shape:

```rust
pub fn run(&mut self) -> Cfg::Out
```

`DefaultRunCfg` gives `Cfg::Out = notko::Outcome<(), ()>` for consumers with no special run-config needs. `PipelineResult` is retired; consumers receive `Cfg::Out` directly. Consumers that need a custom output type register `.with(MyRunCfg)` and call `.build_with::<MyRunCfg>()` on the builder. Consumers using `DefaultRunCfg` call `.build()`.

`RunCfg` carries four tunable constants consumers override per application in their `impl RunCfg` block:

- `MAX_PLAN_AFFECTING_RESOURCES`: dirty-bitmask width. Default 256.
- `MICRO_MORSEL_INTERVAL`: records between inner-loop sync points. Default 64.
- `MAX_DRIFT_RECORDS`: max inter-fiber misalignment before forced realign. Default 32.
- `APPROACH_E_THRESHOLD`: record count above which the plan picks `ScheduleMega`. Default 10,000.

Two resource-replacement methods exist on `Scheduler<Cfg>`:

- `replace_resource<T: PlanAffecting>(&mut self, new: T)`: sets the dirty bit so the next `run()` recomputes the execution plan.
- `replace_value<T: Replaceable>(&mut self, new: T)`: swaps a resource's value without touching the plan.

## Stores registered on the scheduler builder

| Store | Kind | Registered via | Read by |
|---|---|---|---|
| `Workspace` | Resource | `.with(Resource::new(ws))` | `RunRunner`, `DiscoverFiles` |
| `CiState` | Resource | `.with(Resource::new(ci))` | `RunRunner` |
| `RunSurface` | Resource | `.with(Resource::new(surface))` | `RunRunner` |
| `ViolaConfig` | Resource | `.with(Resource::new(cfg))` | `LoadPlugins`, `DiscoverFiles`, `EmitDiagnostics` |
| `StringInterner<A>` | Resource | via `hilavitkutin-providers` | every WorkUnit handling `Str` |
| `ExtensionHost` | Resource | `.with(Resource::new(host))` | `RunRunner`, `RunLint<L>` |
| `FileInfo` | Column | `.with(Column::<FileInfo>::new())` | `RunRunner` |
| `Nam` | Column | `.with(Column::<Nam>::new())` | `RunLint<L>` |
| `Diagnostic` | Column | `.with(Column::<Diagnostic>::new())` | `EmitDiagnostics` |
| nine `*Metrics` Resources | Resource | via `MetricsKit` or individually | `AdaptWu` |
| `Virtual<AnomalyFired>` | Virtual | `.with(Virtual::<AnomalyFired>::new())` | observer WorkUnits |
| `Virtual<ScheduleEnd>` | Virtual | (meta-virtual, engine-fired) | `AdaptWu` |

The builder accumulates types in a `Cons`-list typestate. `.build()` enforces `Stores: ContainsAll<Wus::AccumRead> + ContainsAll<Wus::AccumWrite>` at compile time.

## WorkUnits

| WorkUnit | Schedule | Read | Write |
|---|---|---|---|
| `LoadConfig` | `Always` | `Resource<Args>`, `Resource<Env>` | `Workspace`, `CiState`, `RunSurface`, `ViolaConfig` |
| `LoadPlugins` | `Always` | `ViolaConfig` | `ExtensionHost` |
| `DiscoverFiles` | `Always` | `Workspace`, `ViolaConfig` | `Column<FileInfo>` |
| `RunRunner` | `Always` | `ExtensionHost`, `Workspace`, `CiState`, `RunSurface`, `Column<FileInfo>` | `Column<Nam>` |
| `RunLint<L>` (`COMMUTATIVE = Bool::TRUE`) | `Always` | `ExtensionHost`, `Column<Nam>` | `Column<Diagnostic>` |
| `EmitDiagnostics` | `Always` | `Column<Diagnostic>`, `ViolaConfig` | (writer provider) |
| `AdaptWu` (from `hilavitkutin-providers`) | `On<ScheduleEnd>` | nine `metrics::*` Resources | nine `metrics::*` Resources + `Virtual<AnomalyFired>` |

`AdaptWu` reads per-axis metrics Resources, threshold-compares each sample, writes back the updated snapshot including per-axis anomaly bools, and fires `Virtual<AnomalyFired>` when at least one axis threshold trips. Observer WorkUnits query individual `metrics::*` Resources to determine which axis fired.

`RunLint<L>` dispatches at runtime to `LintEvaluateVtable.evaluate` via `PROVIDER_LINT_EVALUATE`. The `COMMUTATIVE = Bool::TRUE` flag lets the scheduler emit a parallel fan-out across all `RunLint<L>` instances.

## Phase shape (computed by scheduler)

The scheduler derives this DAG from the declared AccessSets. Viola does not write a phase loop.

1. `LoadConfig`, then `LoadPlugins` (sequential; `LoadPlugins` reads `ViolaConfig`).
2. `DiscoverFiles` (reads `Workspace` + `ViolaConfig`).
3. `RunRunner` (writes `Column<Nam>`).
4. `RunLint<0>` through `RunLint<MAX_LINTS - 1>` parallel fan-out (all read `Column<Nam>`, all write `Column<Diagnostic>` commutatively).
5. `EmitDiagnostics`.
6. `AdaptWu` fires at `Virtual<ScheduleEnd>` (after step 5).

The scheduler fires four meta-virtual markers at schedule boundaries: `Virtual<PlanStage>` before plan computation, `Virtual<ScheduleReady>` after dispatch program assembly, `Virtual<PassStart>` before per-core dispatch, and `Virtual<ScheduleEnd>` after all phase barriers close. Consumer WorkUnits may observe any of these via `On<MarkerType>` scheduling.

## Cdylib boundary

`RunLint<const L: usize>` is a host-side WorkUnit compiled into viola. Its `execute` body:

1. Reads `Resource<ExtensionHost>` from context.
2. Looks up extension slot `L`. If empty, returns.
3. Calls `Extension::provider(PROVIDER_LINT_EVALUATE)`. If absent, returns.
4. Casts the `*const c_void` vtable pointer to `*const LintEvaluateVtable`.
5. Reads the `Column<Nam>` morsel slice and constructs a `NamPayload` pointer.
6. Calls `vtable.evaluate(host_ctx, nam_ptr, config_ptr, config_len, out_batch_ptr)`.

`LintEvaluateVtable` and `PROVIDER_LINT_EVALUATE` are defined in `viola-plugin-abi` (re-exported by `viola-core`). `LintEvaluateVtable.evaluate` takes `(host_ctx: *mut c_void, nam: *const NamPayload, lint_config_bytes: *const u8, lint_config_len: arvo::USize, out_batch: *mut DiagnosticBatch) -> AbiStatus`.

`ExtensionHost` is `hilavitkutin_extensions::ExtensionHost`, re-exported by `viola-core`. It is not a viola-owned type. `LoadPlugins` populates `Resource<ExtensionHost>` by calling `ExtensionHost::load` on each configured plugin path.

`MAX_LINTS` is a compile-time constant on the viola-cli binary. Unused slots silently no-op.

The full Shape D design is at `~/Dev/clause-dev/hilavitkutin/mock/research/202605232100_workunit-cdylib-boundary.md`. As of 2026-05-24 that memo is aligned with the landed ABI: canonical names `LintEvaluateVtable` / `PROVIDER_LINT_EVALUATE`, direct-args `evaluate(host_ctx, nam, config_bytes, config_len, out_batch)` signature, and `ExtensionHost` re-exported from `hilavitkutin-extensions` rather than viola-defined. The two original "deferred but load-bearing" #254 design questions are both resolved.

## Deferred but load-bearing

Both #254 design questions are now closed (resolved 2026-05-24 via three-parallel-specialist convergence). Captured here for the implementation record.

- **`LintCallCtx` wrapper vs. direct-args.** CLOSED 2026-05-23 via Option A: drop the wrapper, align with the landed direct-args ABI. The `LintEvaluateVtable.evaluate` signature takes `(host_ctx, nam, config_bytes, config_len, out_batch)` directly. `RunLint<L>::execute()` reads its Context accessors and unpacks them inline at the FFI call site; no aggregation type holds the args between read and call. See the cdylib boundary memo for the full reasoning.
- **Meta-virtual registration contract.** CLOSED 2026-05-24 via Option C, already landed. The mechanism: `WorkUnit` carries a `Schedule = Always` generic parameter; lifecycle-bound WUs implement `WorkUnit<On<Marker>>` where Marker is one of `PlanStage` / `ScheduleReady` / `PassStart` / `ScheduleEnd`. Registration follows the standard `.with(WuStruct::default())` path; the engine reads the `Schedule` type at plan-build time to route. Landed precedent: `impl WorkUnit<On<ScheduleEnd>> for AdaptWu` at `hilavitkutin-providers/src/adapt_wu.rs:63`. For viola: `LoadPlugins` implements `WorkUnit<On<PlanStage>>`, `SortAndEmitDiagnostics` (or equivalent) implements `WorkUnit<On<ScheduleEnd>>`, `RunLint<L>` WUs stay on default `Always`. The stores table's `Virtual<ScheduleEnd>` row should be re-read as "engine fires at this lifecycle boundary; WUs bound via `On<ScheduleEnd>` execute here."

## What dissolves (eventual state, not current source state)

The items below are the target state when viola task #254 lands. All of them still exist as interim scaffolding in current source.

- **`pipeline::run`**: dissolves when the scheduler drives the run. Currently live in `viola-core/src/pipeline.rs`.
- **`RunScope` as in-process state**: survives only as `#[repr(C)]` FFI wire shape, constructed inside `RunRunner::execute()` from Resources for one plugin call. Not where data lives.
- **`CaptureSink`**: dissolves. `Column<Diagnostic>` is the buffer.
- **`Session<N>` for plugin LIFO**: dissolves when `Resource<ExtensionHost>` lifetime becomes scheduler-owned. Currently live in `viola-core/src/session.rs`.
- **`Push<Diagnostic>` / `Len` / `DiagnosticSink`** in viola code: dissolves. Column writer accessor replaces the push-through-sink pattern.
- **`viola_core::aggregate::sort_diagnostics`**: dissolves when diagnostic ordering becomes a phase-boundary concern. Currently live in `viola-core/src/aggregate.rs`.
- **Manual `MaybeUninit` drop loops in viola-cli**: dissolves. Resource lifecycle becomes scheduler-owned.

## Pointers and refs in this picture

Per the workspace rule: refs and pointers inside cache-local intentional regions are fine. Refs into global storage reinvent the heap (forbidden by `no_alloc`).

Concrete examples that ARE fine:

- Inside `RunRunner::execute()`, the FFI `RunScope` struct holds `*const FileEntry` pointing into the `Column<FileInfo>` morsel slice for the duration of the FFI call. Cache-local, intentional, scoped to the call.
- `interner.resolve(s) -> Maybe<&str>` returns a borrow into the arena Resource. Scoped to the WorkUnit's `execute()` call.
- A WorkUnit's `execute(&self, ctx: &Self::Ctx<'_>)` borrows from the Context for the call duration.

NOT fine:

- A `*Ref<T>` / `StoreHandle` / `RegistryKey` type whose purpose is "access scheduler data from outside a WorkUnit's execution".
- A `pub struct AppState` holding viola state with methods.
- A `pub static` / `OnceCell` carrying scheduler data.
- A `<'a>` lifetime on a consumer-public type tracking "borrowed from store".

## What's left in viola crates

- **`viola-plugin-abi`**: unchanged by the restructure. The `#[repr(C)]` FFI wire types (`RunScope`, `NamPayload`, `Diagnostic`, `FileEntry`, descriptor, vtables, `BytesRef`) stay exactly as ABI v1 specifies. Plugins are unaffected.
- **`viola-config`**: parses viola.toml into `ViolaConfig` POD. The parsed value becomes the contents of `Resource<ViolaConfig>`.
- **`viola-core`**: defines:
  - The WorkUnit types (`LoadConfig`, `LoadPlugins`, `DiscoverFiles`, `RunRunner`, `RunLint<L>`, `EmitDiagnostics`) and their Read/Write AccessSets.
  - The Resource value types (`Workspace`, `CiState`, `ViolaConfig`).
  - The Column record types (`FileInfo`, `Nam`, `Diagnostic`).
  - The `Role` enum (the role classification, not the bitset; the bitset is `arvo_bitmask::Mask64`).
  - Domain helpers used inside WorkUnits (FFI marshal helpers, severity classifiers, etc.).
  - Re-exports of `hilavitkutin_extensions::ExtensionHost` and `viola_plugin_abi::{LintEvaluateVtable, PROVIDER_LINT_EVALUATE, ...}`.
- **`viola-cli`**: a thin `main()` that:
  1. Builds the scheduler with the WorkUnits + Resources + Columns registered.
  2. Wires `hilavitkutin-providers` defaults (`StandardAdaptKit`, `MetricsKit`, `AdaptWu`, `InternerProvider`, `MemoryProvider`, `ColumnStorage`, `ThreadPool`, `Clock`).
  3. Calls `.run()`.
  4. Exits with the right status (looked up from final `Resource<RunSummary>` or computed from `Column<Diagnostic>` stats).

## Prerequisite chain

#254 (the restructure) has one remaining prerequisite:

1. **#225: viola repo gains mockspace workflow shape.** Adds `viola/mock/` scaffolding so the restructure happens under formal design-round flow. Existing docs (this one, `PLUGIN-ABI-V1-DESIGN.md`, `VIOLA-TOML-V2-SCHEMA.md`) migrate into template form.

`hilavitkutin-providers` (#253) is substantially shipped: the adapt subsystem (`AdaptWu`, `MetricsKit`, `StandardAdaptKit`, `OffAdaptKit`, nine `*Metrics` Resources) is live. Remaining #253 items (executor body, Pass 7 + Pass 8 wiring) are orthogonal to viola's structural shift and no longer block #254.

## Status

As of 2026-05-24: design phase, updated against locked megaround 202605101036. Implementation begins after #225 lands.

## References

- Workspace rule: `~/Dev/clause-dev/.claude/rules/hilavitkutin-workunit-mental-model.md`
- Workspace skill: `~/Dev/clause-dev/.claude/skills/hilavitkutin-workunit-thinking/SKILL.md`
- Workspace rule (sibling): `~/Dev/clause-dev/.claude/rules/use-the-stack-not-reinvent.md`
- Locked megaround: `~/Dev/clause-dev/hilavitkutin/mock/design_rounds/202605101036/`
- Cdylib boundary memo: `~/Dev/clause-dev/hilavitkutin/mock/research/202605232100_workunit-cdylib-boundary.md`
- hilavitkutin design: `~/Dev/clause-dev/hilavitkutin/mock/PRINCIPLES.md.tmpl` + scheduler section in `mock/crates/hilavitkutin/DESIGN.md.tmpl`
- WorkUnit/AccessSet contract: `~/Dev/clause-dev/hilavitkutin/mock/crates/hilavitkutin-api/DESIGN.md.tmpl`
- Plugin ABI: `viola/docs/PLUGIN-ABI-V1-DESIGN.md` (unchanged by this restructure)
- Config schema: `viola/docs/VIOLA-TOML-V2-SCHEMA.md` (parsed value becomes `Resource<ViolaConfig>`)

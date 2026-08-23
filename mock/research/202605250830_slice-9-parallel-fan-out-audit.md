# Slice 9: viola parallel fan-out audit

**Date:** 2026-05-25 **Scope:** Confirm that `RunLint<L>`'s
`const COMMUTATIVE: arvo::Bool = arvo::Bool::TRUE` declaration flows correctly
through hilavitkutin's plan stage, and document the exact gap between that
declaration and the runtime fan-out that the engine will eventually exercise.
**Source ticket:** Task #254 (`Viola becomes a hilavitkutin app`). Named in
`mock/crates/viola-core/src/wus/run_lint.rs:71-72` as the work that "audits the
landed hilavitkutin dispatch codegen to confirm the flag yields reduce-style
parallel fan-out (vs serialising)."

## TLDR

The COMMUTATIVE flag is correctly declared on `RunLint<L>` and is correctly
plumbed through hilavitkutin's plan stage into `plan.unit_meta[u].commutative`
at `hilavitkutin/mock/crates/hilavitkutin/src/plan/mod.rs:334`. Dispatch stage
`codegen_fiber` / `codegen_core` are currently skeleton stubs (PR #82) that do
not consume the flag; `Scheduler::run` is a no-op transitional body (PR #83)
that returns `Cfg::Out::default()` without executing the morsel loop. The flag's
runtime effect (reduce-style parallel fan-out across the 32
`RunLint<0..MAX_LINTS>` instances) lands when the LLVM-driven dispatch body
ships (BACKLOG entry on hilavitkutin side, separate from #254's viola-side
scope). Today the fan-out is type-level correct and plan-stage proven; runtime
is no-op-shaped pending the engine megaround follow-up.

## What was audited

Three files exercise the load-bearing claim:

1. `viola/mock/crates/viola-core/src/wus/run_lint.rs:49-73`:
   `pub struct RunLint<const L: usize>;` with `impl WorkUnit for RunLint<L>`
   declaring
   `type Read = Cons<Resource<ExtensionHost>, Cons<Resource<LintSlots>, Cons<Resource<LintConfigBuffer>, Cons<Column<Nam>, Empty>>>>`,
   `type Write = Cons<Column<WuDiagnostic>, Cons<Resource<DiagnosticCounts>, Empty>>`,
   and `const COMMUTATIVE: arvo::Bool = arvo::Bool::TRUE`.

2. `viola/mock/crates/viola-cli/src/main.rs:66-90` (sampled): `register_lints!`
   macro unrolls 32 `.with(RunLint::<N>)` calls for N=0 through N=MAX_LINTS-1.
   Each instance is a distinct monomorphisation; the scheduler builder typestate
   proves `Stores: ContainsAll<Wus::AccumRead> + ContainsAll<Wus::AccumWrite>`
   for the full cons-list at build time.

3. `hilavitkutin/mock/crates/hilavitkutin/src/plan/mod.rs:334`:
   `plan.unit_meta[u].commutative = inputs.commutative[unit_id_idx]`. The
   COMMUTATIVE flag declared on each `RunLint<L>` WU surfaces in plan inputs
   (per `plan/inputs.rs:26-27`'s `pub commutative: [Bool; MAX_UNITS]`) and lands
   in `plan.unit_meta[u].commutative` keyed by topo-position.

## What is shipped, what is no-op

### Shipped

- Per-L type-level disjoint AccessSet declarations: each `RunLint<L>` writes to
  the same `Column<WuDiagnostic>` and same `Resource<DiagnosticCounts>` but with
  run-time-disjoint slot ranges
  (`L * MAX_DIAGS_PER_LINT, (L+1) * MAX_DIAGS_PER_LINT` for the column, slot `L`
  for the counts resource).
- Compile-time L-bound guard at `run_lint.rs:86-88`:
  `const { assert!(L < MAX_LINTS, "..."); }` catches L-out-of-bounds at
  monomorphisation time.
- Column-capacity contract: documented at module head (`run_lint.rs:17-25`) and
  enforced at the writer boundary via `debug_assert!` at `run_lint.rs:198-201` +
  `run_lint.rs:253-256`.
- The COMMUTATIVE-flag plumbing through plan inputs into `unit_meta`:
  `plan/mod.rs:334`. Plan stage knows which units are commutative.
- Plan-stage HeadTailConvergence record: declared at `plan/fiber.rs:137-147`
  with the comment at lines 132-133 explicitly listing COMMUTATIVE as one of
  four head+tail eligibility conditions (others: single-trunk-phase,
  record-count-threshold-met, accumulation-compatible).

### No-op today

- `dispatch::codegen_fiber` and `dispatch::codegen_core` return empty skeleton
  constructors (`FiberDispatch::new()` / `CoreDispatch::new()` per PR #82). The
  plan-stage `commutative` field is read by neither path. The skeleton fields
  are pinned by the codegen_stub_tests, but the body that translates a
  commutative-true unit into a head+tail convergence fiber is the LLVM-driven
  monomorphisation work (BACKLOG entry on hilavitkutin side).
- `Scheduler::run` returns `Cfg::Out::default()` per PR #83 (no-op transitional
  body under method-level `where Cfg::Out: Default` bound). No morsel loop runs.
  The 32 RunLint instances never execute at runtime today.
- `thread::steal_fallback` stays `todo!()` separately (Executor trait gate; not
  on Slice 9's critical path).

## Soundness assessment

The viola-side declaration is type-level correct under the engine's current
contracts:

1. **Disjoint-row-range claim**: per-L row range
   `[L * MAX_DIAGS_PER_LINT, (L+1) * MAX_DIAGS_PER_LINT)` is provably disjoint
   for distinct L by construction. The const-eval guard prevents L >= MAX_LINTS
   misuse. The column-capacity contract is documented and
   `debug_assert!`-enforced.
2. **COMMUTATIVE flag semantics**: the engine's WorkUnit trait
   (`hilavitkutin-api/src/work_unit.rs:70`) declares
   `const COMMUTATIVE: Bool = Bool::FALSE` as the default; RunLint's override to
   `Bool::TRUE` is the explicit opt-in that the plan stage consumes correctly.
3. **AccessSet shape**: Read = 4 resources/columns, Write = 1 column + 1
   resource. Both cons-lists are well-formed; the `ContainsAll` typestate at
   scheduler build time verifies the AccumRead + AccumWrite projection (proven
   at viola-cli's `Scheduler::builder()...build()` call site).
4. **Per-L distinct slot writes to DiagnosticCounts**: `write_count::<L>` writes
   to slot `L` of the counts resource; concurrent RunLint<L'> writes for
   distinct L touch disjoint slots, so the write commutes under the COMMUTATIVE
   flag contract.

No design issues found on the viola side. The audit confirms the cohort dispatch
shape is sound at the type and plan-stage levels.

## What ships when the engine body lands

When the dispatch codegen body lands (separate hilavitkutin LLVM-driven
megaround), the plan-stage `commutative=true` claim flows into one of two
codegen paths per `plan/fiber.rs:132-133`'s eligibility test:

- **Head+tail convergence** (when all four eligibility conditions hold): each
  commutative fiber gets a HeadTailConvergence record naming `head_accum` /
  `tail_accum` / `merge_target` / `merge_op`. The morsel loop dispatches two
  walkers (forward from head, backward from tail) that meet at the convergence
  point. For RunLint<0..31> this would mean cohort-parallel dispatch with a
  deterministic merge over per-L disjoint slot ranges.
- **Parallel-fan-out without head+tail** (when at least one eligibility
  condition fails, e.g. record-count below threshold for the head+tail
  amortisation win): commutative units still dispatch in parallel but without
  the two-ended walker pattern. Single-walker parallel fan-out over the 32
  monomorphised RunLint<L> instances.

Either codegen path realises the cohort parallelism the viola side already
claims. Neither today.

## What this audit explicitly does NOT do

- Does not propose body changes to `codegen_fiber` / `codegen_core` /
  `Scheduler::run`. Those are the engine megaround's follow-up scope,
  BACKLOG-tracked, gated on `hilavitkutin-build` LLVM-plugin machinery.
- Does not propose runtime tests that exercise parallel fan-out behaviour.
  Without the engine body, such tests would only confirm the no-op shape, which
  the engine-side integration test at
  `hilavitkutin/tests/scheduler_run.rs:scheduler_run_returns_default_outcome`
  already covers.
- Does not propose viola-side changes. The RunLint<L> declaration is correct as
  shipped.

## Recommendation

Mark this audit as the lock-criterion artefact for the "Slice 9 viola parallel
fan-out audit" follow-up. The Slice 9 verdict is: viola side is correct, engine
side is no-op transitional pending LLVM-driven megaround. No code change
required on either side as a result of this audit; the gap closes when the
engine ships the dispatch body.

## See also

- `viola/mock/crates/viola-core/src/wus/run_lint.rs` (the WU under audit).
- `viola/mock/crates/viola-cli/src/main.rs:66-114` (the register_lints! macro
  that unrolls the cohort).
- `hilavitkutin/mock/crates/hilavitkutin/src/plan/mod.rs:283-343` (plan runner
  that propagates the commutative flag into unit_meta).
- `hilavitkutin/mock/crates/hilavitkutin/src/plan/fiber.rs:129-164`
  (HeadTailConvergence eligibility doc).
- `hilavitkutin/mock/crates/hilavitkutin/src/dispatch/mod.rs` (codegen stubs
  awaiting LLVM body).
- `hilavitkutin/mock/crates/hilavitkutin/src/scheduler/mod.rs::run` (no-op
  transitional body).
- Engine-side BACKLOG entries for `codegen_fiber` / `codegen_core` LLVM-driven
  monomorphisation, `Scheduler::run` morsel loop, `steal_fallback` Executor
  trait gate.

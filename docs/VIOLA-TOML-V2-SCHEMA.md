# viola.toml v2 schema design memo

Status: design. Not yet implemented. This memo lives in the repo as a
signoff target before the implementation work in [#221](https://github.com/hiisi-digital/viola/issues/221) lands.

## Goal

Express the same vocabulary the TS-side `viola.config.ts` carries
today, in a TOML file Rust-side viola consumers can author. The Rust
runtime parses this no_std + no_alloc, the deno-runtime path bridges
the parsed shape into the TS plugin world, and v1-compat (`runner`,
`grammars`, `lints`, `[ts]`) keeps already-shipped configs working.

The TS builder is fluent and hosts closures. TOML cannot host
closures, so the port flattens the builder's *resolved state* (what
the chain produces) rather than the chain itself. Every concept the
TS user reaches for has a declarative TOML form below.

## TS vocabulary (the source)

From the existing `@hiisi/viola/viola/src/config/`:

- **Plugins**: list of module specifiers (`jsr:`, `npm:`, file path,
  URL). Loaded module exports a `ViolaPlugin` object; the builder
  applies its side effects.
- **Inherit**: named preset list. Plugins export presets as named
  bundles of rules; the user opts in by name.
- **Severity rules**: ordered list of (issue-pattern, file-pattern,
  severity) triples. CSS-style "last wins". Issue patterns are a
  small DSL: `linter/issue`, `linter/*`, `*::category`,
  `*>=impact`, combinable.
- **Per-linter config**: `.set("linter-name", { ... })`. Validated
  against plugin-exported JSON schemas at runtime.
- **Conditions**: compound boolean algebra over impact / category /
  file / linter / confidence atoms. Compound (`and` / `or` / `not`).
- **Severity enum**: `error | warn | info | hint | off | skip`.
- **Impact ladder**: `critical > major > minor > trivial` (lower
  index = more severe).
- **Categories**: `correctness | maintainability | consistency |
  performance | style`.
- **Confidence**: integer 0-100; rules can gate on `min_confidence`.

## Mapping principles

1. **Resolved state, not chain.** `viola().use(p).rule(r1).rule(r2)`
   resolves to (plugins, [r1, r2]). TOML names the resolved arrays.
2. **One vocabulary, two surfaces.** A user with `viola.config.ts`
   keeps it; a user with `viola.toml` uses it. The deno-runtime path
   (when `[ts] config = "..."` is set) is the bridge: TS users do
   not migrate; only Rust-runtime users use this schema directly.
3. **Issue-pattern DSL retained verbatim.** `linter/*::correctness>=major`
   parses identically on both sides. Mockspace's lint-pattern
   conventions and viola's converge.
4. **Condition algebra via nested tables.** `and` / `or` / `not`
   become array-of-tables with reserved keys.
5. **No closures, no callbacks.** Plugins still expose presets; the
   user names presets by string. Per-linter config validation
   happens runtime-side, not at parse time.

## v2 schema

```toml
# Optional schema marker. When absent, parser assumes v1 shape and
# applies the v1-compat rules below.
[viola]
version = 2

# Plugin specifiers. Each is one of:
#   - file path to a Rust cdylib (e.g. "plugins/rust-grammar.dylib")
#   - "jsr:<scope>/<pkg>": TS plugin via deno-runtime
#   - "npm:<pkg>": TS plugin via deno-runtime
#   - "https://...": TS plugin via deno-runtime
# Role (runner / grammar / lint) is derived from the descriptor's
# capability table, not declared here.
plugins = [
  "plugins/viola-rust-runner.dylib",
  "plugins/viola-rust-grammar.dylib",
  "jsr:@hiisi/viola-default-lints",
]

# Optional preset inheritance. Each entry is a preset name exported
# by a plugin in `plugins`. Applied in order; user-authored rules
# below override preset rules ("last wins").
#
# `plugins` and `inherit` accept either placement: directly under
# the [viola] header (as shown here, matching the natural reading
# order) or at the top of the file before any section header. They
# write to the same fields either way; declaring the same key in
# both places is a duplicate-key error.
inherit = ["@hiisi/recommended"]

# Gate thresholds. Two layers:
#
# 1. Bare keys directly under [gates] are the global default for
#    any lint without an explicit override.
# 2. [gates.<lint-id>] overrides the global default per lint. This
#    matches mockspace.toml's `[lints.<name>] commit = "..."`
#    convention, so a viola.toml that absorbs mockspace's per-lint
#    severity policy reads almost identically.
#
# Resolution order at gate time, for a given lint and gate name:
# explicit [gates.<lint>].<gate> -> [gates].<gate> -> built-in
# default ("error"). Missing keys fall through silently; this
# means a per-lint table can override one gate while inheriting
# the others from the global block.
[gates]
commit = "warn"
build = "error"
push = "error"

[gates.no-bare-numeric]
commit = "warn"
build = "error"
push = "error"

[gates.duplicate-logic]
commit = "off"   # do not block at commit
build = "warn"   # warn but do not block at build
push = "error"   # block at push

# Per-linter config. The key is the linter id; the value is an
# inline table whose shape the plugin documents and validates.
[lint.duplicate-logic]
ignoreFunctions = ["impactCond", "categoryCond"]

[lint.orphaned-code]
publicApiFiles = [
  "src/utils/hash.ts",
  "src/linters/base.ts",
]

# Severity rules. Array-of-tables; evaluated top-to-bottom against
# each (issue, file) pair; later matches override earlier matches.
# This is the declarative equivalent of the TS
# `.rule(report.X, when.<...>)` chain.
[[severity]]
issue = "*"
files = "**/*_test.ts"
level = "off"

[[severity]]
issue = "duplicate-logic/*"
level = "warn"

[[severity]]
issue = "*::correctness>=major"
files = ["src/**", "lib/**"]
level = "error"
min_confidence = 80

# Severity rules can scope to a gate. Useful when the per-lint
# [gates.<lint>] table is too coarse, e.g. "this lint is `off` at
# commit only for files under fixtures/, but otherwise honours its
# normal severity at every gate".
[[severity]]
issue = "no-bare-numeric/*"
files = "**/fixtures/**"
gate = "commit"
level = "off"

# Compound conditions: `all` (and), `any` (or), `not`. Each entry
# inside `all` / `any` is a partial severity rule (subset of the
# fields above). `not` takes a single rule. Mutually exclusive with
# `issue` / `files` at the same level.
[[severity]]
level = "warn"
all = [
  { issue = "duplicate-logic/*" },
  { files = "src/**" },
]

[[severity]]
level = "off"
any = [
  { files = "**/*_test.ts" },
  { files = "**/fixtures/**" },
]

# v1 keys retained for compat. When `[viola].version` is absent or 1,
# the parser accepts the v1 shape and translates internally:
#   runner = "X"     -> plugins = ["X"], role pinned by descriptor
#   grammars = [...] -> plugins = [...], roles pinned by descriptors
#   lints = [...]    -> plugins = [...], roles pinned by descriptors
# When version = 2, presence of any v1 key is a parse error
# (encourages users to consolidate via `plugins`).
runner = "plugins/runner.dylib"
grammars = ["plugins/grammar-rust.dylib"]
lints = ["plugins/lint-style.dylib"]

# `[ts]` section is unchanged from v1; both v1 and v2 honour it.
# When present, the deno-runtime cdylib auto-loads sibling-to-exe
# and acts as runner + grammar + lint, with the user's TS config
# providing the actual rules.
[ts]
config = "viola.config.ts"
```

## Issue pattern grammar (verbatim from TS)

```
pattern   ::= linter "/" issue selector?
            | linter "/*" selector?
            | "*" selector?
selector  ::= "::" category
            | ">=" impact
            | "::" category ">=" impact
linter    ::= identifier
issue     ::= identifier
category  ::= "correctness" | "maintainability" | "consistency"
            | "performance" | "style"
impact    ::= "critical" | "major" | "minor" | "trivial"
```

Examples:

| Pattern | Matches |
|---|---|
| `duplicate-logic/lambda-too-similar` | one exact issue |
| `duplicate-logic/*` | all issues from one linter |
| `*::correctness` | every correctness issue, any linter |
| `*>=major` | every major-or-worse issue, any linter |
| `style-guide/*::style>=minor` | style-guide issues in `style` category at or above `minor` |

## Severity / impact / category enums

| Severity | Meaning |
|---|---|
| `error`  | block at gate threshold |
| `warn`   | report, do not block |
| `info`   | informational |
| `hint`   | dim suggestion |
| `off`    | suppress |
| `skip`   | suppress and short-circuit linter run on file |

| Impact | Index | Meaning |
|---|---|---|
| `critical` | 0 | severity baseline (highest) |
| `major`    | 1 | |
| `minor`    | 2 | |
| `trivial`  | 3 | (lowest) |

`>=` semantics: `>=major` matches `critical` and `major`. The smaller
index wins; the comparison is `index <= threshold_index`.

| Category | |
|---|---|
| `correctness`     | logic / behaviour bugs |
| `maintainability` | code-health concerns |
| `consistency`     | style consistency |
| `performance`     | runtime cost |
| `style`           | aesthetic-only |

## Conditions: TS to TOML

| TS surface | TOML equivalent |
|---|---|
| `when.in("src/**")` | `files = "src/**"` (single) or `files = ["src/**"]` (multi) |
| `when.impact.atLeast(Major)` | issue selector `>=major` |
| `when.category("correctness")` | issue selector `::correctness` |
| `when.linter("style-*")` | issue prefix `style-*/` |
| `when.confidence.atLeast(80)` | `min_confidence = 80` |
| `c1.and(c2)` | `all = [c1, c2]` |
| `c1.or(c2)` | `any = [c1, c2]` |
| `c.not()` | `not = c` |

## Gate resolution model

For each diagnostic the runtime captures, the gate decision answers
"does this block the active gate?". The decision is a chain:

1. Determine the diagnostic's effective severity. Start with the
   intrinsic severity the lint emitted. Walk `[[severity]]` rules
   top-to-bottom; a rule whose conditions match the (issue, file,
   gate, confidence) tuple replaces the severity. Last match wins.
   Rules without a `gate` field apply at every gate; rules with
   `gate = "commit"` apply only at the commit gate, etc.
2. Resolve the gate threshold for this lint at this gate.
   `[gates.<lint-id>].<gate>` if present, else `[gates].<gate>`,
   else the built-in `"error"` default.
3. Compare effective severity to the threshold. Blocks iff
   `severity_index <= threshold_index` (smaller index = more
   severe; `error < warn < info < hint < off`).

This three-step shape gives mockspace parity (per-lint per-gate
severity via `[gates.<lint-id>]`) plus the additional axis viola
inherited from the TS side (severity rules per (issue, file,
gate)). Users authoring viola.toml from a mockspace.toml only need
the `[gates.<lint>]` block; users coming from the TS side reach for
`[[severity]]`.

## Mockspace migration shape

`mockspace.toml`:

```toml
[lints.no-bare-numeric]
commit = "warn"
build = "error"
push = "error"
```

`viola.toml` (v2):

```toml
[gates.no-bare-numeric]
commit = "warn"
build = "error"
push = "error"
```

The translation is the table rename `lints.<name>` -> `gates.<name>`
(plus the optional `[viola] version = 2` marker). Per-linter config
that lived in mockspace.toml's `[lints.<name>]` body alongside
gate keys (rare today, but possible) splits between
`[gates.<name>]` (gate keys) and `[lint.<name>]` (plugin config
keys). #200's migration tool will handle this split.

## v1 → v2 migration

Three states:

1. **Pre-v1 / no `viola.toml`.** Pure-TS path. viola-cli execvp's
   into `deno run -A jsr:@hiisi/viola-cli`. Unchanged by v2.

2. **v1 `viola.toml`** (no `[viola].version`, has `runner` /
   `grammars` / `lints` / `[ts]` keys). Continues to parse and run
   as today. The parser internally translates to v2 shape; the user
   notices nothing.

3. **v2 `viola.toml`** (`[viola].version = 2`). The full schema
   above is required. v1 keys are a parse error to prevent silent
   schema drift.

A `viola migrate` subcommand is out of scope for #221; users who
want v2 features rewrite by hand (the schema is small enough that
this is fine).

## Reserved keys

The parser rejects unknown top-level keys deterministically (per the
existing `ConfigError::UnknownKey`). Reserved tables for future use:

- `[mockspace]`. Context bridge (#222).
- `[scope]`. Explicit include/exclude/extensions; today implicit
  via runner walk, tabled until a real use surfaces.
- `[plugins.<name>]`. Plugin-pinned versions / hashes; tabled.

## Implementation slices (post-signoff)

Once this memo lands, implementation splits into:

1. **PR-A**: parser supports `[viola] version = 2`, `plugins`,
   `inherit`, `[gates]`. v1 keys become parse errors when version=2
   is set. v1 path unchanged.
2. **PR-B**: `[lint.<name>]` per-linter config blocks. Stored as raw
   bytes / TOML subtree handed to plugins via `LintConfig`.
3. **PR-C**: `[[severity]]` rules, both flat and compound. Issue
   pattern parser. `min_confidence` field.
4. **PR-D**: viola-cli wires the new config through the runtime:
   gate threshold against captured severities; severity-rule
   evaluation in DiagnosticSink; preset inheritance lookup.
5. **PR-E**: docs + examples + tests against fixture configs ported
   from the TS-side example.

Each slice is independently mergeable. Slice 1 is the smallest
forward step.

## Open questions

1. **Inherit ordering and conflict resolution.** TS resolves preset
   chains depth-first, last wins. Two presets that both set
   `lint.duplicate-logic.ignoreFunctions` to disjoint lists: do we
   union or replace? TS-side replaces. Memo recommends matching TS.
2. **`min_confidence` on compound conditions.** Putting
   `min_confidence` at the top level alongside `all = [...]` mixes
   atom-level and compound concepts. Cleanest: every condition atom
   (in `all`, `any`, top-level flat form) accepts `min_confidence`.
   Compound nodes do not.
3. **Issue pattern overlap detection.** TS does not warn on
   overlapping rules that produce ambiguous "last wins" results.
   The Rust parser could surface a soft diagnostic at parse time;
   tabled.
4. **Plugin role inference vs declaration.** v2 derives role from
   the descriptor's capability table. A plugin that exports both
   `CAP_RUNNER_EXECUTE_SCOPE` and `CAP_LINT_EVALUATE` (multi-role)
   is implicitly enrolled in both. Per #220's "rust-grammar +
   rust-runner" plan this is the right shape; flagging in case a
   future plugin wants to opt out of one role at config time.

## Non-goals for v2

- Per-issue suppress comments (`// viola:allow(...)` etc.). That
  belongs in source-code conventions, not config.
- Workspace-aware multi-config aggregation. Each subdir's
  `viola.toml` is independent; mockspace #222 is the upstream of
  any cross-tree concern.
- A `[severity.<linter>.<issue>]` heredoc form. Array-of-tables is
  TOML-idiomatic; lookup tables would be cuter but break the
  ordering semantic that "last wins" depends on.

# Parked branches

Twenty-two branches from late April 2026 are held rather than merged or closed.
They carry finished, locally reviewed work that a change of direction overtook.
This file says what each holds so the next person deciding does not have to
reconstruct it from a branch listing.

## Why they are parked and not merged

They touch the Rust side under `mock/`, and a Rust rewrite is in flight. Merging
into a tree mid-rewrite produces a conflict nobody can untangle, and the work is
too finished to throw away: each branch carries a feature commit and a `fix:`
commit answering a local review, and the series is numbered against its issue
(`#221 PR-A` and siblings).

## Why they are parked and not closed

They never failed review. `dev` moved forty-one commits in the same window on
something else, a `Provider` migration and the hilavitkutin adoption, and the
stack was left where it stood. Closing them would record a rejection that never
happened.

Each sits 75 to 97 commits behind `dev`, so none of them merges cleanly today
regardless. Whoever picks one up is re-landing it against a tree that has moved,
which is a decision about the rewrite rather than about the branch.

## What each holds

| Branch                                     | Rust files | What it is                                              |
| ------------------------------------------ | ---------- | ------------------------------------------------------- |
| `feat/viola-no-std-rewrite`                | 31         | the no_std rewrite of the core                          |
| `feat/viola-core-host-loader`              | 18         | host loader, validation, lifecycle, capability dispatch |
| `feat/viola-core-host-body`                | 9          | the host body the loader drives                         |
| `feat/substrate-reuse-tier-1`              | 6          | first tier of substrate reuse                           |
| `feat/viola-deno-runtime-rename`           | 5          | the deno runtime rename                                 |
| `feat/viola-cli-host-executable`           | 4          | the cli as a host executable                            |
| `feat/viola-config-v2-pr-c-severity-rules` | 4          | severity rules for the v2 config                        |
| `feat/viola-config-v2-pr-a-skeleton`       | 3          | the viola.toml v2 parser skeleton                       |
| `feat/viola-deno-runtime-es-modules`       | 3          | es modules in the deno runtime                          |
| `feat/viola-deno-runtime-subprocess`       | 3          | the subprocess path                                     |
| `feat/viola-pipeline-end-to-end`           | 3          | an end-to-end run with a runner and lint fixture pair   |
| `feat/substrate-reuse-tier-2`              | 2          | second tier of substrate reuse                          |
| `feat/viola-config-pr-d-2-gate-filtering`  | 2          | gate filtering                                          |
| `feat/viola-config-toml-parser`            | 2          | the toml parser                                         |
| `feat/viola-config-v2-pr-b-lint-blocks`    | 2          | lint blocks                                             |
| `feat/viola-config-v2-pr-c2-compound`      | 2          | compound severity                                       |
| `feat/viola-bridge-deno-scaffold`          | 1          | the deno bridge scaffold                                |
| `feat/viola-cli-ts-passthrough`            | 1          | cli passthrough to typescript                           |
| `feat/viola-cli-v2-plugin-loading`         | 1          | v2 plugin loading                                       |
| `fix/viola-cli-capture-sink-deep-copy`     | 1          | a deep copy in the capture sink                         |
| `fix/viola-cli-resolve-ts-config-path`     | 1          | resolving the ts config path                            |
| `test/viola-cli-passthrough-conformance`   | 1          | passthrough conformance tests                           |

## Not parked

`feat/async-lints` touches two TypeScript files and no Rust, so the rewrite does
not reach it. `docs/viola-toml-v2-schema` is one schema file. Both are judged on
their own merits rather than held.

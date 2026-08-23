//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * What a condition is, and what it is evaluated against.
 *
 * One shape. There used to be two: a data union under `src/config/` that the
 * runtime evaluated, and an interface with `evaluate`/`and`/`or` methods here
 * that nothing ever ran. They disagreed about `Impact`, about `Category`, and
 * about what an `EvaluationContext` carries, so a grammar rule written against
 * one could not be handed to the other. That is why `grammar("ts")
 * .overrides("js")` was documented and did nothing.
 *
 * A condition is data, like a comparison, and for the same reasons: the config
 * is frozen, an explanation has to be able to print why a rule fired, and a
 * closure cannot be either of those.
 *
 * Every condition that asks about a value asks it through a `ComparisonData`,
 * so there is one place that knows how to compare and one place that knows how
 * to reach into a context.
 *
 * @module
 */

import type { ComparisonData } from "./comparison.ts";
import type { Category, Impact } from "./vocabulary.ts";

// =============================================================================
// What a condition can be asked about
// =============================================================================

/**
 * The file a condition is being evaluated for.
 */
export interface FileContext {
  /** Path relative to the project root */
  readonly path: string;
  /** Extension including the dot, so `.ts` rather than `ts` */
  readonly extension: string;
  /** Which grammar parsed it, empty when nothing has yet */
  readonly grammarId: string;
}

/**
 * The issue a condition is being evaluated for, flattened.
 *
 * Impact and category come from the reporting linter's catalog rather than
 * from the issue, and a condition should not have to know that. Whoever builds
 * this context does the lookup once.
 */
export interface IssueContext {
  /** The linter or grammar that reported it */
  readonly by: string;
  /** Full kind, `linter-id/issue-name` */
  readonly kind: string;
  /** The issue name alone, without the linter id */
  readonly name: string;
  /** From the catalog, absent when the catalog has no entry for this kind */
  readonly impact?: Impact;
  /** From the catalog, absent when the catalog has no entry for this kind */
  readonly category?: Category;
  /** How sure the linter is, 0 to 100 */
  readonly confidence: number;
  /** Where it was found */
  readonly line: number;
  /** Where it was found, when the linter knows */
  readonly column?: number;
}

/**
 * Everything a condition may look at.
 *
 * `file` and `issue` are both optional because a condition is evaluated in
 * more than one situation: which grammars run for a file has no issue yet, and
 * classifying an issue always has both. A condition that asks about something
 * absent is false rather than an error, so a rule cannot accidentally widen
 * because it was evaluated too early.
 */
export interface EvaluationContext {
  readonly file?: FileContext;
  readonly issue?: IssueContext;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly projectRoot: string;
}

// =============================================================================
// The conditions
// =============================================================================

/** How severe the issue is, per the reporting linter's catalog. */
export interface ImpactCondition {
  readonly type: "impact";
  readonly comparison: ComparisonData<Impact>;
}

/** What kind of problem it is, per the catalog. */
export interface CategoryCondition {
  readonly type: "category";
  readonly comparison: ComparisonData<Category>;
}

/** How sure the linter was. */
export interface ConfidenceCondition {
  readonly type: "confidence";
  readonly comparison: ComparisonData<number>;
}

/** Which linter reported it. Matched against the linter id and the full kind. */
export interface LinterCondition {
  readonly type: "linter";
  readonly comparison: ComparisonData<string>;
}

/** Which issue it is, by name within its linter. */
export interface KindCondition {
  readonly type: "kind";
  readonly comparison: ComparisonData<string>;
}

/**
 * Which file.
 *
 * Reads the file context when there is one and falls back to the issue's own
 * location, so `when.in("src/**")` means the same thing whether it is deciding
 * which grammars run or how to classify a finding.
 */
export interface FileCondition {
  readonly type: "file";
  readonly comparison: ComparisonData<string>;
}

/** Which grammar parsed the file. */
export interface GrammarCondition {
  readonly type: "grammar";
  readonly comparison: ComparisonData<string>;
}

/**
 * An environment variable.
 *
 * With no comparison the condition asks only whether the variable is set,
 * which is what `when.env("CI").exists()` means.
 */
export interface EnvCondition {
  readonly type: "env";
  readonly name: string;
  readonly comparison?: ComparisonData<string>;
}

/**
 * Holds for everything, or for nothing.
 *
 * Its own arm rather than something contrived out of another condition, so a
 * reader of a config's data sees what was meant.
 */
export interface ConstantCondition {
  readonly type: "always" | "never";
}

/** Several conditions, all of them or any of them. */
export interface CompoundCondition {
  readonly type: "compound";
  readonly operator: "and" | "or";
  readonly conditions: readonly Condition[];
}

/** The opposite of a condition. */
export interface NotCondition {
  readonly type: "not";
  readonly condition: Condition;
}

/**
 * A condition.
 */
export type Condition =
  | ImpactCondition
  | CategoryCondition
  | ConfidenceCondition
  | LinterCondition
  | KindCondition
  | FileCondition
  | GrammarCondition
  | EnvCondition
  | ConstantCondition
  | CompoundCondition
  | NotCondition;

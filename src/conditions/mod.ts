//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Conditions: the vocabulary an issue is classified in, the comparisons that
 * ask about it, the `when` builder that writes them, and the one evaluator
 * that reads them.
 *
 * Everything that needs to ask "does this rule apply here" imports from here.
 * The config module, the grammar resolver and the runtime all did it their own
 * way before, with two incompatible answers between them.
 *
 * @example
 * ```ts
 * import { Impact, oneOf, when } from "@hiisi/viola/conditions";
 *
 * when.in("src/**").and(when.impact.atLeast(Impact.Major))
 * when.impact(oneOf(Impact.Major, Impact.Trivial))
 * when.env("CI").exists()
 * ```
 *
 * @module
 */

export {
  always,
  atLeast,
  atMost,
  between,
  type Comparison,
  type ComparisonData,
  contains,
  describe,
  endsWith,
  equals,
  glob,
  lessThan,
  matches,
  moreThan,
  never,
  noneOf,
  notEquals,
  oneOf,
  startsWith,
  type SubstringOp,
  type UnaryOp,
} from "./comparison.ts";

export { evaluateComparison } from "./evaluate-comparison.ts";

export type {
  CategoryName,
  ImpactName,
  ReportLevelName,
} from "./vocabulary.ts";

export {
  Category,
  compareImpact,
  Impact,
  IMPACT_ORDER,
  impactValue,
  ReportLevel,
} from "./vocabulary.ts";

export type {
  CategoryCondition,
  CompoundCondition,
  Condition,
  ConfidenceCondition,
  ConstantCondition,
  EnvCondition,
  EvaluationContext,
  FileCondition,
  FileContext,
  GrammarCondition,
  ImpactCondition,
  IssueContext,
  KindCondition,
  LinterCondition,
  NotCondition,
} from "./types.ts";

export { evaluateCondition } from "./evaluate.ts";

export {
  ConditionExpr,
  type EnvConditions,
  type Ordered,
  when,
  type WhenBuilder,
} from "./when.ts";

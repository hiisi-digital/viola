/**
 * Reading a condition against a context.
 *
 * One evaluator. There were two, and they disagreed: one walked a data union
 * and one called `evaluate` on an object, so neither could run the other's
 * conditions.
 *
 * Every arm is the same two steps: reach into the context for a value, and
 * hand it to `evaluateComparison`. Where the value is absent the condition is
 * false, never true, so a rule evaluated in a situation it did not anticipate
 * narrows rather than widens.
 *
 * @module
 */

import type { ComparisonData } from "./comparison.ts";
import { evaluateComparison } from "./evaluate-comparison.ts";
import type { Condition, EvaluationContext } from "./types.ts";

/**
 * Ask a comparison about a value that may not be there.
 *
 * The absent case is the whole reason this exists rather than being inlined
 * ten times: a missing value must not reach `evaluateComparison`, where
 * `undefined` would take part in comparisons and occasionally succeed.
 */
function ask<T>(
  comparison: ComparisonData<T>,
  value: T | undefined,
): boolean {
  if (value === undefined) return false;
  return evaluateComparison(comparison, value);
}

/**
 * Whether a condition holds.
 */
export function evaluateCondition(
  condition: Condition,
  context: EvaluationContext,
): boolean {
  switch (condition.type) {
    case "impact":
      return ask(condition.comparison, context.issue?.impact);
    case "category":
      return ask(condition.comparison, context.issue?.category);
    case "confidence":
      return ask(condition.comparison, context.issue?.confidence);
    case "linter":
      // Either the id alone or the full kind, because config writes both:
      // `when.linter("similar-functions")` and `when.linter("similar-*/*")`.
      return ask(condition.comparison, context.issue?.by) ||
        ask(condition.comparison, context.issue?.kind);
    case "kind":
      return ask(condition.comparison, context.issue?.name) ||
        ask(condition.comparison, context.issue?.kind);
    case "file":
      // `file` carries the path in both situations a condition is evaluated
      // in: deciding which grammars run, and classifying an issue. Whoever
      // builds a context for an issue fills it from the issue's location, so
      // `when.in("src/**")` means one thing rather than two.
      return ask(condition.comparison, context.file?.path);
    case "grammar":
      return ask(condition.comparison, context.file?.grammarId);
    case "env": {
      const value = context.env[condition.name];
      if (condition.comparison === undefined) return value !== undefined;
      return ask(condition.comparison, value);
    }
    case "always":
      return true;
    case "never":
      return false;
    case "compound":
      return condition.operator === "and"
        ? condition.conditions.every((c) => evaluateCondition(c, context))
        : condition.conditions.some((c) => evaluateCondition(c, context));
    case "not":
      return !evaluateCondition(condition.condition, context);
    default:
      // Exhaustive over the union, so this is unreachable by type. It is here
      // for what the types cannot see: a condition parsed from JSON, or one
      // written against a later viola than the one reading it. Unknown is
      // false, never undefined, because `undefined` is falsy and would look
      // like it worked right up until somebody negated it.
      return false;
  }
}

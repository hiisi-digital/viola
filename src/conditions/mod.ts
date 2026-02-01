/**
 * Conditions Module
 *
 * Provides the condition API for defining when rules should apply.
 * Includes comparison primitives and the `when` condition builder.
 *
 * @example
 * ```ts
 * import { when, atLeast, equals, oneOf, Impact, Category } from "@hiisi/viola/conditions";
 *
 * // Path matching
 * when.in("*.ts", "*.tsx")
 * when.in("**\/test/**")
 *
 * // Issue properties
 * when.issue.by(similarFunctions)
 * when.issue.impact(atLeast(Impact.Major))
 * when.issue.confidence(atLeast(80))
 * when.issue.category(equals(Category.Security))
 *
 * // Environment
 * when.env("CI").exists()
 * when.env("NODE_ENV").is(equals("production"))
 *
 * // Composition
 * when.in("src/**").and(when.issue.impact(atLeast(Impact.Major)))
 * when.env("FOO").is(atLeast(2).or(equals("production")))
 * ```
 *
 * @module
 */

// Comparison primitives
export {
    always as alwaysMatch, atLeast,
    atMost, between, contains, endsWith, equals, lessThan, matches, moreThan, never as neverMatch, noneOf, oneOf, startsWith
} from "./comparisons.ts";
export type { Comparison } from "./comparisons.ts";

// Condition types
export type {
    Condition, EnvConditionBuilder, EvaluationContext,
    FileContext, IssueConditions, IssueContext, WhenBuilder
} from "./types.ts";

// Enums
export { Category, Impact } from "./types.ts";

// The when builder
export { always, never, when } from "./when.ts";

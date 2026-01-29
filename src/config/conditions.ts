/**
 * Condition builders for viola configuration.
 *
 * Conditions define when a rule should apply. They can be combined
 * using explicit binary operators: and(), or(), not().
 *
 * @module
 */

import { deepFreeze, type Frozen } from "@hiisi/flash-freeze";
import { Category, Impact } from "./enums.ts";

// =============================================================================
// Condition Types
// =============================================================================

/**
 * Operators for combining conditions.
 */
export type ConditionOperator = "and" | "or" | "not";

/**
 * Base condition interface.
 */
export interface BaseCondition {
  readonly type: string;
}

/**
 * Impact comparison condition.
 */
export interface ImpactCondition extends BaseCondition {
  readonly type: "impact";
  readonly operator: "=" | "!=" | ">=" | "<=" | ">" | "<";
  readonly value: Impact;
}

/**
 * Category filter condition.
 */
export interface CategoryCondition extends BaseCondition {
  readonly type: "category";
  readonly include?: readonly Category[];
  readonly exclude?: readonly Category[];
}

/**
 * File pattern condition.
 */
export interface FileCondition extends BaseCondition {
  readonly type: "file";
  readonly patterns: readonly string[];
}

/**
 * Linter filter condition.
 */
export interface LinterCondition extends BaseCondition {
  readonly type: "linter";
  readonly patterns: readonly string[];
}

/**
 * Confidence filter condition.
 */
export interface ConfidenceCondition extends BaseCondition {
  readonly type: "confidence";
  readonly min?: number;
  readonly max?: number;
}

/**
 * Compound condition (AND, OR).
 */
export interface CompoundCondition extends BaseCondition {
  readonly type: "compound";
  readonly operator: "and" | "or";
  readonly conditions: readonly Condition[];
}

/**
 * Negation condition (NOT).
 */
export interface NotCondition extends BaseCondition {
  readonly type: "not";
  readonly condition: Condition;
}

/**
 * Union of all condition types.
 */
export type Condition =
  | ImpactCondition
  | CategoryCondition
  | FileCondition
  | LinterCondition
  | ConfidenceCondition
  | CompoundCondition
  | NotCondition;

// =============================================================================
// Condition Wrapper (for fluent chaining of operators)
// =============================================================================

/**
 * Wrapper around a condition that provides binary operator methods.
 */
export class ConditionExpr {
  constructor(readonly condition: Frozen<Condition>) {}

  /**
   * Combine with another condition using AND.
   */
  and(other: ConditionExpr | Frozen<Condition>): ConditionExpr {
    const otherCond = other instanceof ConditionExpr ? other.condition : other;
    return new ConditionExpr(deepFreeze({
      type: "compound" as const,
      operator: "and" as const,
      conditions: [this.condition, otherCond],
    }));
  }

  /**
   * Combine with another condition using OR.
   */
  or(other: ConditionExpr | Frozen<Condition>): ConditionExpr {
    const otherCond = other instanceof ConditionExpr ? other.condition : other;
    return new ConditionExpr(deepFreeze({
      type: "compound" as const,
      operator: "or" as const,
      conditions: [this.condition, otherCond],
    }));
  }

  /**
   * Negate this condition.
   */
  not(): ConditionExpr {
    return new ConditionExpr(deepFreeze({
      type: "not" as const,
      condition: this.condition,
    }));
  }
}

// =============================================================================
// Condition Factory Functions
// =============================================================================

/**
 * Create an impact condition.
 */
function impactCond(
  operator: ImpactCondition["operator"],
  value: Impact
): ConditionExpr {
  return new ConditionExpr(deepFreeze({
    type: "impact" as const,
    operator,
    value,
  }));
}

/**
 * Create a category condition.
 */
function categoryCond(
  include?: Category[],
  exclude?: Category[]
): ConditionExpr {
  return new ConditionExpr(deepFreeze({
    type: "category" as const,
    include,
    exclude,
  }));
}

/**
 * Create a file pattern condition.
 */
function fileCond(patterns: string[]): ConditionExpr {
  return new ConditionExpr(deepFreeze({
    type: "file" as const,
    patterns,
  }));
}

/**
 * Create a linter condition.
 */
function linterCond(patterns: string[]): ConditionExpr {
  return new ConditionExpr(deepFreeze({
    type: "linter" as const,
    patterns,
  }));
}

/**
 * Create a confidence condition.
 */
function confidenceCond(min?: number, max?: number): ConditionExpr {
  return new ConditionExpr(deepFreeze({
    type: "confidence" as const,
    min,
    max,
  }));
}

// =============================================================================
// Builder Objects
// =============================================================================

/**
 * Impact condition builder.
 */
const impactBuilder = deepFreeze({
  /** Impact >= value */
  atLeast: (value: Impact): ConditionExpr => impactCond(">=", value),
  /** Impact <= value */
  atMost: (value: Impact): ConditionExpr => impactCond("<=", value),
  /** Impact > value */
  above: (value: Impact): ConditionExpr => impactCond(">", value),
  /** Impact < value */
  below: (value: Impact): ConditionExpr => impactCond("<", value),
  /** Impact == value */
  is: (value: Impact): ConditionExpr => impactCond("=", value),
  /** Impact != value */
  not: (value: Impact): ConditionExpr => impactCond("!=", value),
});

/**
 * Category condition builder.
 */
const categoryBuilder = deepFreeze({
  /** Category == value */
  is: (value: Category): ConditionExpr => categoryCond([value], undefined),
  /** Category != value */
  not: (value: Category): ConditionExpr => categoryCond(undefined, [value]),
  /** Category in list */
  in: (...values: Category[]): ConditionExpr => categoryCond(values, undefined),
  /** Category not in list */
  notIn: (...values: Category[]): ConditionExpr => categoryCond(undefined, values),
});

/**
 * Confidence condition builder.
 */
const confidenceBuilder = deepFreeze({
  /** Confidence >= value */
  atLeast: (value: number): ConditionExpr => confidenceCond(value, undefined),
  /** Confidence < value */
  below: (value: number): ConditionExpr => confidenceCond(undefined, value),
  /** Confidence in range [min, max] */
  between: (min: number, max: number): ConditionExpr => confidenceCond(min, max),
});

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Condition builder entry point.
 *
 * @example
 * ```ts
 * import { when, Impact, Category } from "@hiisi/viola";
 *
 * // Simple conditions
 * when.impact.atLeast(Impact.Major)
 * when.category.is(Category.Correctness)
 * when.in("**\/*_test.ts")
 * when.linter("similar-functions")
 * when.confidence.atLeast(80)
 *
 * // Combining with AND
 * when.in("packages/core/**").and(when.impact.atLeast(Impact.Minor))
 *
 * // Combining with OR
 * when.in("**\/*_test.ts").or(when.in("**\/*.spec.ts"))
 *
 * // Negation
 * when.category.is(Category.Style).not()
 *
 * // Complex expressions
 * when.in("src/**")
 *   .and(when.impact.atLeast(Impact.Major).or(when.category.is(Category.Correctness)))
 * ```
 */
export const when = deepFreeze({
  /** Impact condition builder */
  impact: impactBuilder,

  /** Category condition builder */
  category: categoryBuilder,

  /** Confidence condition builder */
  confidence: confidenceBuilder,

  /** File pattern condition */
  in: (...patterns: string[]): ConditionExpr => fileCond(patterns),

  /** Linter filter condition */
  linter: (...patterns: string[]): ConditionExpr => linterCond(patterns),

  /**
   * Negate a condition.
   * @example when.not(when.category.is(Category.Style))
   */
  not: (condition: ConditionExpr): ConditionExpr => condition.not(),

  /**
   * Combine multiple conditions with AND.
   * @example when.all(when.in("src/**"), when.impact.atLeast(Impact.Major))
   */
  all: (...conditions: ConditionExpr[]): ConditionExpr => {
    if (conditions.length === 0) {
      throw new Error("when.all() requires at least one condition");
    }
    if (conditions.length === 1) {
      return conditions[0]!;
    }
    return new ConditionExpr(deepFreeze({
      type: "compound" as const,
      operator: "and" as const,
      conditions: conditions.map(c => c.condition),
    }));
  },

  /**
   * Combine multiple conditions with OR.
   * @example when.any(when.in("**\/*_test.ts"), when.in("**\/*.spec.ts"))
   */
  any: (...conditions: ConditionExpr[]): ConditionExpr => {
    if (conditions.length === 0) {
      throw new Error("when.any() requires at least one condition");
    }
    if (conditions.length === 1) {
      return conditions[0]!;
    }
    return new ConditionExpr(deepFreeze({
      type: "compound" as const,
      operator: "or" as const,
      conditions: conditions.map(c => c.condition),
    }));
  },
});

// =============================================================================
// Type Guards
// =============================================================================

export function isImpactCondition(c: Condition): c is ImpactCondition {
  return c.type === "impact";
}

export function isCategoryCondition(c: Condition): c is CategoryCondition {
  return c.type === "category";
}

export function isFileCondition(c: Condition): c is FileCondition {
  return c.type === "file";
}

export function isLinterCondition(c: Condition): c is LinterCondition {
  return c.type === "linter";
}

export function isConfidenceCondition(c: Condition): c is ConfidenceCondition {
  return c.type === "confidence";
}

export function isCompoundCondition(c: Condition): c is CompoundCondition {
  return c.type === "compound";
}

export function isNotCondition(c: Condition): c is NotCondition {
  return c.type === "not";
}

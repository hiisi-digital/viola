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
import type {
    CategoryCondition,
    Condition,
    ConfidenceCondition,
    FileCondition,
    ImpactCondition,
    LinterCondition,
} from "./types/conditions.types.ts";

// Re-export types for convenience
export type {
    BaseCondition,
    CategoryCondition,
    CompoundCondition,
    Condition,
    ConditionOperator,
    ConfidenceCondition,
    FileCondition,
    ImpactCondition,
    LinterCondition,
    NotCondition
} from "./types/conditions.types.ts";

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
/** Comparisons available on an issue's impact. */
export interface ImpactConditions {
  readonly atLeast: (value: Impact) => ConditionExpr;
  readonly atMost: (value: Impact) => ConditionExpr;
  readonly above: (value: Impact) => ConditionExpr;
  readonly below: (value: Impact) => ConditionExpr;
  readonly is: (value: Impact) => ConditionExpr;
  readonly not: (value: Impact) => ConditionExpr;
}

const impactBuilder: Frozen<ImpactConditions> = deepFreeze({
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
/** Membership tests against an issue's category. */
export interface CategoryConditions {
  readonly is: (value: Category) => ConditionExpr;
  readonly not: (value: Category) => ConditionExpr;
  readonly in: (...values: Category[]) => ConditionExpr;
  readonly notIn: (...values: Category[]) => ConditionExpr;
}

const categoryBuilder: Frozen<CategoryConditions> = deepFreeze({
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
/** Ranges over a linter's stated confidence. */
export interface ConfidenceConditions {
  readonly atLeast: (value: number) => ConditionExpr;
  readonly below: (value: number) => ConditionExpr;
  readonly between: (min: number, max: number) => ConditionExpr;
}

const confidenceBuilder: Frozen<ConfidenceConditions> = deepFreeze({
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
/** Everything a rule condition can be built from. */
export interface Conditions {
  readonly impact: Frozen<ImpactConditions>;
  readonly category: Frozen<CategoryConditions>;
  readonly confidence: Frozen<ConfidenceConditions>;
  readonly in: (...patterns: string[]) => ConditionExpr;
  readonly linter: (...patterns: string[]) => ConditionExpr;
}

export const when: Frozen<Conditions> = deepFreeze({
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

/**
 * Check if a condition is an impact condition.
 */
export function isImpactCondition(c: Condition): c is ImpactCondition {
  return c.type === "impact";
}

/**
 * Check if a condition is a category condition.
 */
export function isCategoryCondition(c: Condition): c is CategoryCondition {
  return c.type === "category";
}

/**
 * Check if a condition is a file pattern condition.
 */
export function isFileCondition(c: Condition): c is FileCondition {
  return c.type === "file";
}

/**
 * Check if a condition is a linter filter condition.
 */
export function isLinterCondition(c: Condition): c is LinterCondition {
  return c.type === "linter";
}

/**
 * Check if a condition is a confidence condition.
 */
export function isConfidenceCondition(c: Condition): c is ConfidenceCondition {
  return c.type === "confidence";
}

/**
 * Check if a condition is a compound (AND/OR) condition.
 */
export function isCompoundCondition(c: Condition): c is import("./types/conditions.types.ts").CompoundCondition {
  return c.type === "compound";
}

/**
 * Check if a condition is a NOT condition.
 */
export function isNotCondition(c: Condition): c is import("./types/conditions.types.ts").NotCondition {
  return c.type === "not";
}

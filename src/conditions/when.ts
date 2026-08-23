/**
 * `when`, the one condition builder.
 *
 * There were two, offering overlapping surfaces over incompatible types. This
 * is their union, and it is one mechanism rather than two: every accessor is
 * callable with a comparison, and the named shorthands on it are defined in
 * terms of that call. `when.impact.atLeast(x)` is `when.impact(atLeast(x))`,
 * spelled the way a config reads best.
 *
 * @example
 * ```ts
 * when.in("src/**")                          // a path
 * when.confidence.atLeast(80)                // a shorthand
 * when.impact(atLeast(Impact.Major))         // the same thing, spelled long
 * when.impact(oneOf(Impact.Major, Impact.Minor))   // what a shorthand cannot say
 * when.env("CI").exists()
 * when.all(when.in("src/**"), when.impact.atLeast(Impact.Major))
 * ```
 *
 * @module
 */

import { deepFreeze, type Frozen } from "@hiisi/flash-freeze";
import {
  atLeast,
  atMost,
  between,
  type Comparison,
  type ComparisonData,
  equals,
  glob,
  lessThan,
  moreThan,
  noneOf,
  notEquals,
  oneOf,
} from "./comparison.ts";
import type { Condition } from "./types.ts";
import type { Category, Impact } from "./vocabulary.ts";

// =============================================================================
// The expression a rule takes
// =============================================================================

/**
 * A condition with its combinators.
 *
 * The condition itself is the data; this is the fluent surface over it, and
 * `.condition` is how the builder and the evaluator get at what was built.
 */
export class ConditionExpr {
  constructor(readonly condition: Frozen<Condition>) {}

  /** Both this and the other. */
  and(other: ConditionExpr): ConditionExpr {
    return this.join("and", other);
  }

  /** Either this or the other. */
  or(other: ConditionExpr): ConditionExpr {
    return this.join("or", other);
  }

  /** The half of `and` and `or` that is not the operator. */
  private join(
    operator: "and" | "or",
    other: ConditionExpr,
  ): ConditionExpr {
    return expr({
      type: "compound",
      operator,
      conditions: [this.condition as Condition, other.condition as Condition],
    });
  }

  /** The opposite of this. */
  not(): ConditionExpr {
    return expr({ type: "not", condition: this.condition as Condition });
  }
}

function expr(condition: Condition): ConditionExpr {
  return new ConditionExpr(deepFreeze(condition) as Frozen<Condition>);
}

// =============================================================================
// The accessors
// =============================================================================

/**
 * An accessor that takes any comparison, plus the shorthands for the
 * comparisons a config reaches for most.
 *
 * The shorthands exist because `when.confidence.atLeast(80)` reads better in a
 * config file than `when.confidence(atLeast(80))`, and they are not a second
 * mechanism: each one calls the accessor.
 */
export interface Ordered<T> {
  (comparison: Comparison<T>): ConditionExpr;
  /** This value or more. */
  atLeast(value: T): ConditionExpr;
  /** This value or less. */
  atMost(value: T): ConditionExpr;
  /** Strictly more than. */
  above(value: T): ConditionExpr;
  /** Strictly less than. */
  below(value: T): ConditionExpr;
  /** Exactly. */
  is(value: T): ConditionExpr;
  /** Anything but. */
  not(value: T): ConditionExpr;
  /** Inclusive on both ends. */
  between(min: T, max: T): ConditionExpr;
  /** Any one of. */
  in(...values: T[]): ConditionExpr;
  /** None of. */
  notIn(...values: T[]): ConditionExpr;
}

function ordered<T>(
  make: (comparison: ComparisonData<T>) => Condition,
): Ordered<T> {
  const call = (c: Comparison<T>): ConditionExpr =>
    expr(make(c.data as ComparisonData<T>));
  return Object.assign(call, {
    atLeast: (v: T) => call(atLeast(v)),
    atMost: (v: T) => call(atMost(v)),
    above: (v: T) => call(moreThan(v)),
    below: (v: T) => call(lessThan(v)),
    is: (v: T) => call(equals(v)),
    not: (v: T) => call(notEquals(v)),
    between: (min: T, max: T) => call(between(min, max)),
    in: (...vs: T[]) => call(oneOf(...vs)),
    notIn: (...vs: T[]) => call(noneOf(...vs)),
  });
}

/**
 * Conditions about an environment variable.
 */
export interface EnvConditions {
  /** Whether it is set at all. */
  exists(): ConditionExpr;
  /** Whether its value satisfies a comparison. */
  is(comparison: Comparison<string>): ConditionExpr;
}

// =============================================================================
// when
// =============================================================================

/**
 * The condition builder.
 */
export interface WhenBuilder {
  /** Which file, by glob. */
  in(...patterns: string[]): ConditionExpr;
  /** Which linter reported it, by glob over its id or its full kind. */
  linter(...patterns: string[]): ConditionExpr;
  /** Which issue, by glob over its name or its full kind. */
  kind(...patterns: string[]): ConditionExpr;
  /** Which grammar parsed the file, by glob. */
  grammar(...patterns: string[]): ConditionExpr;
  /** How severe, per the reporting linter's catalog. */
  readonly impact: Ordered<Impact>;
  /** What kind of problem, per the catalog. */
  readonly category: Ordered<Category>;
  /** How sure the linter was, 0 to 100. */
  readonly confidence: Ordered<number>;
  /** An environment variable. */
  env(name: string): EnvConditions;
  /** All of them. */
  all(...conditions: ConditionExpr[]): ConditionExpr;
  /** Any of them. */
  any(...conditions: ConditionExpr[]): ConditionExpr;
  /** The opposite of one. */
  not(condition: ConditionExpr): ConditionExpr;
  /** Holds for everything. */
  always(): ConditionExpr;
  /** Holds for nothing. */
  never(): ConditionExpr;
}

function compound(
  operator: "and" | "or",
  conditions: ConditionExpr[],
): ConditionExpr {
  if (conditions.length === 0) {
    throw new Error(
      `when.${operator === "and" ? "all" : "any"}() requires at least one ` +
        `condition. An empty one has no honest answer: all of nothing is ` +
        `true and any of nothing is false, and a config that meant either ` +
        `should say so.`,
    );
  }
  if (conditions.length === 1) return conditions[0]!;
  return expr({
    type: "compound",
    operator,
    conditions: conditions.map((c) => c.condition as Condition),
  });
}

/**
 * Build a condition.
 */
export const when: WhenBuilder = {
  in: (...patterns) => expr({ type: "file", comparison: glob(...patterns).data as ComparisonData<string> }),
  linter: (...patterns) => expr({ type: "linter", comparison: glob(...patterns).data as ComparisonData<string> }),
  kind: (...patterns) => expr({ type: "kind", comparison: glob(...patterns).data as ComparisonData<string> }),
  grammar: (...patterns) => expr({ type: "grammar", comparison: glob(...patterns).data as ComparisonData<string> }),
  impact: ordered<Impact>((comparison) => ({ type: "impact", comparison })),
  category: ordered<Category>((comparison) => ({ type: "category", comparison })),
  confidence: ordered<number>((comparison) => ({ type: "confidence", comparison })),
  env: (name) => ({
    exists: () => expr({ type: "env", name }),
    is: (comparison) =>
      expr({
        type: "env",
        name,
        comparison: comparison.data as ComparisonData<string>,
      }),
  }),
  all: (...conditions) => compound("and", conditions),
  any: (...conditions) => compound("or", conditions),
  not: (condition) => condition.not(),
  always: () => expr({ type: "always" }),
  never: () => expr({ type: "never" }),
};

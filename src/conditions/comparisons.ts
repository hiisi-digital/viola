/**
 * Comparison Primitives
 *
 * Unified comparison functions that work with numbers, strings, and ordered enums.
 * These compose with .and() and .or() for complex conditions.
 *
 * @example
 * ```ts
 * // Numeric comparisons
 * when.issue.confidence(atLeast(80))
 * when.issue.confidence(between(50, 90))
 *
 * // Enum comparisons (enums have natural ordering)
 * when.issue.impact(atLeast(Impact.Major))
 * when.issue.impact(oneOf(Impact.Minor, Impact.Major))
 *
 * // String comparisons
 * when.env("NODE_ENV").is(equals("production"))
 * when.env("LOG_LEVEL").is(oneOf("debug", "trace"))
 *
 * // Composing comparators
 * when.env("FOO").is(atLeast(2).or(equals("production")))
 * when.issue.impact(atLeast(Impact.Minor).and(lessThan(Impact.Critical)))
 * ```
 *
 * @module
 */

/**
 * A comparison that can be evaluated against a value.
 * Comparisons compose with .and() and .or().
 */
export interface Comparison<T> {
  /**
   * Evaluate this comparison against a value.
   */
  evaluate(value: T): boolean;

  /**
   * Create a new comparison that requires both this AND the other to pass.
   *
   * @example
   * atLeast(50).and(atMost(90)) // same as between(50, 90)
   */
  and(other: Comparison<T>): Comparison<T>;

  /**
   * Create a new comparison that requires either this OR the other to pass.
   *
   * @example
   * atLeast(100).or(equals("unlimited"))
   */
  or(other: Comparison<T>): Comparison<T>;

  /**
   * Negate this comparison.
   *
   * @example
   * equals("disabled").not() // anything except "disabled"
   */
  not(): Comparison<T>;
}

/**
 * Base implementation of Comparison interface.
 */
class BaseComparison<T> implements Comparison<T> {
  constructor(
    private readonly predicate: (value: T) => boolean,
    private readonly description?: string
  ) {}

  evaluate(value: T): boolean {
    return this.predicate(value);
  }

  and(other: Comparison<T>): Comparison<T> {
    return new BaseComparison(
      (v) => this.evaluate(v) && other.evaluate(v),
      `(${this.description} AND ${(other as BaseComparison<T>).description})`
    );
  }

  or(other: Comparison<T>): Comparison<T> {
    return new BaseComparison(
      (v) => this.evaluate(v) || other.evaluate(v),
      `(${this.description} OR ${(other as BaseComparison<T>).description})`
    );
  }

  not(): Comparison<T> {
    return new BaseComparison(
      (v) => !this.evaluate(v),
      `NOT(${this.description})`
    );
  }

  toString(): string {
    return this.description ?? "Comparison";
  }
}

/**
 * Exact equality comparison.
 *
 * @example
 * when.env("NODE_ENV").is(equals("production"))
 * when.issue.kind(equals("duplicate"))
 */
export function equals<T>(expected: T): Comparison<T> {
  return new BaseComparison((v) => v === expected, `== ${expected}`);
}

/**
 * Greater than or equal comparison.
 * Works with numbers and ordered enums.
 *
 * @example
 * when.issue.confidence(atLeast(80))
 * when.issue.impact(atLeast(Impact.Major))
 */
export function atLeast<T>(minimum: T): Comparison<T> {
  return new BaseComparison((v) => v >= minimum, `>= ${minimum}`);
}

/**
 * Less than or equal comparison.
 * Works with numbers and ordered enums.
 *
 * @example
 * when.issue.confidence(atMost(50))
 * when.issue.impact(atMost(Impact.Minor))
 */
export function atMost<T>(maximum: T): Comparison<T> {
  return new BaseComparison((v) => v <= maximum, `<= ${maximum}`);
}

/**
 * Strictly less than comparison.
 * Works with numbers and ordered enums.
 *
 * @example
 * when.issue.impact(lessThan(Impact.Critical))
 */
export function lessThan<T>(bound: T): Comparison<T> {
  return new BaseComparison((v) => v < bound, `< ${bound}`);
}

/**
 * Strictly greater than comparison.
 * Works with numbers and ordered enums.
 *
 * @example
 * when.issue.confidence(moreThan(50))
 */
export function moreThan<T>(bound: T): Comparison<T> {
  return new BaseComparison((v) => v > bound, `> ${bound}`);
}

/**
 * Inclusive range comparison.
 * Equivalent to atLeast(min).and(atMost(max)).
 *
 * @example
 * when.issue.confidence(between(50, 90))
 */
export function between<T>(min: T, max: T): Comparison<T> {
  return new BaseComparison(
    (v) => v >= min && v <= max,
    `between ${min} and ${max}`
  );
}

/**
 * Match any of the given values.
 *
 * @example
 * when.env("LOG_LEVEL").is(oneOf("debug", "trace", "info"))
 * when.issue.impact(oneOf(Impact.Minor, Impact.Major))
 */
export function oneOf<T>(...values: T[]): Comparison<T> {
  return new BaseComparison(
    (v) => values.includes(v),
    `one of [${values.join(", ")}]`
  );
}

/**
 * Match none of the given values.
 *
 * @example
 * when.env("NODE_ENV").is(noneOf("test", "development"))
 */
export function noneOf<T>(...values: T[]): Comparison<T> {
  return new BaseComparison(
    (v) => !values.includes(v),
    `none of [${values.join(", ")}]`
  );
}

/**
 * String contains comparison (case-sensitive).
 *
 * @example
 * when.env("PATH").is(contains("/usr/local/bin"))
 */
export function contains(substring: string): Comparison<string> {
  return new BaseComparison(
    (v) => v.includes(substring),
    `contains "${substring}"`
  );
}

/**
 * String starts with comparison.
 *
 * @example
 * when.env("HOME").is(startsWith("/home"))
 */
export function startsWith(prefix: string): Comparison<string> {
  return new BaseComparison(
    (v) => v.startsWith(prefix),
    `starts with "${prefix}"`
  );
}

/**
 * String ends with comparison.
 *
 * @example
 * when.env("SHELL").is(endsWith("zsh"))
 */
export function endsWith(suffix: string): Comparison<string> {
  return new BaseComparison((v) => v.endsWith(suffix), `ends with "${suffix}"`);
}

/**
 * Regex match comparison.
 *
 * @example
 * when.env("VERSION").is(matches(/^\d+\.\d+\.\d+$/))
 */
export function matches(pattern: RegExp): Comparison<string> {
  return new BaseComparison((v) => pattern.test(v), `matches ${pattern}`);
}

/**
 * Always true comparison. Useful as a default or for testing.
 *
 * @example
 * when.issue.confidence(always())
 */
export function always<T>(): Comparison<T> {
  return new BaseComparison(() => true, "always");
}

/**
 * Always false comparison. Useful for disabling or testing.
 *
 * @example
 * when.issue.confidence(never())
 */
export function never<T>(): Comparison<T> {
  return new BaseComparison(() => false, "never");
}

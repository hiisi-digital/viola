/**
 * Comparisons, as data.
 *
 * A comparison used to be a closure with an `evaluate` method. That composes
 * nicely and cannot be frozen, inspected, printed in an explanation, or
 * serialised, and viola freezes its whole config. So a comparison is a small
 * tagged record and the combinators build records rather than capture
 * variables. `evaluate` reads one.
 *
 * The builder surface is unchanged from the closure version, so
 * `atLeast(50).and(atMost(90))` still reads the same and still means the same.
 *
 * @example
 * ```ts
 * atLeast(80)                       // confidence at or above 80
 * oneOf(Impact.Major, Impact.Minor) // either one
 * atLeast(2).or(equals("many"))     // composed
 * ```
 *
 * @module
 */

import { deepFreeze, type Frozen } from "@hiisi/flash-freeze";

// =============================================================================
// The data
// =============================================================================

/** Comparisons that hold one value to compare against. */
export type UnaryOp = "=" | "!=" | ">=" | "<=" | ">" | "<";

/** Comparisons over strings that ask about a substring. */
export type SubstringOp = "contains" | "startsWith" | "endsWith";

/**
 * A comparison, as the record that describes it.
 *
 * Ordering comparisons work on numbers, on strings lexically, and on `Impact`,
 * which is ordered by `IMPACT_ORDER` rather than by its string value. The
 * evaluator is what knows that; a record never has to.
 */
export type ComparisonData<T> =
  | { readonly op: UnaryOp; readonly value: T }
  | { readonly op: "between"; readonly min: T; readonly max: T }
  | { readonly op: "oneOf"; readonly values: readonly T[] }
  | { readonly op: "noneOf"; readonly values: readonly T[] }
  | { readonly op: SubstringOp; readonly value: string }
  /** `source` rather than a `RegExp`, so the record stays data. */
  | { readonly op: "matches"; readonly source: string; readonly flags: string }
  /** A glob, which is what config writes for a path or a linter id. */
  | { readonly op: "glob"; readonly patterns: readonly string[] }
  | { readonly op: "always" }
  | { readonly op: "never" }
  | {
    readonly op: "and" | "or";
    readonly parts: readonly ComparisonData<T>[];
  }
  | { readonly op: "not"; readonly part: ComparisonData<T> };

// =============================================================================
// The builder
// =============================================================================

/**
 * A comparison with its combinators attached.
 *
 * `data` is the record. Everything else builds a new one; nothing mutates.
 */
export interface Comparison<T> {
  readonly data: Frozen<ComparisonData<T>>;
  and(other: Comparison<T>): Comparison<T>;
  or(other: Comparison<T>): Comparison<T>;
  not(): Comparison<T>;
  toString(): string;
}

function build<T>(data: ComparisonData<T>): Comparison<T> {
  const frozen = deepFreeze(data) as Frozen<ComparisonData<T>>;
  return {
    data: frozen,
    and: (other) => build<T>({ op: "and", parts: [data, other.data as ComparisonData<T>] }),
    or: (other) => build<T>({ op: "or", parts: [data, other.data as ComparisonData<T>] }),
    not: () => build<T>({ op: "not", part: data }),
    toString: () => describe(data),
  };
}

/** A comparison's own account of itself, for explaining why a rule fired. */
export function describe<T>(data: ComparisonData<T>): string {
  switch (data.op) {
    case "between":
      return `between ${String(data.min)} and ${String(data.max)}`;
    case "oneOf":
      return `one of ${data.values.map(String).join(", ")}`;
    case "noneOf":
      return `none of ${data.values.map(String).join(", ")}`;
    case "matches":
      return `matches /${data.source}/${data.flags}`;
    case "glob":
      return `matches ${data.patterns.join(" or ")}`;
    case "always":
      return "always";
    case "never":
      return "never";
    case "and":
    case "or":
      return `(${data.parts.map(describe).join(` ${data.op.toUpperCase()} `)})`;
    case "not":
      return `NOT(${describe(data.part)})`;
    default:
      return `${data.op} ${String(data.value)}`;
  }
}

// =============================================================================
// Constructors
// =============================================================================

/** Exactly this value. */
export function equals<T>(value: T): Comparison<T> {
  return build({ op: "=", value });
}

/** Anything but this value. */
export function notEquals<T>(value: T): Comparison<T> {
  return build({ op: "!=", value });
}

/** This value or more severe or larger, depending on what is being compared. */
export function atLeast<T>(value: T): Comparison<T> {
  return build({ op: ">=", value });
}

/** This value or less. */
export function atMost<T>(value: T): Comparison<T> {
  return build({ op: "<=", value });
}

/** Strictly more than. */
export function moreThan<T>(value: T): Comparison<T> {
  return build({ op: ">", value });
}

/** Strictly less than. */
export function lessThan<T>(value: T): Comparison<T> {
  return build({ op: "<", value });
}

/** Inclusive on both ends. */
export function between<T>(min: T, max: T): Comparison<T> {
  return build({ op: "between", min, max });
}

/** Any one of these. */
export function oneOf<T>(...values: T[]): Comparison<T> {
  return build({ op: "oneOf", values });
}

/** None of these. */
export function noneOf<T>(...values: T[]): Comparison<T> {
  return build({ op: "noneOf", values });
}

/** Substring, for strings. */
export function contains(value: string): Comparison<string> {
  return build({ op: "contains", value });
}

/** Prefix, for strings. */
export function startsWith(value: string): Comparison<string> {
  return build({ op: "startsWith", value });
}

/** Suffix, for strings. */
export function endsWith(value: string): Comparison<string> {
  return build({ op: "endsWith", value });
}

/**
 * Regular expression, for strings.
 *
 * The pattern is kept as source and flags rather than as a `RegExp`, since a
 * `RegExp` carries mutable `lastIndex` and would not survive freezing.
 */
export function matches(pattern: RegExp | string): Comparison<string> {
  const re = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  return build({ op: "matches", source: re.source, flags: re.flags });
}

/**
 * Matches any of the given globs.
 *
 * This is what `when.in("src/**")` and `when.linter("test-*")` are made of, so
 * a path filter and a confidence threshold are the same kind of thing and
 * compose the same way.
 */
export function glob(...patterns: string[]): Comparison<string> {
  return build({ op: "glob", patterns });
}

/** Passes whatever it is given. */
export function always<T>(): Comparison<T> {
  return build({ op: "always" });
}

/** Passes nothing. */
export function never<T>(): Comparison<T> {
  return build({ op: "never" });
}

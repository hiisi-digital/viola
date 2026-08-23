//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Reading a comparison record against a value.
 *
 * Ordering is the one thing this has to know that the record does not: numbers
 * and strings order themselves, and `Impact` orders by `IMPACT_ORDER` rather
 * than alphabetically, so `atLeast(Impact.Major)` has to mean "at least this
 * severe" and not "at or after 'major' in the alphabet".
 *
 * @module
 */

import type { ComparisonData } from "./comparison.ts";
import { matchesAnyGlob } from "../utils/glob.ts";
import { Impact, impactValue } from "./vocabulary.ts";

/**
 * Put a value on a line so two of them can be compared.
 *
 * Returns `null` when the value has no ordering, which is how a comparison
 * over an unordered value fails rather than guesses.
 */
function rank(value: unknown): number | string | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    // An impact is a string, and its order is not its spelling. Ranked here so
    // every ordering comparison agrees with `compareImpact`, which is the bug
    // that made `atLeast(Impact.Major)` also accept `Impact.Minor`, "minor"
    // sorting after "major".
    if ((Object.values(Impact) as string[]).includes(value)) {
      // Negated because `IMPACT_ORDER` runs most severe first, and "at least"
      // has to mean more severe rather than further down the array.
      return -impactValue(value as Impact);
    }
    return value;
  }
  return null;
}

function compareRanked(
  a: unknown,
  b: unknown,
  hold: (x: number | string, y: number | string) => boolean,
): boolean {
  const left = rank(a);
  const right = rank(b);
  if (left === null || right === null) return false;
  if (typeof left !== typeof right) return false;
  return hold(left, right);
}

/**
 * Whether a value satisfies a comparison.
 */
export function evaluateComparison<T>(
  comparison: ComparisonData<T>,
  value: T,
): boolean {
  switch (comparison.op) {
    case "=":
      return value === comparison.value;
    case "!=":
      return value !== comparison.value;
    case ">=":
      return compareRanked(value, comparison.value, (a, b) => a >= b);
    case "<=":
      return compareRanked(value, comparison.value, (a, b) => a <= b);
    case ">":
      return compareRanked(value, comparison.value, (a, b) => a > b);
    case "<":
      return compareRanked(value, comparison.value, (a, b) => a < b);
    case "between":
      return compareRanked(value, comparison.min, (a, b) => a >= b) &&
        compareRanked(value, comparison.max, (a, b) => a <= b);
    case "oneOf":
      return comparison.values.includes(value);
    case "noneOf":
      return !comparison.values.includes(value);
    case "contains":
      return typeof value === "string" && value.includes(comparison.value);
    case "startsWith":
      return typeof value === "string" && value.startsWith(comparison.value);
    case "endsWith":
      return typeof value === "string" && value.endsWith(comparison.value);
    case "matches":
      return typeof value === "string" &&
        new RegExp(comparison.source, comparison.flags).test(value);
    case "glob":
      return typeof value === "string" &&
        matchesAnyGlob(value, comparison.patterns);
    case "always":
      return true;
    case "never":
      return false;
    case "and":
      return comparison.parts.every((p) => evaluateComparison(p, value));
    case "or":
      return comparison.parts.some((p) => evaluateComparison(p, value));
    case "not":
      return !evaluateComparison(comparison.part, value);
  }
}

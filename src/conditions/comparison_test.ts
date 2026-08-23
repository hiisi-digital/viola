/**
 * What a comparison means, and the one case that is not obvious.
 *
 * `Impact` is a string enum whose order is not its spelling. "minor" sorts
 * after "major" alphabetically and is less severe, so a comparison that
 * compared the strings would read `atLeast(Impact.Major)` as also accepting
 * `Impact.Minor`. Several laws below exist only to pin that.
 */

import { assertEquals } from "@std/assert";
import {
  always,
  atLeast,
  atMost,
  between,
  contains,
  endsWith,
  equals,
  lessThan,
  matches,
  moreThan,
  never,
  noneOf,
  notEquals,
  oneOf,
  startsWith,
} from "./comparison.ts";
import { evaluateComparison } from "./evaluate-comparison.ts";
import { Category, Impact } from "./vocabulary.ts";

function accepts<T>(c: { data: unknown }, value: T): boolean {
  // deno-lint-ignore no-explicit-any
  return evaluateComparison(c.data as any, value);
}

Deno.test("comparison - impact orders by severity, not by spelling", () => {
  // The whole reason `rank` exists. Alphabetically "minor" > "major", so a
  // string comparison would pass here and the rule would fire on everything.
  assertEquals(accepts(atLeast(Impact.Major), Impact.Minor), false);
  assertEquals(accepts(atLeast(Impact.Major), Impact.Critical), true);
  assertEquals(accepts(atLeast(Impact.Major), Impact.Major), true);
  assertEquals(accepts(atMost(Impact.Minor), Impact.Trivial), true);
  assertEquals(accepts(atMost(Impact.Minor), Impact.Critical), false);
});

Deno.test("comparison - the impact inserted by the merge sits where it says", () => {
  // `Moderate` came from the other enum and its position is a claim.
  assertEquals(accepts(atLeast(Impact.Moderate), Impact.Major), true);
  assertEquals(accepts(atLeast(Impact.Moderate), Impact.Minor), false);
  assertEquals(accepts(lessThan(Impact.Moderate), Impact.Minor), true);
});

Deno.test("comparison - numbers order as numbers", () => {
  assertEquals(accepts(atLeast(80), 80), true);
  assertEquals(accepts(atLeast(80), 79), false);
  assertEquals(accepts(moreThan(80), 80), false);
  assertEquals(accepts(between(50, 90), 50), true);
  assertEquals(accepts(between(50, 90), 91), false);
});

Deno.test("comparison - equality does not need an ordering", () => {
  assertEquals(accepts(equals(Category.Security), Category.Security), true);
  assertEquals(accepts(equals(Category.Security), Category.Style), false);
  assertEquals(accepts(notEquals(Category.Style), Category.Security), true);
});

Deno.test("comparison - membership", () => {
  const c = oneOf(Category.Correctness, Category.Security);
  assertEquals(accepts(c, Category.Security), true);
  assertEquals(accepts(c, Category.Style), false);
  assertEquals(accepts(noneOf(Category.Style), Category.Security), true);
});

Deno.test("comparison - strings", () => {
  assertEquals(accepts(contains("lint"), "viola-lints"), true);
  assertEquals(accepts(startsWith("viola"), "viola-lints"), true);
  assertEquals(accepts(endsWith("lints"), "viola-lints"), true);
  assertEquals(accepts(matches(/^viola-/), "viola-lints"), true);
  assertEquals(accepts(matches(/^viola-/), "lints-viola"), false);
});

Deno.test("comparison - a comparison over an unordered value fails rather than guesses", () => {
  // An ordering comparison against something with no ordering has no honest
  // answer, and returning true would silently widen every rule using it.
  assertEquals(accepts(atLeast({ a: 1 }), { a: 2 }), false);
  assertEquals(accepts(atLeast(5), "five"), false);
});

Deno.test("comparison - combinators compose without capturing anything", () => {
  assertEquals(accepts(atLeast(50).and(atMost(90)), 70), true);
  assertEquals(accepts(atLeast(50).and(atMost(90)), 95), false);
  assertEquals(accepts(atLeast(100).or(equals(0)), 0), true);
  assertEquals(accepts(equals("off").not(), "on"), true);
  assertEquals(accepts(always(), "anything"), true);
  assertEquals(accepts(never(), "anything"), false);
});

Deno.test("comparison - a comparison is data, so it survives a round trip", () => {
  // The reason this is a record rather than a closure. A closure cannot be
  // frozen, printed in an explanation, or written to a cache.
  const original = atLeast(50).and(atMost(90));
  const revived = JSON.parse(JSON.stringify(original.data));
  assertEquals(evaluateComparison(revived, 70), true);
  assertEquals(evaluateComparison(revived, 95), false);
});

Deno.test("comparison - a comparison says what it is", () => {
  assertEquals(atLeast(80).toString(), ">= 80");
  assertEquals(between(1, 2).toString(), "between 1 and 2");
  assertEquals(equals("x").not().toString(), "NOT(= x)");
});

/**
 * Tests for Comparison Primitives
 *
 * @module
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
  oneOf,
  startsWith,
} from "./comparisons.ts";

// =============================================================================
// equals()
// =============================================================================

Deno.test("equals - matches exact value", () => {
  const cmp = equals(42);
  assertEquals(cmp.evaluate(42), true);
  assertEquals(cmp.evaluate(41), false);
  assertEquals(cmp.evaluate(43), false);
});

Deno.test("equals - works with strings", () => {
  const cmp = equals("production");
  assertEquals(cmp.evaluate("production"), true);
  assertEquals(cmp.evaluate("development"), false);
  assertEquals(cmp.evaluate("PRODUCTION"), false);
});

Deno.test("equals - works with enums (as numbers)", () => {
  enum Impact {
    Minor = 1,
    Major = 2,
    Critical = 3,
  }
  const cmp = equals(Impact.Major);
  assertEquals(cmp.evaluate(Impact.Major), true);
  assertEquals(cmp.evaluate(Impact.Minor), false);
  assertEquals(cmp.evaluate(2), true); // Enums are numbers
});

// =============================================================================
// atLeast()
// =============================================================================

Deno.test("atLeast - includes minimum value", () => {
  const cmp = atLeast(50);
  assertEquals(cmp.evaluate(50), true);
  assertEquals(cmp.evaluate(51), true);
  assertEquals(cmp.evaluate(100), true);
  assertEquals(cmp.evaluate(49), false);
});

Deno.test("atLeast - works with enums", () => {
  enum Impact {
    Minor = 1,
    Major = 2,
    Critical = 3,
  }
  const cmp = atLeast(Impact.Major);
  assertEquals(cmp.evaluate(Impact.Major), true);
  assertEquals(cmp.evaluate(Impact.Critical), true);
  assertEquals(cmp.evaluate(Impact.Minor), false);
});

// =============================================================================
// atMost()
// =============================================================================

Deno.test("atMost - includes maximum value", () => {
  const cmp = atMost(50);
  assertEquals(cmp.evaluate(50), true);
  assertEquals(cmp.evaluate(49), true);
  assertEquals(cmp.evaluate(0), true);
  assertEquals(cmp.evaluate(51), false);
});

// =============================================================================
// lessThan()
// =============================================================================

Deno.test("lessThan - excludes boundary value", () => {
  const cmp = lessThan(50);
  assertEquals(cmp.evaluate(49), true);
  assertEquals(cmp.evaluate(50), false);
  assertEquals(cmp.evaluate(51), false);
});

// =============================================================================
// moreThan()
// =============================================================================

Deno.test("moreThan - excludes boundary value", () => {
  const cmp = moreThan(50);
  assertEquals(cmp.evaluate(51), true);
  assertEquals(cmp.evaluate(50), false);
  assertEquals(cmp.evaluate(49), false);
});

// =============================================================================
// between()
// =============================================================================

Deno.test("between - inclusive range", () => {
  const cmp = between(10, 20);
  assertEquals(cmp.evaluate(10), true);
  assertEquals(cmp.evaluate(15), true);
  assertEquals(cmp.evaluate(20), true);
  assertEquals(cmp.evaluate(9), false);
  assertEquals(cmp.evaluate(21), false);
});

// =============================================================================
// oneOf()
// =============================================================================

Deno.test("oneOf - matches any listed value", () => {
  const cmp = oneOf("debug", "trace", "info");
  assertEquals(cmp.evaluate("debug"), true);
  assertEquals(cmp.evaluate("trace"), true);
  assertEquals(cmp.evaluate("info"), true);
  assertEquals(cmp.evaluate("warn"), false);
  assertEquals(cmp.evaluate("error"), false);
});

Deno.test("oneOf - works with numbers", () => {
  const cmp = oneOf(1, 2, 3);
  assertEquals(cmp.evaluate(1), true);
  assertEquals(cmp.evaluate(2), true);
  assertEquals(cmp.evaluate(4), false);
});

// =============================================================================
// noneOf()
// =============================================================================

Deno.test("noneOf - excludes listed values", () => {
  const cmp = noneOf("test", "development");
  assertEquals(cmp.evaluate("production"), true);
  assertEquals(cmp.evaluate("staging"), true);
  assertEquals(cmp.evaluate("test"), false);
  assertEquals(cmp.evaluate("development"), false);
});

// =============================================================================
// contains()
// =============================================================================

Deno.test("contains - substring matching", () => {
  const cmp = contains("/usr/local");
  assertEquals(cmp.evaluate("/usr/local/bin"), true);
  assertEquals(cmp.evaluate("/home/usr/local"), true);
  assertEquals(cmp.evaluate("/usr/bin"), false);
});

// =============================================================================
// startsWith()
// =============================================================================

Deno.test("startsWith - prefix matching", () => {
  const cmp = startsWith("/home");
  assertEquals(cmp.evaluate("/home/user"), true);
  assertEquals(cmp.evaluate("/home"), true);
  assertEquals(cmp.evaluate("/usr/home"), false);
});

// =============================================================================
// endsWith()
// =============================================================================

Deno.test("endsWith - suffix matching", () => {
  const cmp = endsWith(".ts");
  assertEquals(cmp.evaluate("file.ts"), true);
  assertEquals(cmp.evaluate("path/to/file.ts"), true);
  assertEquals(cmp.evaluate("file.tsx"), false);
  assertEquals(cmp.evaluate("file.ts.bak"), false);
});

// =============================================================================
// matches()
// =============================================================================

Deno.test("matches - regex matching", () => {
  const cmp = matches(/^\d+\.\d+\.\d+$/);
  assertEquals(cmp.evaluate("1.2.3"), true);
  assertEquals(cmp.evaluate("10.20.30"), true);
  assertEquals(cmp.evaluate("v1.2.3"), false);
  assertEquals(cmp.evaluate("1.2"), false);
});

// =============================================================================
// always() / never()
// =============================================================================

Deno.test("always - always returns true", () => {
  const cmp = always<number>();
  assertEquals(cmp.evaluate(0), true);
  assertEquals(cmp.evaluate(100), true);
  assertEquals(cmp.evaluate(-1), true);
});

Deno.test("never - always returns false", () => {
  const cmp = never<number>();
  assertEquals(cmp.evaluate(0), false);
  assertEquals(cmp.evaluate(100), false);
});

// =============================================================================
// Composition: .and()
// =============================================================================

Deno.test("and - combines comparisons with AND logic", () => {
  const cmp = atLeast(50).and(atMost(90));
  assertEquals(cmp.evaluate(50), true);
  assertEquals(cmp.evaluate(70), true);
  assertEquals(cmp.evaluate(90), true);
  assertEquals(cmp.evaluate(49), false);
  assertEquals(cmp.evaluate(91), false);
});

Deno.test("and - chains multiple comparisons", () => {
  const cmp = atLeast(10).and(atMost(100)).and(moreThan(5));
  assertEquals(cmp.evaluate(10), true);
  assertEquals(cmp.evaluate(50), true);
  assertEquals(cmp.evaluate(5), false);
  assertEquals(cmp.evaluate(101), false);
});

// =============================================================================
// Composition: .or()
// =============================================================================

Deno.test("or - combines comparisons with OR logic", () => {
  const cmp = lessThan(10).or(moreThan(90));
  assertEquals(cmp.evaluate(5), true);
  assertEquals(cmp.evaluate(95), true);
  assertEquals(cmp.evaluate(50), false);
});

Deno.test("or - works with mixed types (conceptually)", () => {
  // This represents: value >= 100 OR value == "unlimited"
  const cmp = atLeast(100).or(equals(100 as number));
  assertEquals(cmp.evaluate(100), true);
  assertEquals(cmp.evaluate(150), true);
  assertEquals(cmp.evaluate(50), false);
});

// =============================================================================
// Composition: .not()
// =============================================================================

Deno.test("not - negates comparison", () => {
  const cmp = equals("disabled").not();
  assertEquals(cmp.evaluate("enabled"), true);
  assertEquals(cmp.evaluate("anything"), true);
  assertEquals(cmp.evaluate("disabled"), false);
});

Deno.test("not - works with complex comparisons", () => {
  const cmp = between(10, 20).not();
  assertEquals(cmp.evaluate(5), true);
  assertEquals(cmp.evaluate(25), true);
  assertEquals(cmp.evaluate(15), false);
});

// =============================================================================
// Complex compositions
// =============================================================================

Deno.test("complex composition - (A and B) or C", () => {
  // (>= 80 AND <= 90) OR == 100
  const cmp = atLeast(80).and(atMost(90)).or(equals(100));
  assertEquals(cmp.evaluate(85), true);
  assertEquals(cmp.evaluate(100), true);
  assertEquals(cmp.evaluate(75), false);
  assertEquals(cmp.evaluate(95), false);
});

Deno.test("complex composition - A or (B and C)", () => {
  // < 10 OR (>= 90 AND <= 100)
  const cmp = lessThan(10).or(atLeast(90).and(atMost(100)));
  assertEquals(cmp.evaluate(5), true);
  assertEquals(cmp.evaluate(95), true);
  assertEquals(cmp.evaluate(50), false);
  assertEquals(cmp.evaluate(105), false);
});

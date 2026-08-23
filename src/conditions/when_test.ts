//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * What `when` builds and what it means.
 *
 * Two things here are the point of the merge and are pinned hardest: that a
 * shorthand and its long form produce the same condition, so there is one
 * mechanism rather than two, and that a condition asking about something the
 * context does not carry is false rather than true.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { atLeast, equals, oneOf } from "./comparison.ts";
import { evaluateCondition } from "./evaluate.ts";
import type { Condition, EvaluationContext } from "./types.ts";
import { Category, Impact } from "./vocabulary.ts";
import { type ConditionExpr, when } from "./when.ts";

function ctx(over: Partial<EvaluationContext> = {}): EvaluationContext {
  return { env: {}, projectRoot: "/p", ...over };
}

function issueContext(over: Record<string, unknown> = {}) {
  return {
    by: "similar-functions",
    kind: "similar-functions/duplicate-function",
    name: "duplicate-function",
    impact: Impact.Major,
    category: Category.Maintainability,
    confidence: 80,
    line: 1,
    ...over,
  } as EvaluationContext["issue"];
}

function holds(e: ConditionExpr, c: EvaluationContext): boolean {
  return evaluateCondition(e.condition as Condition, c);
}

Deno.test("when - a shorthand is its long form, not a second mechanism", () => {
  // If these ever diverge there are two implementations again, which is the
  // whole defect this merge exists to remove.
  assertEquals(
    when.impact.atLeast(Impact.Major).condition,
    when.impact(atLeast(Impact.Major)).condition,
  );
  assertEquals(
    when.category.is(Category.Security).condition,
    when.category(equals(Category.Security)).condition,
  );
  assertEquals(
    when.confidence.atLeast(80).condition,
    when.confidence(atLeast(80)).condition,
  );
});

Deno.test("when - the accessor says what a shorthand cannot", () => {
  const c = when.impact(oneOf(Impact.Major, Impact.Trivial));
  assertEquals(
    holds(c, ctx({ issue: issueContext({ impact: Impact.Major }) })),
    true,
  );
  assertEquals(
    holds(c, ctx({ issue: issueContext({ impact: Impact.Trivial }) })),
    true,
  );
  assertEquals(
    holds(c, ctx({ issue: issueContext({ impact: Impact.Minor }) })),
    false,
  );
});

Deno.test("when - a condition about something absent is false", () => {
  // Evaluated while deciding which grammars run there is no issue yet. A
  // rule must narrow there, never widen, or it fires on everything.
  const noIssue = ctx({
    file: { path: "src/a.ts", extension: ".ts", grammarId: "typescript" },
  });
  assertEquals(holds(when.impact.atLeast(Impact.Trivial), noIssue), false);
  assertEquals(holds(when.confidence.atLeast(0), noIssue), false);
  assertEquals(holds(when.category.is(Category.Style), noIssue), false);
  assertEquals(holds(when.linter("*"), noIssue), false);
});

Deno.test("when - a catalog with no entry leaves impact absent, and that is false", () => {
  const unknown = ctx({
    issue: issueContext({ impact: undefined, category: undefined }),
  });
  assertEquals(holds(when.impact.atLeast(Impact.Trivial), unknown), false);
  assertEquals(holds(when.category.is(Category.Style), unknown), false);
  // Confidence comes from the issue rather than the catalog, so it survives.
  assertEquals(holds(when.confidence.atLeast(80), unknown), true);
});

Deno.test("when - in() matches the file being examined", () => {
  const c = when.in("src/**");
  const inside = ctx({
    file: { path: "src/deep/a.ts", extension: ".ts", grammarId: "" },
  });
  const outside = ctx({
    file: { path: "tests/a.ts", extension: ".ts", grammarId: "" },
  });
  assertEquals(holds(c, inside), true);
  assertEquals(holds(c, outside), false);
  assertEquals(holds(c, ctx()), false);
});

Deno.test("when - linter() matches the id or the full kind", () => {
  const i = ctx({ issue: issueContext() });
  assertEquals(holds(when.linter("similar-functions"), i), true);
  assertEquals(holds(when.linter("similar-*"), i), true);
  assertEquals(holds(when.linter("similar-functions/*"), i), true);
  assertEquals(holds(when.linter("missing-docs"), i), false);
});

Deno.test("when - kind() matches the name or the full kind", () => {
  const i = ctx({ issue: issueContext() });
  assertEquals(holds(when.kind("duplicate-function"), i), true);
  assertEquals(
    holds(when.kind("similar-functions/duplicate-function"), i),
    true,
  );
  assertEquals(holds(when.kind("duplicate-*"), i), true);
  assertEquals(holds(when.kind("missing-*"), i), false);
});

Deno.test("when - grammar() reads the file, not the issue", () => {
  const f = ctx({
    file: { path: "a.ts", extension: ".ts", grammarId: "typescript" },
  });
  assertEquals(holds(when.grammar("typescript"), f), true);
  assertEquals(holds(when.grammar("bash"), f), false);
  assertEquals(holds(when.grammar("*"), ctx()), false);
});

Deno.test("when - env exists is not env is", () => {
  const set = ctx({ env: { CI: "" } });
  assertEquals(holds(when.env("CI").exists(), set), true);
  assertEquals(holds(when.env("CI").exists(), ctx()), false);
  // Set but empty: it exists, and it is not "true".
  assertEquals(holds(when.env("CI").is(equals("true")), set), false);
  assertEquals(
    holds(when.env("CI").is(equals("true")), ctx({ env: { CI: "true" } })),
    true,
  );
});

Deno.test("when - composition", () => {
  const i = ctx({
    issue: issueContext(),
    file: { path: "src/a.ts", extension: ".ts", grammarId: "typescript" },
  });
  assertEquals(
    holds(when.all(when.in("src/**"), when.impact.atLeast(Impact.Major)), i),
    true,
  );
  assertEquals(
    holds(when.all(when.in("tests/**"), when.impact.atLeast(Impact.Major)), i),
    false,
  );
  assertEquals(
    holds(when.any(when.in("tests/**"), when.impact.atLeast(Impact.Major)), i),
    true,
  );
  assertEquals(holds(when.not(when.in("tests/**")), i), true);
  assertEquals(
    holds(when.in("src/**").and(when.confidence.atLeast(80)), i),
    true,
  );
  assertEquals(
    holds(when.in("tests/**").or(when.confidence.atLeast(80)), i),
    true,
  );
});

Deno.test("when - all of one is that one, not a wrapper", () => {
  const one = when.in("src/**");
  assertEquals(when.all(one), one);
  assertEquals(when.any(one), one);
});

Deno.test("when - all of nothing is refused rather than guessed", () => {
  assertThrows(() => when.all(), Error, "at least one");
  assertThrows(() => when.any(), Error, "at least one");
});

Deno.test("when - always and never say so in the data", () => {
  assertEquals((when.always().condition as Condition).type, "always");
  assertEquals((when.never().condition as Condition).type, "never");
  assertEquals(holds(when.always(), ctx()), true);
  assertEquals(holds(when.never(), ctx()), false);
});

Deno.test("when - a built condition is data and survives a round trip", () => {
  const built = when.all(when.in("src/**"), when.impact.atLeast(Impact.Major));
  const revived = JSON.parse(JSON.stringify(built.condition)) as Condition;
  const i = ctx({
    issue: issueContext(),
    file: { path: "src/a.ts", extension: ".ts", grammarId: "" },
  });
  assertEquals(evaluateCondition(revived, i), true);
});

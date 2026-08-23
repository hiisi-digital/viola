//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Tests for condition builders and evaluation.
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import type { Issue } from "../../data/types.ts";
import { ConditionExpr, when } from "../../conditions/when.ts";
import { Category, Impact } from "../../conditions/vocabulary.ts";
import { evaluateCondition } from "../../conditions/evaluate.ts";
import { createEvaluationContext } from "../evaluator.ts";
import type { IssueCatalog } from "../types.ts";

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestCatalogs(): Map<string, IssueCatalog> {
  const catalogs = new Map<string, IssueCatalog>();

  catalogs.set("test-linter", {
    "test-linter/critical-correctness": {
      category: "correctness",
      impact: "critical",
      description: "Critical correctness issue",
    },
    "test-linter/major-maintainability": {
      category: "maintainability",
      impact: "major",
      description: "Major maintainability issue",
    },
    "test-linter/minor-consistency": {
      category: "consistency",
      impact: "minor",
      description: "Minor consistency issue",
    },
    "test-linter/trivial-style": {
      category: "style",
      impact: "trivial",
      description: "Trivial style issue",
    },
    "test-linter/major-performance": {
      category: "performance",
      impact: "major",
      description: "Major performance issue",
    },
  });

  return catalogs;
}

function createIssue(
  kind: string,
  file: string,
  confidence = 80,
): Issue {
  return {
    kind,
    location: { file, line: 1, column: 1 },
    message: `Test: ${kind}`,
    confidence,
  };
}

function evalCondition(
  condition: ConditionExpr,
  kind: string,
  file: string,
  confidence = 80,
): boolean {
  const catalogs = createTestCatalogs();
  const issue = createIssue(kind, file, confidence);
  const context = createEvaluationContext(issue, catalogs);
  return evaluateCondition(condition.condition, context);
}

// =============================================================================
// Impact Condition Tests
// =============================================================================

Deno.test("when.impact.is() matches exact impact", () => {
  const cond = when.impact.is(Impact.Major);

  assertEquals(
    evalCondition(cond, "test-linter/major-maintainability", "a.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/critical-correctness", "a.ts"),
    false,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts"),
    false,
  );
});

Deno.test("when.impact.not() excludes exact impact", () => {
  const cond = when.impact.not(Impact.Minor);

  assertEquals(
    evalCondition(cond, "test-linter/major-maintainability", "a.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts"),
    false,
  );
});

Deno.test("when.impact.atLeast() matches >= impact", () => {
  const cond = when.impact.atLeast(Impact.Major);

  // Critical >= Major (more severe)
  assertEquals(
    evalCondition(cond, "test-linter/critical-correctness", "a.ts"),
    true,
  );
  // Major >= Major
  assertEquals(
    evalCondition(cond, "test-linter/major-maintainability", "a.ts"),
    true,
  );
  // Minor < Major (less severe)
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts"),
    false,
  );
  // Trivial < Major
  assertEquals(
    evalCondition(cond, "test-linter/trivial-style", "a.ts"),
    false,
  );
});

Deno.test("when.impact.atMost() matches <= impact", () => {
  const cond = when.impact.atMost(Impact.Minor);

  assertEquals(
    evalCondition(cond, "test-linter/trivial-style", "a.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/major-maintainability", "a.ts"),
    false,
  );
});

Deno.test("when.impact.above() matches > impact", () => {
  const cond = when.impact.above(Impact.Major);

  assertEquals(
    evalCondition(cond, "test-linter/critical-correctness", "a.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/major-maintainability", "a.ts"),
    false,
  );
});

Deno.test("when.impact.below() matches < impact", () => {
  const cond = when.impact.below(Impact.Minor);

  assertEquals(
    evalCondition(cond, "test-linter/trivial-style", "a.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts"),
    false,
  );
});

// =============================================================================
// Category Condition Tests
// =============================================================================

Deno.test("when.category.is() matches exact category", () => {
  const cond = when.category.is(Category.Correctness);

  assertEquals(
    evalCondition(cond, "test-linter/critical-correctness", "a.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts"),
    false,
  );
});

Deno.test("when.category.not() excludes category", () => {
  const cond = when.category.not(Category.Style);

  assertEquals(
    evalCondition(cond, "test-linter/critical-correctness", "a.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/trivial-style", "a.ts"),
    false,
  );
});

Deno.test("when.category.in() matches any in list", () => {
  const cond = when.category.in(
    Category.Correctness,
    Category.Performance,
  );

  assertEquals(
    evalCondition(cond, "test-linter/critical-correctness", "a.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/major-performance", "a.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/trivial-style", "a.ts"),
    false,
  );
});

Deno.test("when.category.notIn() excludes categories", () => {
  const cond = when.category.notIn(Category.Style, Category.Consistency);

  assertEquals(
    evalCondition(cond, "test-linter/critical-correctness", "a.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/trivial-style", "a.ts"),
    false,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts"),
    false,
  );
});

// =============================================================================
// File Condition Tests
// =============================================================================

Deno.test("when.in() matches exact file", () => {
  const cond = when.in("src/main.ts");

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/main.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/other.ts"),
    false,
  );
});

Deno.test("when.in() matches glob with *", () => {
  const cond = when.in("src/*.ts");

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/main.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/nested/main.ts"),
    false,
  );
});

Deno.test("when.in() matches glob with **", () => {
  const cond = when.in("src/**");

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/main.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/nested/main.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "lib/main.ts"),
    false,
  );
});

Deno.test("when.in() matches test file patterns", () => {
  const cond = when.in("**/*_test.ts");

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/utils_test.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/utils.ts"),
    false,
  );
});

Deno.test("when.in() with multiple patterns", () => {
  const cond = when.in("**/*_test.ts", "**/*.spec.ts");

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/utils_test.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/utils.spec.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/utils.ts"),
    false,
  );
});

Deno.test("when.in() with directory pattern", () => {
  const cond = when.in("packages/core/**");

  assertEquals(
    evalCondition(
      cond,
      "test-linter/minor-consistency",
      "packages/core/lib.ts",
    ),
    true,
  );
  assertEquals(
    evalCondition(
      cond,
      "test-linter/minor-consistency",
      "packages/utils/lib.ts",
    ),
    false,
  );
});

// =============================================================================
// Linter Condition Tests
// =============================================================================

Deno.test("when.linter() matches exact linter", () => {
  const cond = when.linter("test-linter");

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts"),
    true,
  );
});

Deno.test("when.linter() with glob pattern", () => {
  const cond = when.linter("test-*");

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts"),
    true,
  );
});

Deno.test("when.linter() with multiple patterns", () => {
  const cond = when.linter("foo-linter", "test-*");

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "foo-linter/some-issue", "a.ts"),
    true,
  );
});

// =============================================================================
// Confidence Condition Tests
// =============================================================================

Deno.test("when.confidence.atLeast() matches >= value", () => {
  const cond = when.confidence.atLeast(70);

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts", 80),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts", 70),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts", 50),
    false,
  );
});

Deno.test("when.confidence.below() matches < value", () => {
  const cond = when.confidence.below(60);

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts", 50),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts", 59),
    true,
  );
  // The boundary. `below` used to accept it, which is what `atMost` means,
  // and the test that pinned it carried a comment arguing with its own name.
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts", 60),
    false,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts", 61),
    false,
  );
});

Deno.test("when.confidence.between() matches range", () => {
  const cond = when.confidence.between(40, 80);

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts", 60),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts", 40),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts", 80),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts", 30),
    false,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts", 90),
    false,
  );
});

// =============================================================================
// Compound Condition Tests
// =============================================================================

Deno.test("and() combines two conditions", () => {
  const cond = when.in("packages/core/**").and(
    when.impact.atLeast(Impact.Major),
  );

  // Both match
  assertEquals(
    evalCondition(
      cond,
      "test-linter/major-maintainability",
      "packages/core/lib.ts",
    ),
    true,
  );

  // File matches, impact doesn't
  assertEquals(
    evalCondition(
      cond,
      "test-linter/minor-consistency",
      "packages/core/lib.ts",
    ),
    false,
  );

  // Impact matches, file doesn't
  assertEquals(
    evalCondition(
      cond,
      "test-linter/major-maintainability",
      "packages/utils/lib.ts",
    ),
    false,
  );
});

Deno.test("or() combines two conditions", () => {
  const cond = when.in("**/*_test.ts").or(when.in("**/*.spec.ts"));

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/utils_test.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/utils.spec.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/utils.ts"),
    false,
  );
});

Deno.test("not() negates a condition", () => {
  const cond = when.in("**/*_test.ts").not();

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/utils.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/utils_test.ts"),
    false,
  );
});

Deno.test("when.not() negates a condition", () => {
  const cond = when.not(when.category.is(Category.Style));

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "a.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/trivial-style", "a.ts"),
    false,
  );
});

Deno.test("when.all() requires all conditions", () => {
  const cond = when.all(
    when.in("src/**"),
    when.impact.atLeast(Impact.Minor),
    when.category.not(Category.Style),
  );

  // All match
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/lib.ts"),
    true,
  );

  // File doesn't match
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "lib/lib.ts"),
    false,
  );

  // Category excluded
  assertEquals(
    evalCondition(cond, "test-linter/trivial-style", "src/lib.ts"),
    false,
  );
});

Deno.test("when.any() requires at least one condition", () => {
  const cond = when.any(
    when.in("**/*_test.ts"),
    when.in("**/*.spec.ts"),
    when.in("tests/**"),
  );

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/utils_test.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/utils.spec.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "tests/foo.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/utils.ts"),
    false,
  );
});

Deno.test("Complex nested conditions", () => {
  // (in src/** AND major+) OR (in tests/** AND correctness)
  const cond = when
    .all(when.in("src/**"), when.impact.atLeast(Impact.Major))
    .or(when.all(when.in("tests/**"), when.category.is(Category.Correctness)));

  // src + major
  assertEquals(
    evalCondition(cond, "test-linter/major-maintainability", "src/lib.ts"),
    true,
  );

  // tests + correctness
  assertEquals(
    evalCondition(cond, "test-linter/critical-correctness", "tests/foo.ts"),
    true,
  );

  // src but minor (doesn't match first, not in tests)
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/lib.ts"),
    false,
  );

  // tests but not correctness
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "tests/foo.ts"),
    false,
  );
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("Condition without catalog entry returns false for impact/category", () => {
  const catalogs = new Map<string, IssueCatalog>(); // empty
  const issue = createIssue("unknown/issue", "a.ts");
  const context = createEvaluationContext(issue, catalogs);

  // Impact condition can't match without catalog
  assertEquals(
    evaluateCondition(when.impact.atLeast(Impact.Major).condition, context),
    false,
  );

  // Category condition can't match without catalog
  assertEquals(
    evaluateCondition(
      when.category.is(Category.Correctness).condition,
      context,
    ),
    false,
  );

  // File condition CAN match without catalog (use pattern that matches a.ts)
  assertEquals(
    evaluateCondition(when.in("*.ts").condition, context),
    true,
  );
});

Deno.test("when.all() with single condition returns that condition", () => {
  const single = when.in("src/**");
  const wrapped = when.all(single);

  // Should be the same condition
  assertEquals(
    evalCondition(wrapped, "test-linter/minor-consistency", "src/lib.ts"),
    true,
  );
});

Deno.test("when.any() with single condition returns that condition", () => {
  const single = when.in("src/**");
  const wrapped = when.any(single);

  assertEquals(
    evalCondition(wrapped, "test-linter/minor-consistency", "src/lib.ts"),
    true,
  );
});

Deno.test("Double negation", () => {
  const cond = when.in("src/**").not().not();

  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "src/lib.ts"),
    true,
  );
  assertEquals(
    evalCondition(cond, "test-linter/minor-consistency", "lib/lib.ts"),
    false,
  );
});

Deno.test("Empty file pattern", () => {
  // This is an edge case - empty pattern should probably not match anything
  // but let's verify the behavior
  const catalogs = createTestCatalogs();
  const issue = createIssue("test-linter/minor-consistency", "src/lib.ts");
  const context = createEvaluationContext(issue, catalogs);

  const cond = when.in();
  // Empty patterns = no match
  assertEquals(evaluateCondition(cond.condition, context), false);
});

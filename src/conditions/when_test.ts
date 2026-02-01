/**
 * Tests for When Condition API
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import { atLeast, equals, oneOf } from "./comparisons.ts";
import type { EvaluationContext } from "./types.ts";
import { Category, Impact } from "./types.ts";
import { always, never, when } from "./when.ts";

// =============================================================================
// Test Helpers
// =============================================================================

function makeContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    projectRoot: "/project",
    env: {},
    ...overrides,
  };
}

function makeFileContext(path: string, extension = ".ts", grammarId = "typescript") {
  return makeContext({
    file: { path, extension, grammarId },
  });
}

function makeIssueContext(
  by: string,
  impact: Impact,
  confidence: number,
  category = Category.Maintainability,
  kind = "issue"
) {
  return makeContext({
    issue: {
      by,
      kind,
      impact,
      confidence,
      category,
      line: 1,
    },
  });
}

// =============================================================================
// when.in() - Path Pattern Matching
// =============================================================================

Deno.test("when.in - matches exact extension", () => {
  const cond = when.in("*.ts");
  assertEquals(cond.evaluate(makeFileContext("file.ts")), true);
  assertEquals(cond.evaluate(makeFileContext("file.tsx")), false);
  assertEquals(cond.evaluate(makeFileContext("file.js")), false);
});

Deno.test("when.in - matches multiple patterns (OR)", () => {
  const cond = when.in("*.ts", "*.tsx");
  assertEquals(cond.evaluate(makeFileContext("file.ts")), true);
  assertEquals(cond.evaluate(makeFileContext("file.tsx")), true);
  assertEquals(cond.evaluate(makeFileContext("file.js")), false);
});

Deno.test("when.in - matches directory patterns", () => {
  const cond = when.in("**/test/**");
  assertEquals(cond.evaluate(makeFileContext("src/test/file.ts")), true);
  assertEquals(cond.evaluate(makeFileContext("test/file.ts")), true);
  assertEquals(cond.evaluate(makeFileContext("src/file.ts")), false);
});

Deno.test("when.in - matches combined patterns", () => {
  const cond = when.in("**/test/**/*.spec.ts");
  assertEquals(cond.evaluate(makeFileContext("src/test/foo.spec.ts")), true);
  assertEquals(cond.evaluate(makeFileContext("test/bar.spec.ts")), true);
  assertEquals(cond.evaluate(makeFileContext("src/test/foo.ts")), false);
  assertEquals(cond.evaluate(makeFileContext("src/foo.spec.ts")), false);
});

Deno.test("when.in - returns false without file context", () => {
  const cond = when.in("*.ts");
  assertEquals(cond.evaluate(makeContext()), false);
});

// =============================================================================
// when.issue.by() - Issue Source Matching
// =============================================================================

Deno.test("when.issue.by - matches by string ID", () => {
  const cond = when.issue.by("similar-functions");
  assertEquals(
    cond.evaluate(makeIssueContext("similar-functions", Impact.Major, 80)),
    true
  );
  assertEquals(
    cond.evaluate(makeIssueContext("duplicate-strings", Impact.Major, 80)),
    false
  );
});

Deno.test("when.issue.by - matches by object with id", () => {
  const linter = { id: "similar-functions" };
  const cond = when.issue.by(linter);
  assertEquals(
    cond.evaluate(makeIssueContext("similar-functions", Impact.Major, 80)),
    true
  );
});

Deno.test("when.issue.by - matches by object with meta.id", () => {
  const linter = { meta: { id: "similar-functions" } };
  const cond = when.issue.by(linter);
  assertEquals(
    cond.evaluate(makeIssueContext("similar-functions", Impact.Major, 80)),
    true
  );
});

Deno.test("when.issue.by - returns false without issue context", () => {
  const cond = when.issue.by("similar-functions");
  assertEquals(cond.evaluate(makeContext()), false);
});

// =============================================================================
// when.issue.kind() - Issue Kind Matching
// =============================================================================

Deno.test("when.issue.kind - matches issue kind", () => {
  const cond = when.issue.kind("duplicate");
  const ctx = makeContext({
    issue: {
      by: "test",
      kind: "duplicate",
      impact: Impact.Minor,
      confidence: 80,
      category: Category.Maintainability,
      line: 1,
    },
  });
  assertEquals(cond.evaluate(ctx), true);
});

Deno.test("when.issue.kind - no match for different kind", () => {
  const cond = when.issue.kind("duplicate");
  const ctx = makeContext({
    issue: {
      by: "test",
      kind: "missing-docs",
      impact: Impact.Minor,
      confidence: 80,
      category: Category.Maintainability,
      line: 1,
    },
  });
  assertEquals(cond.evaluate(ctx), false);
});

// =============================================================================
// when.issue.impact() - Impact Level Matching
// =============================================================================

Deno.test("when.issue.impact - matches with atLeast", () => {
  const cond = when.issue.impact(atLeast(Impact.Major));
  assertEquals(
    cond.evaluate(makeIssueContext("test", Impact.Major, 80)),
    true
  );
  assertEquals(
    cond.evaluate(makeIssueContext("test", Impact.Critical, 80)),
    true
  );
  assertEquals(
    cond.evaluate(makeIssueContext("test", Impact.Minor, 80)),
    false
  );
});

Deno.test("when.issue.impact - matches with equals", () => {
  const cond = when.issue.impact(equals(Impact.Major));
  assertEquals(
    cond.evaluate(makeIssueContext("test", Impact.Major, 80)),
    true
  );
  assertEquals(
    cond.evaluate(makeIssueContext("test", Impact.Critical, 80)),
    false
  );
});

Deno.test("when.issue.impact - matches with oneOf", () => {
  const cond = when.issue.impact(oneOf(Impact.Minor, Impact.Major));
  assertEquals(
    cond.evaluate(makeIssueContext("test", Impact.Minor, 80)),
    true
  );
  assertEquals(
    cond.evaluate(makeIssueContext("test", Impact.Major, 80)),
    true
  );
  assertEquals(
    cond.evaluate(makeIssueContext("test", Impact.Critical, 80)),
    false
  );
});

// =============================================================================
// when.issue.confidence() - Confidence Level Matching
// =============================================================================

Deno.test("when.issue.confidence - matches with atLeast", () => {
  const cond = when.issue.confidence(atLeast(80));
  assertEquals(
    cond.evaluate(makeIssueContext("test", Impact.Major, 80)),
    true
  );
  assertEquals(
    cond.evaluate(makeIssueContext("test", Impact.Major, 90)),
    true
  );
  assertEquals(
    cond.evaluate(makeIssueContext("test", Impact.Major, 79)),
    false
  );
});

// =============================================================================
// when.issue.category() - Category Matching
// =============================================================================

Deno.test("when.issue.category - matches category", () => {
  const cond = when.issue.category(equals(Category.Security));
  assertEquals(
    cond.evaluate(makeIssueContext("test", Impact.Major, 80, Category.Security)),
    true
  );
  assertEquals(
    cond.evaluate(makeIssueContext("test", Impact.Major, 80, Category.Maintainability)),
    false
  );
});

// =============================================================================
// when.env() - Environment Variable Matching
// =============================================================================

Deno.test("when.env().exists() - checks existence", () => {
  const cond = when.env("CI").exists();
  assertEquals(cond.evaluate(makeContext({ env: { CI: "true" } })), true);
  assertEquals(cond.evaluate(makeContext({ env: { CI: "1" } })), true);
  assertEquals(cond.evaluate(makeContext({ env: {} })), false);
  assertEquals(cond.evaluate(makeContext({ env: { CI: "" } })), false);
});

Deno.test("when.env().is() - string comparison", () => {
  const cond = when.env("NODE_ENV").is(equals("production"));
  assertEquals(
    cond.evaluate(makeContext({ env: { NODE_ENV: "production" } })),
    true
  );
  assertEquals(
    cond.evaluate(makeContext({ env: { NODE_ENV: "development" } })),
    false
  );
  assertEquals(cond.evaluate(makeContext({ env: {} })), false);
});

Deno.test("when.env().is() - numeric comparison", () => {
  const cond = when.env("TIMEOUT").is(atLeast(30));
  assertEquals(
    cond.evaluate(makeContext({ env: { TIMEOUT: "30" } })),
    true
  );
  assertEquals(
    cond.evaluate(makeContext({ env: { TIMEOUT: "60" } })),
    true
  );
  assertEquals(
    cond.evaluate(makeContext({ env: { TIMEOUT: "10" } })),
    false
  );
});

Deno.test("when.env().is() - oneOf comparison", () => {
  const cond = when.env("LOG_LEVEL").is(oneOf("debug", "trace"));
  assertEquals(
    cond.evaluate(makeContext({ env: { LOG_LEVEL: "debug" } })),
    true
  );
  assertEquals(
    cond.evaluate(makeContext({ env: { LOG_LEVEL: "trace" } })),
    true
  );
  assertEquals(
    cond.evaluate(makeContext({ env: { LOG_LEVEL: "info" } })),
    false
  );
});

// =============================================================================
// Condition Composition: .and()
// =============================================================================

Deno.test("condition.and - combines conditions with AND", () => {
  const cond = when.in("src/**").and(when.issue.impact(atLeast(Impact.Major)));

  // Both match
  const ctx1 = makeContext({
    file: { path: "src/file.ts", extension: ".ts", grammarId: "ts" },
    issue: {
      by: "test",
      kind: "issue",
      impact: Impact.Major,
      confidence: 80,
      category: Category.Maintainability,
      line: 1,
    },
  });
  assertEquals(cond.evaluate(ctx1), true);

  // Only path matches
  const ctx2 = makeContext({
    file: { path: "src/file.ts", extension: ".ts", grammarId: "ts" },
    issue: {
      by: "test",
      kind: "issue",
      impact: Impact.Minor,
      confidence: 80,
      category: Category.Maintainability,
      line: 1,
    },
  });
  assertEquals(cond.evaluate(ctx2), false);

  // Only impact matches
  const ctx3 = makeContext({
    file: { path: "test/file.ts", extension: ".ts", grammarId: "ts" },
    issue: {
      by: "test",
      kind: "issue",
      impact: Impact.Major,
      confidence: 80,
      category: Category.Maintainability,
      line: 1,
    },
  });
  assertEquals(cond.evaluate(ctx3), false);
});

Deno.test("condition.and - chains multiple conditions", () => {
  const cond = when
    .issue.by("similar-functions")
    .and(when.issue.impact(atLeast(Impact.Major)))
    .and(when.issue.confidence(atLeast(90)));

  const highConfidence = makeContext({
    issue: {
      by: "similar-functions",
      kind: "similar",
      impact: Impact.Major,
      confidence: 95,
      category: Category.Maintainability,
      line: 1,
    },
  });
  assertEquals(cond.evaluate(highConfidence), true);

  const lowConfidence = makeContext({
    issue: {
      by: "similar-functions",
      kind: "similar",
      impact: Impact.Major,
      confidence: 80,
      category: Category.Maintainability,
      line: 1,
    },
  });
  assertEquals(cond.evaluate(lowConfidence), false);
});

// =============================================================================
// Condition Composition: .or()
// =============================================================================

Deno.test("condition.or - combines conditions with OR", () => {
  const cond = when.in("**/test/**").or(when.in("**/spec/**"));

  assertEquals(cond.evaluate(makeFileContext("src/test/file.ts")), true);
  assertEquals(cond.evaluate(makeFileContext("src/spec/file.ts")), true);
  assertEquals(cond.evaluate(makeFileContext("src/main/file.ts")), false);
});

// =============================================================================
// Condition Composition: .not()
// =============================================================================

Deno.test("condition.not - negates condition", () => {
  const cond = when.in("**/test/**").not();

  assertEquals(cond.evaluate(makeFileContext("src/main/file.ts")), true);
  assertEquals(cond.evaluate(makeFileContext("src/test/file.ts")), false);
});

// =============================================================================
// always() / never()
// =============================================================================

Deno.test("always - always returns true", () => {
  const cond = always();
  assertEquals(cond.evaluate(makeContext()), true);
  assertEquals(cond.evaluate(makeFileContext("any.ts")), true);
});

Deno.test("never - always returns false", () => {
  const cond = never();
  assertEquals(cond.evaluate(makeContext()), false);
  assertEquals(cond.evaluate(makeFileContext("any.ts")), false);
});

// =============================================================================
// Complex Real-World Scenarios
// =============================================================================

Deno.test("scenario: CI-specific strict mode", () => {
  // In CI, treat minor issues as errors
  const cond = when.env("CI").exists().and(when.issue.impact(atLeast(Impact.Minor)));

  const ciMinorIssue = makeContext({
    env: { CI: "true" },
    issue: {
      by: "test",
      kind: "issue",
      impact: Impact.Minor,
      confidence: 80,
      category: Category.Maintainability,
      line: 1,
    },
  });
  assertEquals(cond.evaluate(ciMinorIssue), true);

  const localMinorIssue = makeContext({
    env: {},
    issue: {
      by: "test",
      kind: "issue",
      impact: Impact.Minor,
      confidence: 80,
      category: Category.Maintainability,
      line: 1,
    },
  });
  assertEquals(cond.evaluate(localMinorIssue), false);
});

Deno.test("scenario: disable linter for test files", () => {
  const cond = when.issue.by("similar-functions").and(when.in("**/test/**"));

  const testFile = makeContext({
    file: { path: "src/test/helpers.ts", extension: ".ts", grammarId: "ts" },
    issue: {
      by: "similar-functions",
      kind: "similar",
      impact: Impact.Minor,
      confidence: 80,
      category: Category.Maintainability,
      line: 1,
    },
  });
  assertEquals(cond.evaluate(testFile), true);

  const srcFile = makeContext({
    file: { path: "src/utils/helpers.ts", extension: ".ts", grammarId: "ts" },
    issue: {
      by: "similar-functions",
      kind: "similar",
      impact: Impact.Minor,
      confidence: 80,
      category: Category.Maintainability,
      line: 1,
    },
  });
  assertEquals(cond.evaluate(srcFile), false);
});

Deno.test("scenario: high-confidence security issues", () => {
  const cond = when.issue
    .category(equals(Category.Security))
    .and(when.issue.confidence(atLeast(90)));

  const highConfSecurity = makeContext({
    issue: {
      by: "security-check",
      kind: "vulnerability",
      impact: Impact.Critical,
      confidence: 95,
      category: Category.Security,
      line: 1,
    },
  });
  assertEquals(cond.evaluate(highConfSecurity), true);

  const lowConfSecurity = makeContext({
    issue: {
      by: "security-check",
      kind: "vulnerability",
      impact: Impact.Critical,
      confidence: 70,
      category: Category.Security,
      line: 1,
    },
  });
  assertEquals(cond.evaluate(lowConfSecurity), false);
});

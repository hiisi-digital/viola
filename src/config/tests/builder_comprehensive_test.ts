/**
 * Comprehensive tests for the ViolaBuilder configuration system.
 *
 * Covers edge cases, error handling, complex compositions, immutability,
 * ordering guarantees, and advanced "last wins" evaluation scenarios.
 *
 * @module
 */

import { assertEquals, assertThrows } from "@std/assert";
import type { CodebaseData, Issue } from "../../data/types.ts";
import type { BaseLinter } from "../../linters/base.ts";
import { isReportAction, report } from "../actions.ts";
import { viola, type ViolaPlugin } from "../builder.ts";
import { when } from "../conditions.ts";
import { Category, Impact, ReportLevel } from "../enums.ts";
import {
  createEvaluationContext,
  evaluateCondition,
  evaluateIssue,
} from "../evaluator.ts";
import { grammar } from "../grammar-ref.ts";
import type { GrammarDefinition } from "../../grammars/types.ts";
import type { IssueCatalog } from "../types.ts";

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockLinter(id: string, issues: string[] = []): BaseLinter {
  const catalog: IssueCatalog = {};
  for (const issue of issues) {
    catalog[`${id}/${issue}`] = {
      category: "consistency",
      impact: "minor",
      description: `Test issue: ${issue}`,
    };
  }

  return {
    meta: {
      id,
      name: `Mock ${id}`,
      description: `Mock linter ${id}`,
    },
    catalog,
    requirements: {},
    lint: (_data: CodebaseData) => [],
    issue: () => ({} as Issue),
  } as unknown as BaseLinter;
}

function createMockIssue(
  kind: string,
  file: string,
  confidence = 80,
): Issue {
  return {
    kind,
    location: { file, line: 1, column: 1 },
    message: `Test issue: ${kind}`,
    confidence,
  };
}

function createTestCatalog(): Map<string, IssueCatalog> {
  const catalogs = new Map<string, IssueCatalog>();

  catalogs.set("test-linter", {
    "test-linter/critical-issue": {
      category: "correctness",
      impact: "critical",
      description: "A critical issue",
    },
    "test-linter/major-issue": {
      category: "maintainability",
      impact: "major",
      description: "A major issue",
    },
    "test-linter/minor-issue": {
      category: "consistency",
      impact: "minor",
      description: "A minor issue",
    },
    "test-linter/trivial-issue": {
      category: "style",
      impact: "trivial",
      description: "A trivial issue",
    },
  });

  catalogs.set("other-linter", {
    "other-linter/perf-issue": {
      category: "performance",
      impact: "major",
      description: "A performance issue",
    },
  });

  return catalogs;
}

const mockTsGrammar: GrammarDefinition = {
  meta: {
    id: "typescript",
    name: "TypeScript",
    extensions: [".ts", ".tsx"],
  },
  grammar: {
    source: "npm",
    package: "tree-sitter-typescript",
    wasm: "tree-sitter-typescript.wasm",
  },
  queries: {
    functions: `(function_declaration name: (identifier) @function.name)`,
  },
};

const mockJsGrammar: GrammarDefinition = {
  meta: {
    id: "javascript",
    name: "JavaScript",
    extensions: [".js", ".jsx"],
  },
  grammar: {
    source: "npm",
    package: "tree-sitter-javascript",
    wasm: "tree-sitter-javascript.wasm",
  },
  queries: {
    functions: `(function_declaration name: (identifier) @function.name)`,
  },
};

function getActionLevel(action: { type: string }): ReportLevel | undefined {
  if (isReportAction(action)) {
    return action.level;
  }
  return undefined;
}

// =============================================================================
// 1. .as() Method Edge Cases
// =============================================================================

Deno.test("as: throws when called without preceding add()", () => {
  const builder = viola();
  assertThrows(
    () => builder.as("alias"),
    Error,
    "No item to alias",
  );
});

Deno.test("as: second as() throws after tracking cleared", () => {
  const builder = viola()
    .add(createMockLinter("test-linter"))
    .as("my-alias");

  // Tracking cleared after first .as(), second should throw
  assertThrows(
    () => builder.as("another-alias"),
    Error,
    "No item to alias",
  );
});

Deno.test("as: on array of linters aliases the last item", () => {
  const linters = [
    createMockLinter("linter-a"),
    createMockLinter("linter-b"),
    createMockLinter("linter-c"),
  ];
  // .as() after array should use last linter id ("linter-c")
  const config = viola().add(linters).as("last-alias").build();

  // All three linters should be present
  assertEquals(config.linters.length, 3);
  // The alias should not throw (it succeeded)
});

Deno.test("as: on grammar replaces default ID with alias", () => {
  const config = viola()
    .add(mockTsGrammar).as("ts")
    .build();

  // "ts" alias should be registered
  assertEquals(config.grammarRegistry.has("ts"), true);
  // Original "typescript" should not be accessible by that alias
  assertEquals(config.grammarRegistry.has("typescript"), false);
});

Deno.test("as: add(grammar).as() then add(linter).as() works correctly", () => {
  const config = viola()
    .add(mockTsGrammar).as("ts")
    .add(createMockLinter("my-linter")).as("my-alias")
    .build();

  assertEquals(config.grammarRegistry.has("ts"), true);
  assertEquals(config.linters.length, 1);
  assertEquals(config.linters[0]!.meta.id, "my-linter");
});

// =============================================================================
// 2. .use() Error Handling
// =============================================================================

Deno.test("use: throws for string input", () => {
  assertThrows(
    () => viola().use("not-a-plugin" as unknown as ViolaPlugin),
    Error,
    "Invalid plugin",
  );
});

Deno.test("use: throws for null input", () => {
  assertThrows(
    () => viola().use(null as unknown as ViolaPlugin),
    Error,
    "Invalid plugin",
  );
});

Deno.test("use: throws for object without build method", () => {
  assertThrows(
    () => viola().use({ name: "bad" } as unknown as ViolaPlugin),
    Error,
    "Invalid plugin",
  );
});

Deno.test("use: plugin error propagates to caller", () => {
  const badPlugin: ViolaPlugin = {
    build() {
      throw new Error("Plugin setup failed");
    },
  };

  assertThrows(
    () => viola().use(badPlugin),
    Error,
    "Plugin setup failed",
  );
});

// =============================================================================
// 3. .add() Error Handling & Edge Cases
// =============================================================================

Deno.test("add: throws for string input", () => {
  assertThrows(
    () => viola().add("not-a-linter" as unknown as BaseLinter),
    Error,
    "Invalid input",
  );
});

Deno.test("add: empty array adds nothing, no error", () => {
  const config = viola().add([]).build();
  assertEquals(config.linters.length, 0);
});

Deno.test("add: array with non-linter items skips invalid entries", () => {
  const validLinter = createMockLinter("valid");
  const mixedArray = [
    validLinter,
    "not-a-linter" as unknown as BaseLinter,
    42 as unknown as BaseLinter,
  ];

  const config = viola().add(mixedArray).build();
  // Only the valid linter should be added
  assertEquals(config.linters.length, 1);
  assertEquals(config.linters[0]!.meta.id, "valid");
});

Deno.test("add: null throws error", () => {
  assertThrows(
    () => viola().add(null as unknown as BaseLinter),
    Error,
    "Invalid input",
  );
});

// =============================================================================
// 4. .set() Edge Cases
// =============================================================================

Deno.test("set: key with multiple dots splits only on first dot", () => {
  const config = viola()
    .set("my-linter.deep.nested.key", "value")
    .build();

  assertEquals(config.settings.length, 1);
  assertEquals(config.settings[0]!.linter, "my-linter");
  assertEquals(config.settings[0]!.key, "deep.nested.key");
  assertEquals(config.settings[0]!.value, "value");
});

Deno.test("set: empty string key with dot notation", () => {
  // ".key" → linter = "", key = "key"
  const config = viola()
    .set(".mykey", "value")
    .build();

  assertEquals(config.settings.length, 1);
  assertEquals(config.settings[0]!.linter, "");
  assertEquals(config.settings[0]!.key, "mykey");
});

Deno.test("set: multiple object set calls accumulate all settings", () => {
  const config = viola()
    .set("linter-a", { opt1: 1, opt2: 2 })
    .set("linter-a", { opt3: 3 })
    .set("linter-b", { optX: "x" })
    .build();

  assertEquals(config.settings.length, 4);
  const linterASettings = config.settings.filter((s) =>
    s.linter === "linter-a"
  );
  assertEquals(linterASettings.length, 3);
});

// =============================================================================
// 5. Build Immutability
// =============================================================================

Deno.test("build: rules are frozen (cannot mutate)", () => {
  const config = viola()
    .rule(report.error, when.in("src/**"))
    .build();

  // Attempting to assign to a frozen property should throw in strict mode
  // or silently fail. deepFreeze makes the rule deeply immutable.
  const rule = config.rules[0]!;
  assertThrows(
    () => {
      (rule as { action: unknown }).action = { type: "report", level: "info" };
    },
    TypeError,
  );
});

Deno.test("build: settings are frozen (cannot mutate)", () => {
  const config = viola()
    .set("my-linter.opt", "value")
    .build();

  const setting = config.settings[0]!;
  assertThrows(
    () => {
      (setting as { value: unknown }).value = "changed";
    },
    TypeError,
  );
});

// =============================================================================
// 6. Complex Condition Compositions
// =============================================================================

Deno.test("composition: a.and(b).or(c) - OR is outer, AND is left branch", () => {
  const catalogs = createTestCatalog();

  // (in src/** AND major+) OR (in tests/**)
  const cond = when.in("src/**")
    .and(when.impact.atLeast(Impact.Major))
    .or(when.in("tests/**"));

  const config = viola()
    .rule(report.error, cond)
    .build();

  // src + major → matches left AND → matches OR → error
  const r1 = evaluateIssue(
    createMockIssue("test-linter/major-issue", "src/lib.ts"),
    config.rules,
    catalogs,
  );
  assertEquals(r1.level, ReportLevel.Error);

  // tests (any) → matches right of OR → error
  const r2 = evaluateIssue(
    createMockIssue("test-linter/trivial-issue", "tests/foo.ts"),
    config.rules,
    catalogs,
  );
  assertEquals(r2.level, ReportLevel.Error);

  // src + minor → left AND fails, right OR fails → default
  const r3 = evaluateIssue(
    createMockIssue("test-linter/minor-issue", "src/lib.ts"),
    config.rules,
    catalogs,
  );
  assertEquals(r3.level, ReportLevel.Warn);
});

Deno.test("composition: a.or(b).and(c) - AND is outer, OR is left branch", () => {
  const catalogs = createTestCatalog();

  // (in **/*_test.ts OR in **/*.spec.ts) AND major+
  const cond = when.in("**/*_test.ts")
    .or(when.in("**/*.spec.ts"))
    .and(when.impact.atLeast(Impact.Major));

  const config = viola()
    .rule(report.error, cond)
    .build();

  // test file + major → matches
  const r1 = evaluateIssue(
    createMockIssue("test-linter/major-issue", "src/foo_test.ts"),
    config.rules,
    catalogs,
  );
  assertEquals(r1.level, ReportLevel.Error);

  // test file + minor → AND fails (minor < major)
  const r2 = evaluateIssue(
    createMockIssue("test-linter/minor-issue", "src/foo_test.ts"),
    config.rules,
    catalogs,
  );
  assertEquals(r2.level, ReportLevel.Warn);

  // non-test file + major → OR fails
  const r3 = evaluateIssue(
    createMockIssue("test-linter/major-issue", "src/foo.ts"),
    config.rules,
    catalogs,
  );
  assertEquals(r3.level, ReportLevel.Warn);
});

Deno.test("composition: NOT on compound condition", () => {
  const catalogs = createTestCatalog();

  // NOT(in src/** AND major+) → matches when file is NOT in src or impact is NOT major+
  const cond = when.all(
    when.in("src/**"),
    when.impact.atLeast(Impact.Major),
  ).not();

  const config = viola()
    .rule(report.off, cond)
    .build();

  // src + major → NOT(true) → false → default
  const r1 = evaluateIssue(
    createMockIssue("test-linter/major-issue", "src/lib.ts"),
    config.rules,
    catalogs,
  );
  assertEquals(r1.level, ReportLevel.Warn);

  // src + minor → NOT(false) → true → off
  const r2 = evaluateIssue(
    createMockIssue("test-linter/minor-issue", "src/lib.ts"),
    config.rules,
    catalogs,
  );
  assertEquals(r2.level, ReportLevel.Off);

  // lib + major → NOT(false) → true → off
  const r3 = evaluateIssue(
    createMockIssue("test-linter/major-issue", "lib/lib.ts"),
    config.rules,
    catalogs,
  );
  assertEquals(r3.level, ReportLevel.Off);
});

// =============================================================================
// 7. Condition Error Cases
// =============================================================================

Deno.test("when.all() with 0 args throws", () => {
  assertThrows(
    () => when.all(),
    Error,
    "at least one condition",
  );
});

Deno.test("when.any() with 0 args throws", () => {
  assertThrows(
    () => when.any(),
    Error,
    "at least one condition",
  );
});

Deno.test("when.all() with 1 arg returns the condition directly", () => {
  const single = when.in("src/**");
  const wrapped = when.all(single);

  // Should be the same ConditionExpr (returns conditions[0])
  assertEquals(wrapped.condition, single.condition);
});

// =============================================================================
// 8. Evaluator Edge Cases
// =============================================================================

Deno.test("evaluator: issue kind without slash", () => {
  const catalogs = new Map<string, IssueCatalog>();
  catalogs.set("unknown", {
    "unknown": {
      category: "correctness",
      impact: "major",
      description: "Issue with no slash",
    },
  });

  const issue = createMockIssue("unknown", "src/a.ts");
  const context = createEvaluationContext(issue, catalogs);

  assertEquals(context.linterId, "unknown");
  assertEquals(context.issueName, "");
  // The catalog lookup uses issue.kind which is "unknown"
  // and catalogs.get("unknown")?.["unknown"] should find it
  assertEquals(context.issueDef !== undefined, true);
});

Deno.test("evaluator: issue kind with multiple slashes splits on first", () => {
  const issue = createMockIssue("my-linter/sub/issue", "src/a.ts");
  const catalogs = new Map<string, IssueCatalog>();
  const context = createEvaluationContext(issue, catalogs);

  assertEquals(context.linterId, "my-linter");
  assertEquals(context.issueName, "sub/issue");
});

Deno.test("evaluator: confidence boundary values (0 and 100)", () => {
  const catalogs = createTestCatalog();

  const config = viola()
    .rule(report.off, when.confidence.below(1))
    .rule(report.error, when.confidence.atLeast(100))
    .build();

  // Confidence 0 → below(1) matches (0 < 1 → no, 0 > 1? no)
  // Actually: below(1) creates confidence condition with max=1
  // evaluateConfidenceCondition: confidence > max → false, so 0 > 1 = false → passes
  // So confidence 0 passes (0 is NOT > 1)
  const r1 = evaluateIssue(
    createMockIssue("test-linter/minor-issue", "src/a.ts", 0),
    config.rules,
    catalogs,
  );
  // below(1) → max=1, 0 > 1 = false → condition passes → but wait,
  // last wins, atLeast(100) → min=100, 0 < 100 → fails
  // So below(1): 0 > 1? No. min check: undefined. → condition matches!
  // atLeast(100): 0 < 100? yes → fails.
  // Reverse iteration: atLeast(100) first → fails. below(1) → matches → off
  assertEquals(r1.level, ReportLevel.Off);

  // Confidence 100 → atLeast(100) matches
  const r2 = evaluateIssue(
    createMockIssue("test-linter/minor-issue", "src/a.ts", 100),
    config.rules,
    catalogs,
  );
  assertEquals(r2.level, ReportLevel.Error);
});

Deno.test("evaluator: unknown condition type returns false", () => {
  const issue = createMockIssue("test-linter/minor-issue", "src/a.ts");
  const catalogs = createTestCatalog();
  const context = createEvaluationContext(issue, catalogs);

  // Create a condition with an unknown type
  const unknownCondition = { type: "unknown-type" } as unknown;
  const result = evaluateCondition(
    unknownCondition as Parameters<typeof evaluateCondition>[0],
    context,
  );
  assertEquals(result, false);
});

Deno.test("evaluator: unknown impact string in catalog returns false for impact condition", () => {
  const catalogs = new Map<string, IssueCatalog>();
  catalogs.set("weird-linter", {
    "weird-linter/issue": {
      category: "correctness",
      impact: "unknown-impact" as unknown as "critical",
      description: "Has unknown impact",
    },
  });

  const issue = createMockIssue("weird-linter/issue", "src/a.ts");
  const config = viola()
    .rule(report.error, when.impact.atLeast(Impact.Major))
    .build();

  const result = evaluateIssue(issue, config.rules, catalogs);
  // Impact condition can't match unknown impact → no rule matches → default
  assertEquals(result.level, ReportLevel.Warn);
});

Deno.test("evaluator: unknown category string in catalog returns false for category condition", () => {
  const catalogs = new Map<string, IssueCatalog>();
  catalogs.set("weird-linter", {
    "weird-linter/issue": {
      category: "unknown-category" as unknown as "correctness",
      impact: "major",
      description: "Has unknown category",
    },
  });

  const issue = createMockIssue("weird-linter/issue", "src/a.ts");
  const config = viola()
    .rule(report.error, when.category.is(Category.Correctness))
    .build();

  const result = evaluateIssue(issue, config.rules, catalogs);
  assertEquals(result.level, ReportLevel.Warn);
});

// =============================================================================
// 9. Builder State Isolation
// =============================================================================

Deno.test("isolation: two builders don't share linter state", () => {
  const builderA = viola().add(createMockLinter("linter-a"));
  const builderB = viola().add(createMockLinter("linter-b"));

  const configA = builderA.build();
  const configB = builderB.build();

  assertEquals(configA.linters.length, 1);
  assertEquals(configA.linters[0]!.meta.id, "linter-a");
  assertEquals(configB.linters.length, 1);
  assertEquals(configB.linters[0]!.meta.id, "linter-b");
});

Deno.test("isolation: two builders don't share rule state", () => {
  const builderA = viola().rule(report.error, when.in("src/**"));
  const builderB = viola().rule(report.warn, when.in("lib/**"));

  const configA = builderA.build();
  const configB = builderB.build();

  assertEquals(configA.rules.length, 1);
  assertEquals(configB.rules.length, 1);
  assertEquals(getActionLevel(configA.rules[0]!.action), ReportLevel.Error);
  assertEquals(getActionLevel(configB.rules[0]!.action), ReportLevel.Warn);
});

Deno.test("isolation: plugin modifying builder A doesn't affect builder B", () => {
  const testPlugin: ViolaPlugin = {
    build(builder) {
      builder.add(createMockLinter("plugin-linter"));
      builder.rule(report.error, when.in("src/**"));
    },
  };

  const builderA = viola().use(testPlugin);
  const builderB = viola();

  const configA = builderA.build();
  const configB = builderB.build();

  assertEquals(configA.linters.length, 1);
  assertEquals(configA.rules.length, 1);
  assertEquals(configB.linters.length, 0);
  assertEquals(configB.rules.length, 0);
});

// =============================================================================
// 10. Ordering Guarantees
// =============================================================================

Deno.test("ordering: 10+ rules maintain exact definition order", () => {
  let builder = viola();
  for (let i = 0; i < 15; i++) {
    builder = builder.rule(report.warn, when.in(`pattern-${i}/**`));
  }

  const config = builder.build();
  assertEquals(config.rules.length, 15);

  // Verify each rule's condition has the right pattern
  for (let i = 0; i < 15; i++) {
    const cond = config.rules[i]!.condition;
    assertEquals(cond.type, "file");
    if (cond.type === "file") {
      assertEquals(
        (cond as unknown as { patterns: string[] }).patterns[0],
        `pattern-${i}/**`,
      );
    }
  }
});

Deno.test("ordering: plugin rules interleaved with user rules preserve order", () => {
  const pluginA: ViolaPlugin = {
    build(builder) {
      builder.rule(report.info, when.in("plugin-a/**"));
    },
  };

  const config = viola()
    .rule(report.error, when.in("user-1/**"))
    .use(pluginA)
    .rule(report.warn, when.in("user-2/**"))
    .build();

  assertEquals(config.rules.length, 3);
  assertEquals(getActionLevel(config.rules[0]!.action), ReportLevel.Error);
  assertEquals(getActionLevel(config.rules[1]!.action), ReportLevel.Info);
  assertEquals(getActionLevel(config.rules[2]!.action), ReportLevel.Warn);
});

Deno.test("ordering: three plugins in sequence maintain A→B→C order", () => {
  const pluginA: ViolaPlugin = {
    build(b) {
      b.rule(report.error, when.in("a/**"));
    },
  };
  const pluginB: ViolaPlugin = {
    build(b) {
      b.rule(report.warn, when.in("b/**"));
    },
  };
  const pluginC: ViolaPlugin = {
    build(b) {
      b.rule(report.info, when.in("c/**"));
    },
  };

  const config = viola()
    .use(pluginA)
    .use(pluginB)
    .use(pluginC)
    .build();

  assertEquals(config.rules.length, 3);
  assertEquals(getActionLevel(config.rules[0]!.action), ReportLevel.Error);
  assertEquals(getActionLevel(config.rules[1]!.action), ReportLevel.Warn);
  assertEquals(getActionLevel(config.rules[2]!.action), ReportLevel.Info);
});

Deno.test("ordering: settings maintain insertion order", () => {
  const config = viola()
    .set("linter-a.opt1", 1)
    .set("linter-b.opt1", 2)
    .set("linter-a.opt2", 3)
    .build();

  assertEquals(config.settings.length, 3);
  assertEquals(config.settings[0]!.linter, "linter-a");
  assertEquals(config.settings[0]!.key, "opt1");
  assertEquals(config.settings[1]!.linter, "linter-b");
  assertEquals(config.settings[1]!.key, "opt1");
  assertEquals(config.settings[2]!.linter, "linter-a");
  assertEquals(config.settings[2]!.key, "opt2");
});

Deno.test("ordering: grammar rules maintain order separately from report rules", () => {
  const config = viola()
    .add(mockTsGrammar).as("ts")
    .add(mockJsGrammar).as("js")
    .rule(report.error, when.in("src/**"))
    .rule(grammar("ts").overrides("js"), when.in("*.ts"))
    .rule(report.warn, when.in("lib/**"))
    .rule(grammar("ts").supplements("js"), when.in("*.js"))
    .build();

  // Report rules: error, warn (2 total, in order)
  assertEquals(config.rules.length, 2);
  assertEquals(getActionLevel(config.rules[0]!.action), ReportLevel.Error);
  assertEquals(getActionLevel(config.rules[1]!.action), ReportLevel.Warn);

  // Grammar rules: overrides, supplements (2 total, in order)
  assertEquals(config.grammarRules.length, 2);
  assertEquals(config.grammarRules[0]!.action.relationship, "overrides");
  assertEquals(config.grammarRules[1]!.action.relationship, "supplements");
});

// =============================================================================
// 11. "Last Wins" Advanced Scenarios
// =============================================================================

Deno.test("last-wins: three plugins → user override wins", () => {
  const catalogs = createTestCatalog();

  const pluginA: ViolaPlugin = {
    build(b) {
      b.rule(report.error, when.in("**/*.ts"));
    },
  };
  const pluginB: ViolaPlugin = {
    build(b) {
      b.rule(report.warn, when.in("**/*.ts"));
    },
  };

  const config = viola()
    .use(pluginA)
    .use(pluginB)
    .rule(report.info, when.in("**/*.ts"))
    .build();

  const issue = createMockIssue("test-linter/minor-issue", "src/file.ts");
  const result = evaluateIssue(issue, config.rules, catalogs);

  assertEquals(result.level, ReportLevel.Info);
  assertEquals(result.matchedRule, 2);
});

// =============================================================================
// 12. Grammar + Report Rule Interaction
// =============================================================================

Deno.test("grammar-report: grammar rules don't interfere with report evaluation", () => {
  const catalogs = createTestCatalog();

  const config = viola()
    .add(mockTsGrammar).as("ts")
    .add(mockJsGrammar).as("js")
    .rule(grammar("ts").overrides("js"), when.in("*.ts"))
    .rule(report.error, when.in("src/**"))
    .build();

  // Report evaluation should only see report rules
  const issue = createMockIssue("test-linter/minor-issue", "src/file.ts");
  const result = evaluateIssue(issue, config.rules, catalogs);

  assertEquals(result.level, ReportLevel.Error);
  assertEquals(result.matchedRule, 0); // Only 1 report rule at index 0
});

Deno.test("grammar-report: report rules don't end up in grammarRules", () => {
  const config = viola()
    .add(mockTsGrammar).as("ts")
    .add(mockJsGrammar).as("js")
    .rule(report.error, when.in("src/**"))
    .rule(grammar("ts").overrides("js"), when.in("*.ts"))
    .rule(report.warn, when.in("lib/**"))
    .build();

  // grammarRules should only have grammar relationship actions
  assertEquals(config.grammarRules.length, 1);
  assertEquals(config.grammarRules[0]!.action.type, "grammar-relationship");

  // report rules should only have report actions
  assertEquals(config.rules.length, 2);
  for (const rule of config.rules) {
    assertEquals(rule.action.type, "report");
  }
});

Deno.test("grammar-report: interleaved grammar and report rules maintain separate order", () => {
  const config = viola()
    .add(mockTsGrammar).as("ts")
    .add(mockJsGrammar).as("js")
    .rule(report.error, when.in("a/**"))
    .rule(grammar("ts").overrides("js"), when.in("*.ts"))
    .rule(report.warn, when.in("b/**"))
    .rule(grammar("ts").supplements("js"), when.in("*.js"))
    .rule(report.info, when.in("c/**"))
    .build();

  // Report rules: error, warn, info (in order)
  assertEquals(config.rules.length, 3);
  assertEquals(getActionLevel(config.rules[0]!.action), ReportLevel.Error);
  assertEquals(getActionLevel(config.rules[1]!.action), ReportLevel.Warn);
  assertEquals(getActionLevel(config.rules[2]!.action), ReportLevel.Info);

  // Grammar rules: overrides, supplements (in order)
  assertEquals(config.grammarRules.length, 2);
  assertEquals(config.grammarRules[0]!.action.relationship, "overrides");
  assertEquals(config.grammarRules[1]!.action.relationship, "supplements");
});

Deno.test("grammar-report: plugin adding both grammar and report rules", () => {
  const mixedPlugin: ViolaPlugin = {
    build(builder) {
      builder
        .add(mockTsGrammar).as("ts")
        .add(mockJsGrammar).as("js")
        .rule(grammar("ts").overrides("js"), when.in("*.ts"))
        .rule(report.error, when.impact.atLeast(Impact.Major))
        .rule(report.warn, when.impact.is(Impact.Minor));
    },
  };

  const config = viola()
    .use(mixedPlugin)
    .rule(report.off, when.in("tests/**"))
    .build();

  assertEquals(config.grammarRegistry.size, 2);
  assertEquals(config.grammarRules.length, 1);
  assertEquals(config.rules.length, 3); // 2 from plugin + 1 user
  assertEquals(config.linters.length, 0); // grammars aren't linters
});

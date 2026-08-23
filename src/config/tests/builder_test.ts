/**
 * Tests for the ViolaBuilder and plugin system.
 *
 * Validates "last wins" rule semantics and plugin integration.
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import type { CodebaseData, Issue } from "../../data/types.ts";
import type { BaseLinter } from "../../linters/base.ts";
import { isReportAction, report } from "../actions.ts";
import { plugin, viola, type ViolaPlugin } from "../builder.ts";
import { when } from "../conditions.ts";
import { Category, Impact, ReportLevel } from "../enums.ts";
import {
  countByLevel,
  type EvaluatedIssue,
  evaluateIssue,
  evaluateIssues,
  filterReportableIssues,
} from "../evaluator.ts";
import type { IssueCatalog } from "../types.ts";

/** Helper to extract level from a rule action */
function getActionLevel(action: { type: string }): ReportLevel | undefined {
  if (isReportAction(action)) {
    return action.level;
  }
  return undefined;
}

// =============================================================================
// Test Fixtures
// =============================================================================

/** Create a mock linter for testing */
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

/** Create a mock issue for testing */
function createMockIssue(
  kind: string,
  file: string,
  confidence = 80,
): Issue {
  return {
    kind,
    location: {
      file,
      line: 1,
      column: 1,
    },
    message: `Test issue: ${kind}`,
    confidence,
  };
}

/** Create a test catalog */
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

// =============================================================================
// Builder Basic Tests
// =============================================================================

Deno.test("ViolaBuilder.build() returns empty config by default", () => {
  const config = viola().build();

  assertEquals(config.linters.length, 0);
  assertEquals(config.rules.length, 0);
  assertEquals(config.settings.length, 0);
});

Deno.test("ViolaBuilder.add() adds a single linter", () => {
  const linter = createMockLinter("test-linter");
  const config = viola().add(linter).build();

  assertEquals(config.linters.length, 1);
  assertEquals(config.linters[0]!.meta.id, "test-linter");
});

Deno.test("ViolaBuilder.add() adds an array of linters", () => {
  const linters = [
    createMockLinter("linter-a"),
    createMockLinter("linter-b"),
    createMockLinter("linter-c"),
  ];
  const config = viola().add(linters).build();

  assertEquals(config.linters.length, 3);
  assertEquals(config.linters[0]!.meta.id, "linter-a");
  assertEquals(config.linters[1]!.meta.id, "linter-b");
  assertEquals(config.linters[2]!.meta.id, "linter-c");
});

// =============================================================================
// Settings Tests
// =============================================================================

Deno.test("ViolaBuilder.set() with dot notation", () => {
  const config = viola()
    .set("my-linter.threshold", 0.85)
    .build();

  assertEquals(config.settings.length, 1);
  assertEquals(config.settings[0]!.linter, "my-linter");
  assertEquals(config.settings[0]!.key, "threshold");
  assertEquals(config.settings[0]!.value, 0.85);
});

Deno.test("ViolaBuilder.set() with object value", () => {
  const config = viola()
    .set("my-linter", { threshold: 0.85, minLength: 10 })
    .build();

  assertEquals(config.settings.length, 2);

  const settings = new Map(config.settings.map((s) => [s.key, s.value]));
  assertEquals(settings.get("threshold"), 0.85);
  assertEquals(settings.get("minLength"), 10);
});

Deno.test("ViolaBuilder.set() last setting wins", () => {
  const config = viola()
    .set("my-linter.threshold", 0.5)
    .set("my-linter.threshold", 0.9)
    .build();

  // Both settings are stored (last wins is evaluated at use time)
  assertEquals(config.settings.length, 2);
  assertEquals(config.settings[1]!.value, 0.9);
});

// =============================================================================
// Rule Tests
// =============================================================================

Deno.test("ViolaBuilder.rule() adds a rule", () => {
  const config = viola()
    .rule(report.error, when.impact.atLeast(Impact.Major))
    .build();

  assertEquals(config.rules.length, 1);
});

// =============================================================================
// Plugin Tests
// =============================================================================

Deno.test("ViolaBuilder.use() accepts plugin object", () => {
  const testPlugin: ViolaPlugin = {
    build(builder) {
      builder.add(createMockLinter("plugin-linter"));
    },
  };

  const config = viola().use(testPlugin).build();
  assertEquals(config.linters.length, 1);
  assertEquals(config.linters[0]!.meta.id, "plugin-linter");
});

Deno.test("ViolaBuilder.use() accepts plugin function", () => {
  const config = viola()
    .use((builder) => {
      builder.add(createMockLinter("fn-linter"));
    })
    .build();

  assertEquals(config.linters.length, 1);
  assertEquals(config.linters[0]!.meta.id, "fn-linter");
});

Deno.test("plugin() helper creates a plugin from function", () => {
  const testPlugin = plugin((builder) => {
    builder.add(createMockLinter("helper-linter"));
  });

  const config = viola().use(testPlugin).build();
  assertEquals(config.linters.length, 1);
  assertEquals(config.linters[0]!.meta.id, "helper-linter");
});

Deno.test("Plugin can add linters, rules, and settings", () => {
  const testPlugin: ViolaPlugin = {
    build(builder) {
      builder
        .add(createMockLinter("plugin-linter"))
        .rule(report.error, when.impact.atLeast(Impact.Critical))
        .set("plugin-linter.option", "value");
    },
  };

  const config = viola().use(testPlugin).build();

  assertEquals(config.linters.length, 1);
  assertEquals(config.rules.length, 1);
  assertEquals(config.settings.length, 1);
});

// =============================================================================
// "Last Wins" Semantics Tests
// =============================================================================

Deno.test("Last wins: later rules override earlier rules", () => {
  const catalogs = createTestCatalog();
  const issue = createMockIssue("test-linter/major-issue", "src/file.ts");

  const config = viola()
    .rule(report.warn, when.impact.atLeast(Impact.Minor))
    .rule(report.error, when.impact.atLeast(Impact.Major))
    .build();

  const result = evaluateIssue(issue, config.rules, catalogs);

  // Both rules match, but error (last) should win
  assertEquals(result.level, ReportLevel.Error);
});

Deno.test("Last wins: user rules after plugin rules take precedence", () => {
  const catalogs = createTestCatalog();
  const issue = createMockIssue("test-linter/major-issue", "src/utils_test.ts");

  // Plugin sets error for major issues
  const testPlugin: ViolaPlugin = {
    build(builder) {
      builder.rule(report.error, when.impact.atLeast(Impact.Major));
    },
  };

  // User overrides: tests should be off
  const config = viola()
    .use(testPlugin)
    .rule(report.off, when.in("**/*_test.ts"))
    .build();

  const result = evaluateIssue(issue, config.rules, catalogs);

  // User's off rule comes last and matches, so it wins
  assertEquals(result.level, ReportLevel.Off);
});

// =============================================================================
// Complex Scenario Tests
// =============================================================================

Deno.test("Complex: realistic plugin + user overrides scenario", () => {
  const catalogs = createTestCatalog();

  // Simulate a default-lints style plugin
  const defaultLintsPlugin: ViolaPlugin = {
    build(builder) {
      builder
        .rule(report.error, when.impact.atLeast(Impact.Major))
        .rule(report.warn, when.impact.is(Impact.Minor))
        .rule(report.info, when.impact.is(Impact.Trivial));
    },
  };

  // User config
  const config = viola()
    .use(defaultLintsPlugin)
    .rule(report.off, when.in("**/*_test.ts"))
    .rule(report.off, when.in("**/*.spec.ts"))
    .rule(report.error, when.in("packages/core/**"))
    .build();

  // Test cases
  const issues = [
    createMockIssue("test-linter/critical-issue", "src/main.ts"),
    createMockIssue("test-linter/major-issue", "src/utils_test.ts"),
    createMockIssue("test-linter/minor-issue", "packages/core/lib.ts"),
    createMockIssue("test-linter/trivial-issue", "src/helpers.ts"),
    createMockIssue("test-linter/major-issue", "tests/foo.spec.ts"),
  ];

  const results = evaluateIssues(issues, config.rules, catalogs);

  // src/main.ts critical → error (plugin rule, no user override matches)
  assertEquals(results[0]!.level, ReportLevel.Error);

  // src/utils_test.ts major → off (user override for tests)
  assertEquals(results[1]!.level, ReportLevel.Off);

  // packages/core/lib.ts minor → error (user override for core)
  assertEquals(results[2]!.level, ReportLevel.Error);

  // src/helpers.ts trivial → info (plugin rule)
  assertEquals(results[3]!.level, ReportLevel.Info);

  // tests/foo.spec.ts major → off (user override for spec)
  assertEquals(results[4]!.level, ReportLevel.Off);
});

Deno.test("Complex: category-based rules", () => {
  const catalogs = createTestCatalog();

  const config = viola()
    .rule(report.error, when.category.is(Category.Correctness))
    .rule(report.hint, when.category.is(Category.Style))
    .build();

  const issues = [
    createMockIssue("test-linter/critical-issue", "src/a.ts"), // correctness
    createMockIssue("test-linter/trivial-issue", "src/b.ts"), // style
    createMockIssue("test-linter/minor-issue", "src/c.ts"), // consistency - no match
  ];

  const results = evaluateIssues(issues, config.rules, catalogs);

  assertEquals(results[0]!.level, ReportLevel.Error);
  assertEquals(results[1]!.level, ReportLevel.Hint);
  assertEquals(results[2]!.level, ReportLevel.Warn); // default
});

Deno.test("Complex: linter-specific rules", () => {
  const catalogs = createTestCatalog();

  const config = viola()
    .rule(report.off, when.linter("other-linter"))
    .rule(report.error, when.linter("test-linter"))
    .build();

  const issues = [
    createMockIssue("test-linter/minor-issue", "src/a.ts"),
    createMockIssue("other-linter/perf-issue", "src/b.ts"),
  ];

  const results = evaluateIssues(issues, config.rules, catalogs);

  assertEquals(results[0]!.level, ReportLevel.Error);
  assertEquals(results[1]!.level, ReportLevel.Off);
});

Deno.test("Complex: confidence filtering", () => {
  const catalogs = createTestCatalog();

  const config = viola()
    .rule(report.off, when.confidence.below(60))
    .rule(report.warn, when.impact.atLeast(Impact.Minor))
    .build();

  const issues = [
    createMockIssue("test-linter/minor-issue", "src/a.ts", 80), // high confidence
    createMockIssue("test-linter/minor-issue", "src/b.ts", 40), // low confidence
  ];

  const results = evaluateIssues(issues, config.rules, catalogs);

  assertEquals(results[0]!.level, ReportLevel.Warn); // confidence rule doesn't match
  assertEquals(results[1]!.level, ReportLevel.Warn); // both match, warn is last
});

// =============================================================================
// Filter and Count Tests
// =============================================================================

Deno.test("filterReportableIssues removes off and skip", () => {
  const evaluated: EvaluatedIssue[] = [
    {
      issue: createMockIssue("a", "a.ts"),
      level: ReportLevel.Error,
      matchedRule: 0,
    },
    {
      issue: createMockIssue("b", "b.ts"),
      level: ReportLevel.Off,
      matchedRule: 1,
    },
    {
      issue: createMockIssue("c", "c.ts"),
      level: ReportLevel.Skip,
      matchedRule: 2,
    },
    {
      issue: createMockIssue("d", "d.ts"),
      level: ReportLevel.Warn,
      matchedRule: 3,
    },
  ];

  const reportable = filterReportableIssues(evaluated);

  assertEquals(reportable.length, 2);
  assertEquals(reportable[0]!.level, ReportLevel.Error);
  assertEquals(reportable[1]!.level, ReportLevel.Warn);
});

Deno.test("countByLevel counts correctly", () => {
  const evaluated: EvaluatedIssue[] = [
    {
      issue: createMockIssue("a", "a.ts"),
      level: ReportLevel.Error,
      matchedRule: 0,
    },
    {
      issue: createMockIssue("b", "b.ts"),
      level: ReportLevel.Error,
      matchedRule: 0,
    },
    {
      issue: createMockIssue("c", "c.ts"),
      level: ReportLevel.Warn,
      matchedRule: 1,
    },
    {
      issue: createMockIssue("d", "d.ts"),
      level: ReportLevel.Info,
      matchedRule: 2,
    },
    {
      issue: createMockIssue("e", "e.ts"),
      level: ReportLevel.Off,
      matchedRule: 3,
    },
  ];

  const counts = countByLevel(evaluated);

  assertEquals(counts[ReportLevel.Error], 2);
  assertEquals(counts[ReportLevel.Warn], 1);
  assertEquals(counts[ReportLevel.Info], 1);
  assertEquals(counts[ReportLevel.Hint], 0);
  assertEquals(counts[ReportLevel.Off], 1);
  assertEquals(counts[ReportLevel.Skip], 0);
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("Edge: empty rules array uses default", () => {
  const catalogs = createTestCatalog();
  const config = viola().build();

  const issue = createMockIssue("test-linter/minor-issue", "src/a.ts");
  const result = evaluateIssue(issue, config.rules, catalogs);

  assertEquals(result.level, ReportLevel.Warn);
  assertEquals(result.matchedRule, -1);
});

Deno.test("Edge: issue without catalog entry", () => {
  const catalogs = new Map<string, IssueCatalog>();

  const config = viola()
    .rule(report.error, when.impact.atLeast(Impact.Major))
    .rule(report.warn, when.in("**/*.ts"))
    .build();

  const issue = createMockIssue("unknown-linter/unknown-issue", "src/a.ts");
  const result = evaluateIssue(issue, config.rules, catalogs);

  // Impact condition can't match (no catalog), but file condition can
  assertEquals(result.level, ReportLevel.Warn);
});

Deno.test("Edge: deeply nested plugin", () => {
  const innerPlugin = plugin((builder) => {
    builder.rule(report.info, when.impact.is(Impact.Trivial));
  });

  const outerPlugin = plugin((builder) => {
    builder.use(innerPlugin).rule(report.warn, when.impact.is(Impact.Minor));
  });

  const config = viola()
    .use(outerPlugin)
    .rule(report.error, when.impact.atLeast(Impact.Major))
    .build();

  // Rules should be: info, warn, error (in definition order)
  assertEquals(config.rules.length, 3);
  assertEquals(getActionLevel(config.rules[0]!.action), ReportLevel.Info);
  assertEquals(getActionLevel(config.rules[1]!.action), ReportLevel.Warn);
  assertEquals(getActionLevel(config.rules[2]!.action), ReportLevel.Error);
});

Deno.test("Edge: plugin adds same linter multiple times", () => {
  const linter = createMockLinter("shared-linter");

  const pluginA = plugin((builder) => {
    builder.add(linter);
  });

  const pluginB = plugin((builder) => {
    builder.add(linter);
  });

  const config = viola().use(pluginA).use(pluginB).build();

  // Both instances are added (deduplication is caller's responsibility)
  assertEquals(config.linters.length, 2);
});

Deno.test("Edge: all report levels", () => {
  const catalogs = createTestCatalog();

  const config = viola()
    .rule(report.error, when.in("**/error.ts"))
    .rule(report.warn, when.in("**/warn.ts"))
    .rule(report.info, when.in("**/info.ts"))
    .rule(report.hint, when.in("**/hint.ts"))
    .rule(report.off, when.in("**/off.ts"))
    .rule(report.skip, when.in("**/skip.ts"))
    .build();

  const issues = [
    createMockIssue("test-linter/minor-issue", "src/error.ts"),
    createMockIssue("test-linter/minor-issue", "src/warn.ts"),
    createMockIssue("test-linter/minor-issue", "src/info.ts"),
    createMockIssue("test-linter/minor-issue", "src/hint.ts"),
    createMockIssue("test-linter/minor-issue", "src/off.ts"),
    createMockIssue("test-linter/minor-issue", "src/skip.ts"),
  ];

  const results = evaluateIssues(issues, config.rules, catalogs);

  assertEquals(results[0]!.level, ReportLevel.Error);
  assertEquals(results[1]!.level, ReportLevel.Warn);
  assertEquals(results[2]!.level, ReportLevel.Info);
  assertEquals(results[3]!.level, ReportLevel.Hint);
  assertEquals(results[4]!.level, ReportLevel.Off);
  assertEquals(results[5]!.level, ReportLevel.Skip);
});

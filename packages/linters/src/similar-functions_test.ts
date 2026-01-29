/**
 * Tests for the similar-functions linter.
 *
 * @module
 */

import type { LinterConfig } from "@hiisi/viola";
import { assertEquals } from "@std/assert";
import { SimilarFunctionsLinter } from "./similar-functions.ts";
import {
    defaultConfig,
    expectNoViolations,
    first,
    mockCodebase,
    mockFile,
    mockFunction
} from "./test_utils.ts";

const linter = new SimilarFunctionsLinter();

// Use a lower threshold for testing
const lowThresholdConfig: LinterConfig = {
  ...defaultConfig,
  options: { minSimilarity: 0.5, warningThreshold: 0.5, errorThreshold: 0.8 },
};

// =============================================================================
// Basic Functionality
// =============================================================================

Deno.test("similar-functions - no violations for unique function names", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        functions: [
          mockFunction({ name: "createUser", file: "src/app.ts", line: 1 }),
          mockFunction({ name: "deleteOrder", file: "src/app.ts", line: 10 }),
          mockFunction({ name: "fetchConfig", file: "src/app.ts", line: 20 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("similar-functions - reports functions with similar names (medium threshold)", () => {
  // "processUserData" vs "processUserDatas" has ~0.72 similarity (medium level)
  // Functions must be in DIFFERENT files to be compared (same file is skipped)
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        functions: [
          mockFunction({ name: "processUserData", file: "src/app.ts", line: 1 }),
        ],
      }),
      mockFile({
        path: "src/utils.ts",
        functions: [
          mockFunction({ name: "processUserDatas", file: "src/utils.ts", line: 1 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  assertEquals(first(violations).code, "similar-function-name-medium");
});

Deno.test("similar-functions - reports similar functions across files", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/user.ts",
        functions: [
          mockFunction({ name: "validateUserInput", file: "src/user.ts", line: 1 }),
        ],
      }),
      mockFile({
        path: "src/admin.ts",
        functions: [
          mockFunction({ name: "validateUserInputs", file: "src/admin.ts", line: 1 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  assertEquals(first(violations).code, "similar-function-name-medium");
});

Deno.test("similar-functions - identical names in different files produces high similarity", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/user.ts",
        functions: [
          mockFunction({ name: "validateRecord", file: "src/user.ts", line: 1 }),
        ],
      }),
      mockFile({
        path: "src/order.ts",
        functions: [
          mockFunction({ name: "validateRecord", file: "src/order.ts", line: 1 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  assertEquals(first(violations).code, "duplicate-function");
});

// =============================================================================
// Dissimilar Functions (Should Not Report)
// =============================================================================

Deno.test("similar-functions - does not report clearly different names", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        functions: [
          mockFunction({ name: "authenticate", file: "src/app.ts", line: 1 }),
          mockFunction({ name: "sendEmail", file: "src/app.ts", line: 10 }),
          mockFunction({ name: "calculateTotal", file: "src/app.ts", line: 20 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("similar-functions - does not report common verb prefixes on different nouns", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/api.ts",
        functions: [
          mockFunction({ name: "getUserProfile", file: "src/api.ts", line: 1 }),
          mockFunction({ name: "getOrderStatus", file: "src/api.ts", line: 10 }),
          mockFunction({ name: "getConfigValue", file: "src/api.ts", line: 20 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

// =============================================================================
// File Pattern Exclusions
// =============================================================================

Deno.test("similar-functions - ignores test files", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app_test.ts",
        functions: [
          mockFunction({ name: "processUserData", file: "src/app_test.ts", line: 1 }),
          mockFunction({ name: "processUserDatas", file: "src/app_test.ts", line: 10 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("similar-functions - ignores spec files", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.spec.ts",
        functions: [
          mockFunction({ name: "processUserData", file: "src/app.spec.ts", line: 1 }),
          mockFunction({ name: "processUserDatas", file: "src/app.spec.ts", line: 10 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("similar-functions - ignores files in tests/ directory", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "tests/helpers/setup.ts",
        functions: [
          mockFunction({ name: "processUserData", file: "tests/helpers/setup.ts", line: 1 }),
          mockFunction({ name: "processUserDatas", file: "tests/helpers/setup.ts", line: 10 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

// =============================================================================
// Anonymous Functions
// =============================================================================

Deno.test("similar-functions - ignores anonymous functions", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        functions: [
          mockFunction({ name: "", file: "src/app.ts", line: 1 }),
          mockFunction({ name: "", file: "src/app.ts", line: 10 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

// =============================================================================
// Violation Properties
// =============================================================================

Deno.test("similar-functions - violation has correct severity", () => {
  // Functions must be in DIFFERENT files to be compared
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        functions: [
          mockFunction({ name: "processUserData", file: "src/app.ts", line: 1 }),
        ],
      }),
      mockFile({
        path: "src/utils.ts",
        functions: [
          mockFunction({ name: "processUserDatas", file: "src/utils.ts", line: 1 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  assertEquals(first(violations).severity, "warning");
});

Deno.test("similar-functions - violation includes related locations", () => {
  // Functions must be in DIFFERENT files to be compared
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        functions: [
          mockFunction({ name: "processUserData", file: "src/app.ts", line: 1 }),
        ],
      }),
      mockFile({
        path: "src/utils.ts",
        functions: [
          mockFunction({ name: "processUserDatas", file: "src/utils.ts", line: 1 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  assertEquals(Array.isArray(first(violations).relatedLocations), true);
  assertEquals(first(violations).relatedLocations!.length >= 1, true);
});

Deno.test("similar-functions - violation includes suggestion", () => {
  // Functions must be in DIFFERENT files to be compared
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        functions: [
          mockFunction({ name: "processUserData", file: "src/app.ts", line: 1 }),
        ],
      }),
      mockFile({
        path: "src/utils.ts",
        functions: [
          mockFunction({ name: "processUserDatas", file: "src/utils.ts", line: 1 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  assertEquals(typeof first(violations).suggestion, "string");
  assertEquals(first(violations).suggestion!.length > 0, true);
});

Deno.test("similar-functions - violation has correct linter name", () => {
  // Functions must be in DIFFERENT files to be compared
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        functions: [
          mockFunction({ name: "processUserData", file: "src/app.ts", line: 1 }),
        ],
      }),
      mockFile({
        path: "src/utils.ts",
        functions: [
          mockFunction({ name: "processUserDatas", file: "src/utils.ts", line: 1 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  assertEquals(first(violations).linter, "similar-functions");
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("similar-functions - empty codebase produces no violations", () => {
  const data = mockCodebase({ files: [] });
  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("similar-functions - files with no functions produce no violations", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/constants.ts",
        functions: [],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("similar-functions - single function produces no violations", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        functions: [
          mockFunction({ name: "onlyFunction", file: "src/app.ts", line: 1 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

// =============================================================================
// Configuration Options
// =============================================================================

Deno.test("similar-functions - configurable similarity threshold", () => {
  // These names have ~0.62 similarity - below default 0.7 but above 0.5
  // Functions must be in DIFFERENT files to be compared
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        functions: [
          mockFunction({ name: "createUser", file: "src/app.ts", line: 1 }),
        ],
      }),
      mockFile({
        path: "src/utils.ts",
        functions: [
          mockFunction({ name: "createUsers", file: "src/utils.ts", line: 1 }),
        ],
      }),
    ],
  });

  // With default threshold (0.7), these shouldn't match
  const defaultViolations = linter.lint(data, defaultConfig);
  expectNoViolations(defaultViolations);

  // With lower threshold (0.5), they should match
  const lowThresholdViolations = linter.lint(data, lowThresholdConfig);
  assertEquals(lowThresholdViolations.length, 1);
});

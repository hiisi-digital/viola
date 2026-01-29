/**
 * Tests for the type-location linter.
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import {
    defaultConfig,
    expectCodes,
    expectNoViolations,
    first,
    mockCodebase,
    mockFile,
    mockFunction,
    mockType,
} from "./test_utils.ts";
import { TypeLocationLinter } from "./type-location.ts";

const linter = new TypeLocationLinter();

// =============================================================================
// Basic Functionality
// =============================================================================

Deno.test("type-location - no violations for types in types/ directory", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/types/models.ts",
        types: [
          mockType({ name: "User", isExported: true }),
          mockType({ name: "Config", isExported: true }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("type-location - no violations for types in local types/ subdirectory", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/core/types/config.ts",
        types: [
          mockType({ name: "CoreConfig", isExported: true }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("type-location - no violations for types in .types.ts files", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/core/db.types.ts",
        types: [
          mockType({ name: "DatabaseRow", isExported: true }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("type-location - reports non-exported types outside types dir too", () => {
  // The linter doesn't distinguish exported vs non-exported - all types
  // outside types/ directories are flagged
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/core/utils.ts",
        types: [
          mockType({ name: "InternalHelper", isExported: false, file: "packages/core/utils.ts" }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  expectCodes(violations, ["type-outside-types"]);
});

// =============================================================================
// Violation Detection
// =============================================================================

Deno.test("type-location - reports types outside types directories", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/core/utils.ts",
        types: [
          mockType({ name: "UtilType", isExported: true, file: "packages/core/utils.ts" }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  expectCodes(violations, ["type-outside-types"]);
});

Deno.test("type-location - reports multiple types in wrong location", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/server/handler.ts",
        types: [
          mockType({ name: "Request", isExported: true, file: "packages/server/handler.ts", line: 10 }),
          mockType({ name: "Response", isExported: true, file: "packages/server/handler.ts", line: 20 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 2);
  expectCodes(violations, ["type-outside-types", "type-outside-types"]);
});

Deno.test("type-location - reports interface outside types directory", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/api/client.ts",
        types: [
          mockType({ name: "ApiClient", kind: "interface", isExported: true, file: "packages/api/client.ts" }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  assertEquals(first(violations).code, "type-outside-types");
});

// =============================================================================
// Logic in Types Directory Detection
// =============================================================================

Deno.test("type-location - reports functions in types/ directory", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/types/models.ts",
        functions: [
          mockFunction({ name: "createUser", isExported: true, file: "packages/types/models.ts" }),
        ],
        types: [
          mockType({ name: "User", isExported: true }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  expectCodes(violations, ["logic-in-types"]);
});

Deno.test("type-location - no violation for functions in *.guards.ts file", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/types/user.guards.ts",
        functions: [
          mockFunction({ name: "isUser", isExported: true }),
          mockFunction({ name: "isConfig", isExported: true }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("type-location - no violation for functions in *.validators.ts file", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/types/user.validators.ts",
        functions: [
          mockFunction({ name: "assertUser", isExported: true }),
          mockFunction({ name: "assertValid", isExported: true }),
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

Deno.test("type-location - types in test files are still flagged (linter doesnt exclude tests)", () => {
  // Note: This linter doesn't have test file exclusions built in
  // It reports all types outside types/ directories
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/core/utils_test.ts",
        types: [
          mockType({ name: "TestHelper", isExported: true, file: "packages/core/utils_test.ts" }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  // The linter will still flag this - it doesn't have test file exclusions
  assertEquals(violations.length, 1);
});

Deno.test("type-location - types in .types.ts files are allowed", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/core/utils.types.ts",
        types: [
          mockType({ name: "UtilType", isExported: true }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("type-location - types in types.ts files are allowed", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/core/types.ts",
        types: [
          mockType({ name: "CoreType", isExported: true }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

// =============================================================================
// Mixed Scenarios
// =============================================================================

Deno.test("type-location - handles mixed valid and invalid locations", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/types/user.ts",
        types: [
          mockType({ name: "User", isExported: true }),
        ],
      }),
      mockFile({
        path: "packages/core/config.ts",
        types: [
          mockType({ name: "BadConfig", isExported: true, file: "packages/core/config.ts" }),
        ],
      }),
      mockFile({
        path: "packages/core/types/local.ts",
        types: [
          mockType({ name: "LocalType", isExported: true }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  assertEquals(first(violations).message.includes("BadConfig"), true);
});

Deno.test("type-location - empty codebase produces no violations", () => {
  const data = mockCodebase({ files: [] });
  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("type-location - files with no types produce no violations", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/core/utils.ts",
        types: [],
        functions: [
          mockFunction({ name: "helper", isExported: true }),
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

Deno.test("type-location - violation has correct severity", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/core/bad.ts",
        types: [
          mockType({ name: "BadType", isExported: true, file: "packages/core/bad.ts" }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  assertEquals(first(violations).severity, "error");
});

Deno.test("type-location - violation includes suggestion", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/core/bad.ts",
        types: [
          mockType({ name: "BadType", isExported: true, file: "packages/core/bad.ts" }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  assertEquals(typeof first(violations).suggestion, "string");
  assertEquals(first(violations).suggestion!.length > 0, true);
});

Deno.test("type-location - violation has correct linter name", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "packages/core/bad.ts",
        types: [
          mockType({ name: "BadType", isExported: true, file: "packages/core/bad.ts" }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  assertEquals(first(violations).linter, "type-location");
});

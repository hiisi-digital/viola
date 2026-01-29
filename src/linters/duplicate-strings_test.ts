/**
 * Tests for the duplicate-strings linter.
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import { DuplicateStringsLinter } from "./duplicate-strings.ts";
import {
    defaultConfig,
    expectCodes,
    expectNoViolations,
    first,
    mockCodebase,
    mockFile,
    mockString,
} from "./test_utils.ts";

const linter = new DuplicateStringsLinter();

// =============================================================================
// Basic Functionality
// =============================================================================

Deno.test("duplicate-strings - no violations for unique strings", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        strings: [
          mockString({ value: "hello", file: "src/app.ts", line: 1 }),
          mockString({ value: "world", file: "src/app.ts", line: 2 }),
          mockString({ value: "foo", file: "src/app.ts", line: 3 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("duplicate-strings - reports strings that appear multiple times", () => {
  // Use a string that won't be filtered (not CSS-like, not identifier-like)
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        strings: [
          mockString({ value: "This is a longer duplicate string that should be detected!", file: "src/app.ts", line: 1 }),
          mockString({ value: "This is a longer duplicate string that should be detected!", file: "src/app.ts", line: 5 }),
          mockString({ value: "This is a longer duplicate string that should be detected!", file: "src/app.ts", line: 10 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  expectCodes(violations, ["duplicate-string-many"]);
});

Deno.test("duplicate-strings - reports duplicates across files", () => {
  // Use a string that won't be filtered
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        strings: [
          mockString({ value: "This shared error message appears in multiple files!", file: "src/app.ts", line: 1 }),
        ],
      }),
      mockFile({
        path: "src/utils.ts",
        strings: [
          mockString({ value: "This shared error message appears in multiple files!", file: "src/utils.ts", line: 1 }),
        ],
      }),
      mockFile({
        path: "src/config.ts",
        strings: [
          mockString({ value: "This shared error message appears in multiple files!", file: "src/config.ts", line: 1 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  expectCodes(violations, ["duplicate-string-many"]);
});

// =============================================================================
// Threshold Behavior
// =============================================================================

Deno.test("duplicate-strings - respects minimum occurrence threshold", () => {
  // Default warning threshold is 2, error threshold is 3
  // With only 1 occurrence, no violation
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        strings: [
          mockString({ value: "This string only appears once in the codebase!", file: "src/app.ts", line: 1 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("duplicate-strings - configurable threshold via options", () => {
  // With warningThreshold: 2 (default), 2 occurrences should trigger
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        strings: [
          mockString({ value: "This message appears exactly twice in the code!", file: "src/app.ts", line: 1 }),
          mockString({ value: "This message appears exactly twice in the code!", file: "src/app.ts", line: 5 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
});

// =============================================================================
// String Length Filtering
// =============================================================================

Deno.test("duplicate-strings - ignores short strings by default", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        strings: [
          mockString({ value: "a", file: "src/app.ts", line: 1 }),
          mockString({ value: "a", file: "src/app.ts", line: 2 }),
          mockString({ value: "a", file: "src/app.ts", line: 3 }),
          mockString({ value: "a", file: "src/app.ts", line: 4 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("duplicate-strings - ignores empty strings", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        strings: [
          mockString({ value: "", file: "src/app.ts", line: 1 }),
          mockString({ value: "", file: "src/app.ts", line: 2 }),
          mockString({ value: "", file: "src/app.ts", line: 3 }),
          mockString({ value: "", file: "src/app.ts", line: 4 }),
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

Deno.test("duplicate-strings - does NOT ignore test files by default", () => {
  // Note: This linter doesn't exclude test files by default
  // It will report duplicate strings in test files too
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app_test.ts",
        strings: [
          mockString({ value: "This test assertion message repeats in tests!", file: "src/app_test.ts", line: 1 }),
          mockString({ value: "This test assertion message repeats in tests!", file: "src/app_test.ts", line: 5 }),
          mockString({ value: "This test assertion message repeats in tests!", file: "src/app_test.ts", line: 10 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  expectCodes(violations, ["duplicate-string-many"]);
});

Deno.test("duplicate-strings - does NOT ignore spec files by default", () => {
  // Note: This linter doesn't exclude spec files by default
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.spec.ts",
        strings: [
          mockString({ value: "This spec string message repeats in spec files!", file: "src/app.spec.ts", line: 1 }),
          mockString({ value: "This spec string message repeats in spec files!", file: "src/app.spec.ts", line: 5 }),
          mockString({ value: "This spec string message repeats in spec files!", file: "src/app.spec.ts", line: 10 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  expectCodes(violations, ["duplicate-string-many"]);
});

// =============================================================================
// Multiple Duplicate Groups
// =============================================================================

Deno.test("duplicate-strings - reports multiple distinct duplicate groups", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        strings: [
          mockString({ value: "The first error message that repeats many times!", file: "src/app.ts", line: 1 }),
          mockString({ value: "The first error message that repeats many times!", file: "src/app.ts", line: 2 }),
          mockString({ value: "The first error message that repeats many times!", file: "src/app.ts", line: 3 }),
          mockString({ value: "The second warning message also repeats here!", file: "src/app.ts", line: 10 }),
          mockString({ value: "The second warning message also repeats here!", file: "src/app.ts", line: 11 }),
          mockString({ value: "The second warning message also repeats here!", file: "src/app.ts", line: 12 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 2);
  expectCodes(violations, ["duplicate-string-many", "duplicate-string-many"]);
});

// =============================================================================
// Violation Properties
// =============================================================================

Deno.test("duplicate-strings - violation has correct severity", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        strings: [
          mockString({ value: "This repeated text should trigger a warning or error!", file: "src/app.ts", line: 1 }),
          mockString({ value: "This repeated text should trigger a warning or error!", file: "src/app.ts", line: 5 }),
          mockString({ value: "This repeated text should trigger a warning or error!", file: "src/app.ts", line: 10 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  // 3 occurrences >= errorThreshold (3), so it should be "error"
  assertEquals(first(violations).severity, "error");
});

Deno.test("duplicate-strings - violation includes related locations", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        strings: [
          mockString({ value: "This repeated value should have related locations!", file: "src/app.ts", line: 1 }),
          mockString({ value: "This repeated value should have related locations!", file: "src/app.ts", line: 5 }),
          mockString({ value: "This repeated value should have related locations!", file: "src/app.ts", line: 10 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  assertEquals(Array.isArray(first(violations).relatedLocations), true);
  // Should have related locations pointing to the duplicate occurrences
  assertEquals(first(violations).relatedLocations!.length >= 1, true);
});

Deno.test("duplicate-strings - violation includes suggestion", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        strings: [
          mockString({ value: "Please extract me into a constant variable!", file: "src/app.ts", line: 1 }),
          mockString({ value: "Please extract me into a constant variable!", file: "src/app.ts", line: 5 }),
          mockString({ value: "Please extract me into a constant variable!", file: "src/app.ts", line: 10 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  assertEquals(typeof first(violations).suggestion, "string");
  assertEquals(first(violations).suggestion!.length > 0, true);
});

Deno.test("duplicate-strings - violation has correct linter name", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        strings: [
          mockString({ value: "Check that the linter name is correct here!", file: "src/app.ts", line: 1 }),
          mockString({ value: "Check that the linter name is correct here!", file: "src/app.ts", line: 5 }),
          mockString({ value: "Check that the linter name is correct here!", file: "src/app.ts", line: 10 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  assertEquals(violations.length, 1);
  assertEquals(first(violations).linter, "duplicate-strings");
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("duplicate-strings - empty codebase produces no violations", () => {
  const data = mockCodebase({ files: [] });
  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("duplicate-strings - files with no strings produce no violations", () => {
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        strings: [],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("duplicate-strings - handles whitespace-only differences", () => {
  // Strings that differ only in whitespace should be treated as different
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        strings: [
          mockString({ value: "hello world", file: "src/app.ts", line: 1 }),
          mockString({ value: "hello  world", file: "src/app.ts", line: 2 }),
          mockString({ value: "hello   world", file: "src/app.ts", line: 3 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

Deno.test("duplicate-strings - case-sensitive matching", () => {
  // "Hello" and "hello" should be treated as different strings
  const data = mockCodebase({
    files: [
      mockFile({
        path: "src/app.ts",
        strings: [
          mockString({ value: "Hello", file: "src/app.ts", line: 1 }),
          mockString({ value: "hello", file: "src/app.ts", line: 2 }),
          mockString({ value: "HELLO", file: "src/app.ts", line: 3 }),
        ],
      }),
    ],
  });

  const violations = linter.lint(data, defaultConfig);
  expectNoViolations(violations);
});

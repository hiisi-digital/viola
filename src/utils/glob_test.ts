//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * What a glob matches, including the case the placeholder exists for.
 */

import { assertEquals } from "@std/assert";
import { globToRegex, matchesAnyGlob, matchesGlob } from "./glob.ts";

Deno.test("glob - a single star stops at a separator", () => {
  assertEquals(matchesGlob("src/a.ts", "src/*.ts"), true);
  assertEquals(matchesGlob("src/deep/a.ts", "src/*.ts"), false);
});

Deno.test("glob - a double star crosses separators", () => {
  assertEquals(matchesGlob("src/deep/a.ts", "src/**/a.ts"), true);
  assertEquals(matchesGlob("src/a/b/c/a.ts", "src/**/a.ts"), true);
  assertEquals(matchesGlob("x/a.ts", "**/*.ts"), true);
});

Deno.test("glob - a spanning double star crosses zero directories too", () => {
  // `a/**/b` means `a/b` as well as `a/x/y/b` in every other glob. Requiring
  // at least one directory made `src/**/*_test.ts` miss `src/thing_test.ts`,
  // which is where most test files actually sit.
  assertEquals(matchesGlob("src/thing_test.ts", "src/**/*_test.ts"), true);
  assertEquals(matchesGlob("src/a/b/thing_test.ts", "src/**/*_test.ts"), true);
  assertEquals(matchesGlob("src/thing.ts", "src/**/*_test.ts"), false);
  assertEquals(matchesGlob("other/thing_test.ts", "src/**/*_test.ts"), false);
});

Deno.test("glob - the two stars are not two single stars", () => {
  // The placeholder is why. Without it the `*` rule rewrites the first star of
  // a `**` and the second is left over, matching a literal asterisk.
  assertEquals(globToRegex("**").source, "^.*$");
  assertEquals(globToRegex("*").source, "^[^/]*$");
});

Deno.test("glob - regex metacharacters in a pattern are literal", () => {
  assertEquals(matchesGlob("a.ts", "a.ts"), true);
  assertEquals(matchesGlob("axts", "a.ts"), false);
  assertEquals(matchesGlob("a+b.ts", "a+b.ts"), true);
  assertEquals(matchesGlob("aab.ts", "a+b.ts"), false);
});

Deno.test("glob - a question mark is exactly one character", () => {
  assertEquals(matchesGlob("a.ts", "?.ts"), true);
  assertEquals(matchesGlob("ab.ts", "?.ts"), false);
});

Deno.test("glob - bare star is the fast path and still means everything", () => {
  assertEquals(matchesGlob("anything/at/all.ts", "*"), true);
});

Deno.test("glob - any of several, and none of none", () => {
  assertEquals(matchesAnyGlob("a.ts", ["*.js", "*.ts"]), true);
  assertEquals(matchesAnyGlob("a.md", ["*.js", "*.ts"]), false);
  assertEquals(matchesAnyGlob("a.ts", []), false);
});

Deno.test("glob - the cache does not change what a pattern means", () => {
  const first = globToRegex("src/**/*.ts");
  const second = globToRegex("src/**/*.ts");
  assertEquals(first, second);
  assertEquals(first.test("src/a/b.ts"), true);
  assertEquals(first.test("other/a/b.ts"), false);
});

Deno.test("a leading ** spans zero directories as well as many", () => {
  // Every package in this estate excludes its tests with `!**/tests/**` and its
  // own `tests/` sits at the root. This compiled to `^.*/tests/.*$`, which needs
  // a separator before `tests`, so all of those exclusions matched nothing and
  // every config had been silently counting its test files for months.
  assertEquals(matchesGlob("tests/a.test.ts", "**/tests/**"), true);
  assertEquals(matchesGlob("examples/x.ts", "**/examples/**"), true);
  assertEquals(matchesGlob("a.test.ts", "**/*.test.ts"), true);
});

Deno.test("a leading ** still spans directories when there are some", () => {
  // The control. The nested case worked before and has to keep working, or the
  // fix above would have traded one silent miss for another.
  assertEquals(matchesGlob("pkg/tests/a.test.ts", "**/tests/**"), true);
  assertEquals(matchesGlob("a/b/c/x.test.ts", "**/*.test.ts"), true);
});

Deno.test("a leading ** does not match a different directory", () => {
  // The other control: the pattern still has to refuse something, or it would
  // pass by matching everything.
  assertEquals(matchesGlob("src/a.ts", "**/tests/**"), false);
  assertEquals(matchesGlob("testsuite/a.ts", "**/tests/**"), false);
  assertEquals(matchesGlob("a.ts", "**/*.test.ts"), false);
});

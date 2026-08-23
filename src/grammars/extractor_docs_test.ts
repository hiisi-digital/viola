//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Where a function's documentation is, when the function has overloads.
 *
 * TypeScript documents an overloaded function once, above the first signature,
 * and only the implementation carries a body. The extractor sees the
 * implementation, looked immediately above it, found another signature rather
 * than a comment, and reported the function undocumented. Every overloaded
 * function in a codebase read that way however carefully it was written.
 */

import { assertEquals } from "@std/assert";
import typescript from "@hiisi/viola-grammar-ts";
import { createParser, initTreeSitter, loadGrammar } from "./loader.ts";
import { extractFileData } from "./extractor.ts";

async function functionsIn(source: string) {
  await initTreeSitter();
  const language = await loadGrammar(typescript.grammar);
  const parser = createParser(typescript.grammar, language);
  const tree = parser.parse(source);
  return extractFileData(tree, language, typescript, "a.ts", source).functions;
}

Deno.test("extractor - an overloaded function is documented at its first signature", async () => {
  const functions = await functionsIn(
    "/**\n * Documented.\n */\n" +
      "export function m(h: string): string;\n" +
      "export function m(h: number): number;\n" +
      "export function m(h: unknown): unknown {\n  return h;\n}\n",
  );
  assertEquals(functions.length, 1);
  assertEquals(functions[0]?.jsDoc !== undefined, true);
});

Deno.test("extractor - an undocumented overload set is still undocumented", async () => {
  // The control. Stepping back over signatures must not find a comment that
  // belongs to something else, or every function becomes documented.
  const functions = await functionsIn(
    "/**\n * About the constant, not the function.\n */\n" +
      "export const other = 1;\n\n" +
      "export function m(h: string): string;\n" +
      "export function m(h: unknown): unknown {\n  return h;\n}\n",
  );
  const m = functions.find((f) => f.name === "m");
  assertEquals(m?.jsDoc, undefined);
});

Deno.test("extractor - a plain function still finds the comment above it", async () => {
  const functions = await functionsIn(
    "/**\n * Documented.\n */\nexport function m(): void {}\n",
  );
  assertEquals(functions[0]?.jsDoc !== undefined, true);
});

Deno.test("extractor - a lint directive does not hide the doc above it", async () => {
  // A line comment between the documentation and the thing it documents is
  // ordinary. The walk stopped at the first comment of any kind, so one
  // `// deno-lint-ignore` was enough to make a documented function read as
  // undocumented.
  const functions = await functionsIn(
    "/** Documented. */\n" +
      "// deno-lint-ignore no-explicit-any\n" +
      "export function t(x: unknown): void {}\n",
  );
  assertEquals(functions[0]?.jsDoc !== undefined, true);
});

Deno.test("extractor - a line comment alone is not documentation", async () => {
  // The control. Stepping over line comments must not treat one as the doc,
  // or every function with a note above it becomes documented.
  const functions = await functionsIn(
    "// just a note\nexport function t(): void {}\n",
  );
  assertEquals(functions[0]?.jsDoc, undefined);
});

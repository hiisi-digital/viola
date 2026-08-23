//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * What the extractor makes of an export statement.
 *
 * Two laws here cover the same defect from both ends. `orphaned-code` counts a
 * re-export as a use of what it re-exports, and it tests `kind === "re-export"`
 * to find one. No grammar in this estate emits an `@export.kind` capture, so
 * the kind was always "unknown", the branch never ran, and every module tree
 * that re-exports through a `mod.ts` reported its entire public surface as dead
 * code. viola's own run had twenty-three of those.
 */

import { assertEquals } from "@std/assert";
import typescript from "jsr:@hiisi/viola-grammar-ts@^0.3.2";
import { createParser, initTreeSitter, loadGrammar } from "./loader.ts";
import { extractFileData } from "./extractor.ts";

async function extract(source: string) {
  await initTreeSitter();
  const language = await loadGrammar(typescript.grammar);
  const parser = createParser(typescript.grammar, language);
  const tree = parser.parse(source);
  return extractFileData(tree, language, typescript, "a.ts", source);
}

async function exportsOf(source: string) {
  return (await extract(source)).exports;
}

async function importsOf(source: string) {
  return (await extract(source)).imports;
}

Deno.test("extractor - a re-export says it is one", async () => {
  const exports = await exportsOf(`export { thing } from "./other.ts";\n`);
  const found = exports.find((e) => e.name === "thing");
  assertEquals(found?.kind, "re-export");
  assertEquals(found?.from, "./other.ts");
});

Deno.test("extractor - a type-only re-export says it is one too", async () => {
  const exports = await exportsOf(`export type { Thing } from "./other.ts";\n`);
  const found = exports.find((e) => e.name === "Thing");
  assertEquals(found?.kind, "re-export");
  assertEquals(found?.from, "./other.ts");
});

Deno.test("extractor - a plain export is not a re-export", async () => {
  // The control. If everything came back "re-export" the law above would pass
  // while the extractor had simply stopped distinguishing anything.
  const exports = await exportsOf(`export function thing(): void {}\n`);
  const found = exports.find((e) => e.name === "thing");
  assertEquals(found?.kind === "re-export", false);
  assertEquals(found?.from, undefined);
});

Deno.test("extractor - a renamed export is known by the name it exports", async () => {
  // `export { foo as bar }` exports `bar`. The query captures the local name
  // under `name:` and the exported one under `alias:`, so reading only the
  // first named this export `foo`, which no importer can ask for.
  const exports = await exportsOf(`const foo = 1;\nexport { foo as bar };\n`);
  const found = exports.find((e) => e.name === "bar");
  assertEquals(found?.name, "bar");
  assertEquals(found?.localName, "foo");
});

Deno.test("extractor - an unrenamed export carries no local name", async () => {
  const exports = await exportsOf(`const foo = 1;\nexport { foo };\n`);
  const found = exports.find((e) => e.name === "foo");
  assertEquals(found?.localName, undefined);
});

Deno.test("extractor - one export statement is one export", async () => {
  // `export type { T } from "./x"` is a named export, a type-only export and
  // a re-export at once, so three query patterns match it. Each match used to
  // become its own record: three exports named `T` at one line, of which only
  // one knew where it came from.
  const exports = await exportsOf(`export type { T } from "./other.ts";\n`);
  assertEquals(exports.filter((e) => e.name === "T").length, 1);
});

Deno.test("extractor - folding keeps the most specific field from each match", async () => {
  const exports = await exportsOf(`export type { T } from "./other.ts";\n`);
  const found = exports.find((e) => e.name === "T")!;
  assertEquals(found.kind, "re-export", "the match that had a source wins");
  assertEquals(found.isTypeOnly, true, "the match that saw `type` wins");
  assertEquals(found.from, "./other.ts");
});

Deno.test("extractor - two exports on different lines stay two", async () => {
  // The control for the fold. Keyed on name and position, so folding cannot
  // quietly merge distinct exports that happen to share a name.
  const exports = await exportsOf(
    `export { a } from "./x.ts";\nexport { a as b } from "./y.ts";\n`,
  );
  assertEquals(exports.length, 2);
});

Deno.test("extractor - one import specifier is one import", async () => {
  // The same overlap as exports. A type-only named import matches the named
  // pattern, the type-only pattern and the source pattern, so it arrived
  // three times and anything counting imports counted three.
  const imports = await importsOf(
    `import type { IssueCatalog } from "./types.ts";\n`,
  );
  assertEquals(imports.filter((i) => i.name === "IssueCatalog").length, 1);
});

Deno.test("extractor - folding an import keeps that it was type-only", async () => {
  const imports = await importsOf(
    `import type { IssueCatalog } from "./types.ts";\n`,
  );
  const found = imports.find((i) => i.name === "IssueCatalog")!;
  assertEquals(found.isTypeOnly, true);
  assertEquals(found.from, "./types.ts");
});

Deno.test("extractor - two names in one import statement stay two", async () => {
  // The control for the import fold: one statement, two specifiers, two
  // imports. Folding on the statement rather than the specifier would lose one.
  const imports = await importsOf(`import { a, b } from "./x.ts";\n`);
  assertEquals(imports.filter((i) => i.name === "a").length, 1);
  assertEquals(imports.filter((i) => i.name === "b").length, 1);
});

/**
 * Integration tests for grammar-aware extraction in the crawler.
 *
 * Tests that tree-sitter grammars are correctly used for extraction.
 * Grammar registration is required: files without a matching grammar are skipped.
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { GrammarRegistry } from "../grammars/registry.ts";
import type { GrammarDefinition } from "../grammars/types.ts";
import { crawlCodebase } from "./crawler.ts";
import type { ViolaConfig } from "../data/types.ts";

// Import tree-sitter-typescript so Deno caches the npm package (needed for WASM loading)
import "tree-sitter-typescript";

// =============================================================================
// Test Helpers
// =============================================================================

/** Create a minimal TS grammar definition for testing */
function createTestTsGrammar(): GrammarDefinition {
  return {
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
      functions: `
        (function_declaration
          name: (identifier) @function.name
          parameters: (formal_parameters) @function.params
          body: (statement_block) @function.body) @function

        (export_statement
          declaration: (function_declaration
            name: (identifier) @function.name
            parameters: (formal_parameters) @function.params
            body: (statement_block) @function.body)) @function
      `,
      exports: `
        (export_statement
          declaration: [
            (function_declaration
              name: (identifier) @export.name)
            (class_declaration
              name: (type_identifier) @export.name)
            (abstract_class_declaration
              name: (type_identifier) @export.name)
            (lexical_declaration
              (variable_declarator
                name: (identifier) @export.name))
            (variable_declaration
              (variable_declarator
                name: (identifier) @export.name))
            (interface_declaration
              name: (type_identifier) @export.name)
            (type_alias_declaration
              name: (type_identifier) @export.name)
            (enum_declaration
              name: (identifier) @export.name)
          ]) @export
      `,
      imports: `
        (import_statement
          (import_clause
            (identifier) @import.name)
          source: (string) @import.from) @import

        (import_statement
          (import_clause
            (named_imports
              (import_specifier
                name: (identifier) @import.name)))
          source: (string) @import.from) @import
      `,
      strings: `
        (string
          (string_fragment)? @string.value) @string
      `,
      types: `
        (interface_declaration
          name: (type_identifier) @type.name
          type_parameters: (type_parameters)? @type.type_params
          (extends_type_clause)? @type.extends
          body: (interface_body) @type.body) @type

        (type_alias_declaration
          name: (type_identifier) @type.name
          type_parameters: (type_parameters)? @type.type_params
          value: (_) @type.body) @type

        (enum_declaration
          name: (identifier) @type.name
          body: (enum_body) @type.body) @type
      `,
    },
    // No transforms: use default capture-based extraction
  };
}

// Create temp directory with test files for crawling
async function createTestFixture(): Promise<string> {
  const tmpDir = await Deno.makeTempDir({ prefix: "viola-crawler-test-" });
  const srcDir = `${tmpDir}/src`;
  await Deno.mkdir(srcDir);

  // File with export async function: the bug we're fixing
  await Deno.writeTextFile(
    `${srcDir}/async-exports.ts`,
    `
export async function fetchData(url: string): Promise<string> {
  return await fetch(url).then(r => r.text());
}

export async function processItems(items: string[]): Promise<void> {
  for (const item of items) {
    console.log(item);
  }
}

export function syncFunction(): number {
  return 42;
}

export abstract class BaseHandler {
  abstract handle(): void;
}

export const MY_CONST = "hello";
`,
  );

  // File with imports
  await Deno.writeTextFile(
    `${srcDir}/imports.ts`,
    `
import { fetchData } from "./async-exports.ts";
import type { Config } from "./types.ts";

export function main(): void {
  console.log("hello");
}
`,
  );

  return tmpDir;
}

async function cleanupFixture(tmpDir: string): Promise<void> {
  await Deno.remove(tmpDir, { recursive: true });
}

// =============================================================================
// Tests
// =============================================================================

Deno.test("crawler with grammar registry - extracts async function exports correctly", async () => {
  const tmpDir = await createTestFixture();

  try {
    const registry = new GrammarRegistry();
    registry.add(createTestTsGrammar()).as("ts");

    const config: ViolaConfig = {
      projectRoot: tmpDir,
      include: ["src"],
      exclude: [],
      extensions: [".ts"],
      linters: {},
      reportOnly: false,
      verbose: false,
    };

    const data = await crawlCodebase(config, registry);

    // Find the async-exports file
    const asyncFile = data.files.find((f) => f.path.includes("async-exports"));
    assertExists(asyncFile, "Should find async-exports.ts");

    // Check that exports have correct names (not "async" or "abstract")
    const exportNames = asyncFile.exports.map((e) => e.name);
    assertEquals(
      exportNames.includes("async"),
      false,
      "Should not export 'async' as a name",
    );
    assertEquals(
      exportNames.includes("abstract"),
      false,
      "Should not export 'abstract' as a name",
    );
    assertEquals(
      exportNames.includes("fetchData"),
      true,
      "Should export 'fetchData'",
    );
    assertEquals(
      exportNames.includes("processItems"),
      true,
      "Should export 'processItems'",
    );
    assertEquals(
      exportNames.includes("syncFunction"),
      true,
      "Should export 'syncFunction'",
    );
    assertEquals(
      exportNames.includes("BaseHandler"),
      true,
      "Should export 'BaseHandler'",
    );
    assertEquals(
      exportNames.includes("MY_CONST"),
      true,
      "Should export 'MY_CONST'",
    );
  } finally {
    await cleanupFixture(tmpDir);
  }
});

Deno.test("crawler without grammars registered - throws error", async () => {
  const registry = new GrammarRegistry();

  const config: ViolaConfig = {
    projectRoot: "/tmp/nonexistent",
    include: ["src"],
    exclude: [],
    extensions: [".ts"],
    linters: {},
    reportOnly: false,
    verbose: false,
  };

  await assertRejects(
    () => crawlCodebase(config, registry),
    Error,
    "No grammars registered",
  );
});

Deno.test("GrammarRegistry.allExtensions - returns all registered extensions", () => {
  const registry = new GrammarRegistry();

  registry.add({
    meta: { id: "ts", name: "TS", extensions: [".ts", ".tsx"] },
    grammar: { source: "bundled", wasm: "test.wasm" },
    queries: { functions: "" },
  }).as("ts");

  registry.add({
    meta: { id: "bash", name: "Bash", extensions: [".sh", ".bash"] },
    grammar: { source: "bundled", wasm: "test.wasm" },
    queries: { functions: "" },
  }).as("bash");

  const extensions = registry.allExtensions();
  assertEquals(extensions.length, 4);
  assertEquals(extensions.includes(".ts"), true);
  assertEquals(extensions.includes(".tsx"), true);
  assertEquals(extensions.includes(".sh"), true);
  assertEquals(extensions.includes(".bash"), true);
});

Deno.test("crawler with grammar registry - expands extension filter", async () => {
  const tmpDir = await createTestFixture();

  try {
    const registry = new GrammarRegistry();
    registry.add(createTestTsGrammar()).as("ts");

    // Config only has .ts, but grammar also adds .tsx
    const config: ViolaConfig = {
      projectRoot: tmpDir,
      include: ["src"],
      exclude: [],
      extensions: [".ts"], // Only .ts
      linters: {},
      reportOnly: false,
      verbose: false,
    };

    // With grammar, .tsx files would also be scanned
    // (though our fixture only has .ts files)
    const data = await crawlCodebase(config, registry);
    assertEquals(data.files.length > 0, true, "Should find files");
  } finally {
    await cleanupFixture(tmpDir);
  }
});

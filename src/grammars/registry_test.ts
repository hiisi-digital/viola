//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Grammar Registry Tests
 *
 * @module
 */

import { assertEquals, assertExists } from "@std/assert";
import { createGrammarRegistry, GrammarRegistry } from "./registry.ts";
import type { GrammarDefinition } from "./types.ts";

// =============================================================================
// Test Fixtures
// =============================================================================

const mockTypeScriptGrammar: GrammarDefinition = {
  meta: {
    id: "typescript",
    name: "TypeScript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
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
        body: (statement_block) @function.body)
    `,
  },
};

const mockJavaScriptGrammar: GrammarDefinition = {
  meta: {
    id: "javascript",
    name: "JavaScript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
  },
  grammar: {
    source: "npm",
    package: "tree-sitter-javascript",
    wasm: "tree-sitter-javascript.wasm",
  },
  queries: {
    functions: `
      (function_declaration
        name: (identifier) @function.name
        body: (statement_block) @function.body)
    `,
  },
};

const mockBashGrammar: GrammarDefinition = {
  meta: {
    id: "bash",
    name: "Bash",
    extensions: [".sh", ".bash"],
    globs: [".bashrc", ".bash_profile", ".profile"],
  },
  grammar: {
    source: "npm",
    package: "tree-sitter-bash",
    wasm: "tree-sitter-bash.wasm",
  },
  queries: {
    functions: `
      (function_definition
        name: (word) @function.name
        body: (compound_statement) @function.body)
    `,
  },
};

// =============================================================================
// Basic Registration Tests
// =============================================================================

Deno.test("GrammarRegistry - add grammar with default alias", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar);

  const entry = registry.get("typescript");
  assertExists(entry);
  assertEquals(entry.alias, "typescript");
  assertEquals(entry.definition.meta.id, "typescript");
});

Deno.test("GrammarRegistry - add grammar with custom alias", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");

  // Should be accessible by alias
  const entry = registry.get("ts");
  assertExists(entry);
  assertEquals(entry.alias, "ts");
  assertEquals(entry.definition.meta.id, "typescript");

  // Should not be accessible by default id
  const byId = registry.get("typescript");
  assertEquals(byId, undefined);
});

Deno.test("GrammarRegistry - add multiple grammars", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");
  registry.add(mockJavaScriptGrammar).as("js");
  registry.add(mockBashGrammar);

  assertEquals(registry.size, 3);
  assertExists(registry.get("ts"));
  assertExists(registry.get("js"));
  assertExists(registry.get("bash"));
});

Deno.test("GrammarRegistry - has() checks alias existence", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");

  assertEquals(registry.has("ts"), true);
  assertEquals(registry.has("typescript"), false);
  assertEquals(registry.has("nonexistent"), false);
});

Deno.test("GrammarRegistry - all() returns all entries", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");
  registry.add(mockJavaScriptGrammar).as("js");

  const all = registry.all();
  assertEquals(all.length, 2);

  const aliases = all.map((e) => e.alias).sort();
  assertEquals(aliases, ["js", "ts"]);
});

Deno.test("GrammarRegistry - aliases() returns all aliases", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");
  registry.add(mockJavaScriptGrammar);

  const aliases = registry.aliases().slice().sort();
  assertEquals(aliases, ["javascript", "ts"]);
});

Deno.test("GrammarRegistry - clear() removes all grammars", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");
  registry.add(mockJavaScriptGrammar).as("js");

  assertEquals(registry.size, 2);
  registry.clear();
  assertEquals(registry.size, 0);
  assertEquals(registry.get("ts"), undefined);
});

// =============================================================================
// File Matching Tests
// =============================================================================

Deno.test("GrammarRegistry - findMatchingGrammars by extension", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");
  registry.add(mockJavaScriptGrammar).as("js");

  // .ts should match TypeScript only
  const tsMatches = registry.findMatchingGrammars("src/app.ts");
  assertEquals(tsMatches.length, 1);
  assertEquals(tsMatches[0]?.alias, "ts");

  // .tsx should match TypeScript only
  const tsxMatches = registry.findMatchingGrammars("src/Component.tsx");
  assertEquals(tsxMatches.length, 1);
  assertEquals(tsxMatches[0]?.alias, "ts");

  // .js should match JavaScript only
  const jsMatches = registry.findMatchingGrammars("src/utils.js");
  assertEquals(jsMatches.length, 1);
  assertEquals(jsMatches[0]?.alias, "js");
});

Deno.test("GrammarRegistry - findMatchingGrammars by glob pattern", () => {
  const registry = new GrammarRegistry();
  registry.add(mockBashGrammar).as("bash");

  // .bashrc should match via glob
  const bashrcMatches = registry.findMatchingGrammars(".bashrc");
  assertEquals(bashrcMatches.length, 1);
  assertEquals(bashrcMatches[0]?.alias, "bash");

  // .bash_profile should match via glob
  const profileMatches = registry.findMatchingGrammars(".bash_profile");
  assertEquals(profileMatches.length, 1);
  assertEquals(profileMatches[0]?.alias, "bash");

  // .sh should match via extension
  const shMatches = registry.findMatchingGrammars("scripts/deploy.sh");
  assertEquals(shMatches.length, 1);
  assertEquals(shMatches[0]?.alias, "bash");
});

Deno.test("GrammarRegistry - findMatchingGrammars returns empty for unknown extensions", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");
  registry.add(mockJavaScriptGrammar).as("js");

  const matches = registry.findMatchingGrammars("README.md");
  assertEquals(matches.length, 0);
});

Deno.test("GrammarRegistry - findMatchingGrammars can return multiple matches", () => {
  // Create a grammar that matches the same extensions as another
  const tsxSpecialGrammar: GrammarDefinition = {
    meta: {
      id: "tsx-special",
      name: "TSX Special",
      extensions: [".tsx"],
    },
    grammar: {
      source: "bundled",
      wasm: "tree-sitter-tsx.wasm",
    },
    queries: {
      functions: `(function_declaration name: (identifier) @function.name)`,
    },
  };

  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");
  registry.add(tsxSpecialGrammar).as("tsx-special");

  // .tsx should match both grammars
  const matches = registry.findMatchingGrammars("Component.tsx");
  assertEquals(matches.length, 2);

  const aliases = matches.map((m) => m.alias).sort();
  assertEquals(aliases, ["ts", "tsx-special"]);
});

// =============================================================================
// Factory Function Tests
// =============================================================================

Deno.test("createGrammarRegistry - creates a new empty registry", () => {
  const registry = createGrammarRegistry();
  assertEquals(registry.size, 0);
  assertEquals(registry.all().length, 0);
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("GrammarRegistry - handles paths with different separators", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");

  // Unix-style path
  const unixMatches = registry.findMatchingGrammars("src/components/Button.ts");
  assertEquals(unixMatches.length, 1);

  // Windows-style path (though we normalize to /)
  const winMatches = registry.findMatchingGrammars(
    "src\\components\\Button.ts",
  );
  assertEquals(winMatches.length, 1);
});

Deno.test("GrammarRegistry - handles files without extensions", () => {
  const registry = new GrammarRegistry();
  registry.add(mockBashGrammar).as("bash");

  // Files without extension that don't match globs
  const matches = registry.findMatchingGrammars("Makefile");
  assertEquals(matches.length, 0);
});

Deno.test("GrammarRegistry - extension matching is case-sensitive", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");

  // .ts should match
  const tsMatches = registry.findMatchingGrammars("file.ts");
  assertEquals(tsMatches.length, 1);

  // .TS should not match (extensions are case-sensitive)
  const TSMatches = registry.findMatchingGrammars("file.TS");
  assertEquals(TSMatches.length, 0);
});

/**
 * Grammar Resolver Tests
 *
 * @module
 */

import { deepFreeze } from "@hiisi/flash-freeze";
import { assertEquals, assertExists } from "@std/assert";
import type { Condition, EvaluationContext } from "../conditions/types.ts";
import { GrammarRegistry } from "./registry.ts";
import {
  createGrammarResolver,
  type GrammarRelationshipRule,
  GrammarResolver,
  type GrammarRole,
  mergeExtractionResults,
} from "./resolver.ts";
import type { GrammarDefinition } from "./types.ts";

// =============================================================================
// Test Fixtures
// =============================================================================

const mockTypeScriptGrammar: GrammarDefinition = {
  meta: {
    id: "typescript",
    name: "TypeScript",
    extensions: [".ts", ".tsx", ".js", ".jsx"], // Also matches JS for supplement testing
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

const mockJavaScriptGrammar: GrammarDefinition = {
  meta: {
    id: "javascript",
    name: "JavaScript",
    extensions: [".js", ".jsx", ".ts", ".tsx"], // Note: overlaps with TS
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

const mockBashGrammar: GrammarDefinition = {
  meta: {
    id: "bash",
    name: "Bash",
    extensions: [".sh", ".bash"],
  },
  grammar: {
    source: "npm",
    package: "tree-sitter-bash",
    wasm: "tree-sitter-bash.wasm",
  },
  queries: {
    functions: `(function_definition name: (word) @function.name)`,
  },
};

/**
 * Create a mock condition that always returns the specified value.
 */
function mockCondition(result: boolean): Condition {
  return {
    evaluate: () => result,
    and: (other) =>
      mockCondition(result && other.evaluate({} as EvaluationContext)),
    or: (other) =>
      mockCondition(result || other.evaluate({} as EvaluationContext)),
    not: () => mockCondition(!result),
  };
}

/**
 * Create a mock condition that checks file extension.
 */
function extensionCondition(...exts: string[]): Condition {
  return {
    evaluate: (ctx) => {
      if (!ctx.file) return false;
      return exts.some((ext) => ctx.file!.path.endsWith(ext));
    },
    and: function (other) {
      const self = this;
      return {
        evaluate: (ctx: EvaluationContext) =>
          self.evaluate(ctx) && other.evaluate(ctx),
        and: self.and,
        or: self.or,
        not: self.not,
      };
    },
    or: function (other) {
      const self = this;
      return {
        evaluate: (ctx: EvaluationContext) =>
          self.evaluate(ctx) || other.evaluate(ctx),
        and: self.and,
        or: self.or,
        not: self.not,
      };
    },
    not: function () {
      const self = this;
      return {
        evaluate: (ctx: EvaluationContext) => !self.evaluate(ctx),
        and: self.and,
        or: self.or,
        not: self.not,
      };
    },
  };
}

/**
 * Create an evaluation context for a file.
 */
function createContext(filePath: string): EvaluationContext {
  const ext = filePath.includes(".")
    ? filePath.slice(filePath.lastIndexOf("."))
    : "";
  return {
    file: {
      path: filePath,
      extension: ext,
      grammarId: "",
    },
    env: {},
    projectRoot: "/project",
  };
}

// =============================================================================
// Basic Resolution Tests
// =============================================================================

Deno.test("GrammarResolver - resolves single matching grammar", () => {
  const registry = new GrammarRegistry();
  registry.add(mockBashGrammar).as("bash");

  const resolver = new GrammarResolver(registry, []);
  const resolution = resolver.resolve("script.sh", createContext("script.sh"));

  assertEquals(resolution.grammars.length, 1);
  assertEquals(resolution.grammars[0]?.entry.alias, "bash");
  assertEquals(resolution.grammars[0]?.role, "primary");
  assertEquals(resolution.suppressed.length, 0);
});

Deno.test("GrammarResolver - resolves multiple matching grammars as parallel", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");
  registry.add(mockJavaScriptGrammar).as("js");

  const resolver = new GrammarResolver(registry, []);
  const resolution = resolver.resolve("app.ts", createContext("app.ts"));

  // Both should match .ts files
  assertEquals(resolution.grammars.length, 2);

  // Both should be primary (parallel execution)
  const roles = resolution.grammars.map((g) => g.role);
  assertEquals(roles, ["primary", "primary"]);

  assertEquals(resolution.suppressed.length, 0);
});

Deno.test("GrammarResolver - returns empty for no matching grammars", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");

  const resolver = new GrammarResolver(registry, []);
  const resolution = resolver.resolve("README.md", createContext("README.md"));

  assertEquals(resolution.grammars.length, 0);
  assertEquals(resolution.suppressed.length, 0);
});

// =============================================================================
// Override Relationship Tests
// =============================================================================

Deno.test("GrammarResolver - overrides relationship suppresses secondary", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");
  registry.add(mockJavaScriptGrammar).as("js");

  // TypeScript overrides JavaScript for .ts files
  const rules: GrammarRelationshipRule[] = [
    {
      action: deepFreeze({
        type: "grammar-relationship" as const,
        relationship: "overrides" as const,
        primary: "ts",
        secondary: "js",
      }),
      condition: deepFreeze(mockCondition(true)),
    },
  ];

  const resolver = new GrammarResolver(registry, rules);
  const resolution = resolver.resolve("app.ts", createContext("app.ts"));

  // Only TypeScript should run
  assertEquals(resolution.grammars.length, 1);
  assertEquals(resolution.grammars[0]?.entry.alias, "ts");
  assertEquals(resolution.grammars[0]?.role, "overriding");
  assertEquals(resolution.grammars[0]?.overridesGrammar, "js");

  // JavaScript should be suppressed
  assertEquals(resolution.suppressed.length, 1);
  assertEquals(resolution.suppressed[0]?.entry.alias, "js");
  assertEquals(resolution.suppressed[0]?.role, "suppressed");
});

Deno.test("GrammarResolver - overrides only applies when condition matches", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");
  registry.add(mockJavaScriptGrammar).as("js");

  // TypeScript overrides JavaScript only for .tsx files
  const rules: GrammarRelationshipRule[] = [
    {
      action: deepFreeze({
        type: "grammar-relationship" as const,
        relationship: "overrides" as const,
        primary: "ts",
        secondary: "js",
      }),
      condition: deepFreeze(extensionCondition(".tsx")),
    },
  ];

  const resolver = new GrammarResolver(registry, rules);

  // For .ts files, no override applies
  const tsResolution = resolver.resolve("app.ts", createContext("app.ts"));
  assertEquals(tsResolution.grammars.length, 2);
  assertEquals(tsResolution.suppressed.length, 0);

  // For .tsx files, override applies
  const tsxResolution = resolver.resolve("App.tsx", createContext("App.tsx"));
  assertEquals(tsxResolution.grammars.length, 1);
  assertEquals(tsxResolution.grammars[0]?.entry.alias, "ts");
  assertEquals(tsxResolution.suppressed.length, 1);
});

// =============================================================================
// Supplements Relationship Tests
// =============================================================================

Deno.test("GrammarResolver - supplements relationship marks primary as supplement", () => {
  const registry = new GrammarRegistry();
  // Use grammars that both match .js files
  registry.add(mockTypeScriptGrammar).as("ts"); // Now matches .js too
  registry.add(mockJavaScriptGrammar).as("js");

  // TypeScript supplements JavaScript for .js files
  const rules: GrammarRelationshipRule[] = [
    {
      action: deepFreeze({
        type: "grammar-relationship" as const,
        relationship: "supplements" as const,
        primary: "ts",
        secondary: "js",
      }),
      condition: deepFreeze(mockCondition(true)),
    },
  ];

  const resolver = new GrammarResolver(registry, rules);
  const resolution = resolver.resolve("utils.js", createContext("utils.js"));

  // Both should run (both now match .js)
  assertEquals(resolution.grammars.length, 2);
  assertEquals(resolution.suppressed.length, 0);

  // JavaScript should be primary, TypeScript should be supplement
  const jsGrammar = resolution.grammars.find((g) => g.entry.alias === "js");
  const tsGrammar = resolution.grammars.find((g) => g.entry.alias === "ts");

  assertExists(jsGrammar);
  assertExists(tsGrammar);
  assertEquals(jsGrammar.role, "primary");
  assertEquals(tsGrammar.role, "supplement");
  assertEquals(tsGrammar.supplementsGrammar, "js");
});

Deno.test("GrammarResolver - supplements orders primary before supplement", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");
  registry.add(mockJavaScriptGrammar).as("js");

  const rules: GrammarRelationshipRule[] = [
    {
      action: deepFreeze({
        type: "grammar-relationship" as const,
        relationship: "supplements" as const,
        primary: "ts",
        secondary: "js",
      }),
      condition: deepFreeze(mockCondition(true)),
    },
  ];

  const resolver = new GrammarResolver(registry, rules);
  const resolution = resolver.resolve("app.ts", createContext("app.ts"));

  // Primary (js) should come before supplement (ts)
  const roles = resolution.grammars.map((g) => g.role);
  const primaryIndex = roles.indexOf("primary");
  const supplementIndex = roles.indexOf("supplement");

  assertEquals(primaryIndex < supplementIndex, true);
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("GrammarResolver - relationship requires both grammars to match", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");
  registry.add(mockBashGrammar).as("bash"); // Doesn't match .ts

  // TypeScript overrides Bash (but bash doesn't match .ts files)
  const rules: GrammarRelationshipRule[] = [
    {
      action: deepFreeze({
        type: "grammar-relationship" as const,
        relationship: "overrides" as const,
        primary: "ts",
        secondary: "bash",
      }),
      condition: deepFreeze(mockCondition(true)),
    },
  ];

  const resolver = new GrammarResolver(registry, rules);
  const resolution = resolver.resolve("app.ts", createContext("app.ts"));

  // Only TypeScript matches, relationship doesn't apply
  assertEquals(resolution.grammars.length, 1);
  assertEquals(resolution.grammars[0]?.entry.alias, "ts");
  assertEquals(resolution.grammars[0]?.role, "primary"); // Not overriding since bash didn't match
  assertEquals(resolution.suppressed.length, 0);
});

Deno.test("GrammarResolver - hasGrammarFor checks if any grammar matches", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");

  const resolver = new GrammarResolver(registry, []);

  assertEquals(resolver.hasGrammarFor("app.ts"), true);
  assertEquals(resolver.hasGrammarFor("app.tsx"), true);
  assertEquals(resolver.hasGrammarFor("README.md"), false);
});

Deno.test("GrammarResolver - getMatchingGrammars returns entries without relationships", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");
  registry.add(mockJavaScriptGrammar).as("js");

  const rules: GrammarRelationshipRule[] = [
    {
      action: deepFreeze({
        type: "grammar-relationship" as const,
        relationship: "overrides" as const,
        primary: "ts",
        secondary: "js",
      }),
      condition: deepFreeze(mockCondition(true)),
    },
  ];

  const resolver = new GrammarResolver(registry, rules);

  // getMatchingGrammars doesn't apply relationships
  const matches = resolver.getMatchingGrammars("app.ts");
  assertEquals(matches.length, 2);
});

// =============================================================================
// Factory Function Tests
// =============================================================================

Deno.test("createGrammarResolver - creates resolver instance", () => {
  const registry = new GrammarRegistry();
  registry.add(mockTypeScriptGrammar).as("ts");

  const resolver = createGrammarResolver(registry, []);

  // Should work like a regular resolver
  const resolution = resolver.resolve("app.ts", createContext("app.ts"));
  assertEquals(resolution.grammars.length, 1);
});

// =============================================================================
// Merge Utilities Tests
// =============================================================================

interface MockItem {
  name: string;
  location: { line: number; column?: number };
}

Deno.test("mergeExtractionResults - concatenates primary results", () => {
  const results: Array<{ items: readonly MockItem[]; role: GrammarRole }> = [
    {
      items: [
        { name: "func1", location: { line: 1 } },
        { name: "func2", location: { line: 10 } },
      ],
      role: "primary",
    },
    {
      items: [
        { name: "func3", location: { line: 20 } },
      ],
      role: "primary",
    },
  ];

  const merged = mergeExtractionResults(results);
  assertEquals(merged.length, 3);
});

Deno.test("mergeExtractionResults - supplements only fill gaps", () => {
  const results: Array<{ items: readonly MockItem[]; role: GrammarRole }> = [
    {
      items: [
        { name: "func1", location: { line: 1, column: 0 } },
        { name: "func2", location: { line: 10, column: 0 } },
      ],
      role: "primary",
    },
    {
      items: [
        { name: "func1-dup", location: { line: 1, column: 0 } }, // Same location, should be skipped
        { name: "func3", location: { line: 20, column: 0 } }, // New location, should be included
      ],
      role: "supplement",
    },
  ];

  const merged = mergeExtractionResults(results);
  assertEquals(merged.length, 3);

  // func1-dup should not be in the result (same location as func1)
  const names = merged.map((m) => m.name);
  assertEquals(names.includes("func1"), true);
  assertEquals(names.includes("func1-dup"), false);
  assertEquals(names.includes("func2"), true);
  assertEquals(names.includes("func3"), true);
});

Deno.test("mergeExtractionResults - processes in correct order", () => {
  const results: Array<{ items: readonly MockItem[]; role: GrammarRole }> = [
    {
      items: [{ name: "supplement", location: { line: 1 } }],
      role: "supplement",
    },
    {
      items: [{ name: "primary", location: { line: 1 } }],
      role: "primary",
    },
  ];

  // Even though supplement is listed first, primary should be processed first
  const merged = mergeExtractionResults(results);
  assertEquals(merged.length, 1);
  assertEquals(merged[0]?.name, "primary");
});

Deno.test("mergeExtractionResults - overriding takes precedence", () => {
  const results: Array<{ items: readonly MockItem[]; role: GrammarRole }> = [
    {
      items: [{ name: "overriding", location: { line: 1 } }],
      role: "overriding",
    },
    {
      items: [{ name: "primary", location: { line: 1 } }],
      role: "primary",
    },
    {
      items: [{ name: "supplement", location: { line: 1 } }],
      role: "supplement",
    },
  ];

  const merged = mergeExtractionResults(results);
  // Overriding comes first, so it's included
  // Primary is at same location, but still included (only supplements skip)
  // Supplement is at same location, so it's skipped
  assertEquals(merged.length, 2);

  const names = merged.map((m) => m.name);
  assertEquals(names.includes("overriding"), true);
  assertEquals(names.includes("primary"), true);
  assertEquals(names.includes("supplement"), false);
});

Deno.test("mergeExtractionResults - handles empty results", () => {
  const results: Array<{ items: readonly MockItem[]; role: GrammarRole }> = [];
  const merged = mergeExtractionResults(results);
  assertEquals(merged.length, 0);
});

Deno.test("mergeExtractionResults - location key uses column", () => {
  const results: Array<{ items: readonly MockItem[]; role: GrammarRole }> = [
    {
      items: [{ name: "func1", location: { line: 1, column: 0 } }],
      role: "primary",
    },
    {
      items: [
        { name: "func1-different-col", location: { line: 1, column: 5 } }, // Same line, different column
      ],
      role: "supplement",
    },
  ];

  const merged = mergeExtractionResults(results);
  // Different columns mean different locations, both should be included
  assertEquals(merged.length, 2);
});

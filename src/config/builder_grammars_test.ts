/**
 * ViolaBuilder Grammar Support Tests
 *
 * Tests for the grammar registration and rule features of ViolaBuilder.
 *
 * @module
 */

import { assertEquals, assertExists } from "@std/assert";
import type { CodebaseData, Issue, LinterConfig } from "../data/types.ts";
import { GrammarRegistry } from "../grammars/registry.ts";
import type { GrammarDefinition } from "../grammars/types.ts";
import { BaseLinter } from "../linters/base.ts";
import { report } from "./actions.ts";
import { viola } from "./builder.ts";
import { when } from "../conditions/when.ts";
import { grammar } from "./grammar-ref.ts";

// =============================================================================
// Test Fixtures
// =============================================================================

const mockTypeScriptGrammar: GrammarDefinition = {
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
    functions: `(function_declaration name: (identifier) @function.name)`,
  },
};

const mockJavaScriptGrammar: GrammarDefinition = {
  meta: {
    id: "javascript",
    name: "JavaScript",
    extensions: [".js", ".jsx"],
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

// =============================================================================
// Basic Grammar Registration Tests
// =============================================================================

Deno.test("ViolaBuilder - add grammar with default alias", () => {
  const builder = viola()
    .add(mockTypeScriptGrammar);

  const config = builder.build();
  assertExists(config.grammarRegistry);
  assertEquals(config.grammarRegistry.has("typescript"), true);
});

Deno.test("ViolaBuilder - add grammar with custom alias", () => {
  const builder = viola()
    .add(mockTypeScriptGrammar).as("ts");

  const config = builder.build();
  assertEquals(config.grammarRegistry.has("ts"), true);
  assertEquals(config.grammarRegistry.has("typescript"), false);
});

Deno.test("ViolaBuilder - add multiple grammars", () => {
  const builder = viola()
    .add(mockTypeScriptGrammar).as("ts")
    .add(mockJavaScriptGrammar).as("js")
    .add(mockBashGrammar);

  const config = builder.build();
  assertEquals(config.grammarRegistry.size, 3);
  assertEquals(config.grammarRegistry.has("ts"), true);
  assertEquals(config.grammarRegistry.has("js"), true);
  assertEquals(config.grammarRegistry.has("bash"), true);
});

Deno.test("ViolaBuilder - grammars property provides access to registry", () => {
  const builder = viola()
    .add(mockTypeScriptGrammar).as("ts");

  const grammars = builder.grammars;
  assertExists(grammars);
  assertEquals(grammars instanceof GrammarRegistry, true);
  assertEquals(grammars.has("ts"), true);
});

// =============================================================================
// Grammar Relationship Rule Tests
// =============================================================================

Deno.test("ViolaBuilder - add grammar overrides rule", () => {
  const builder = viola()
    .add(mockTypeScriptGrammar).as("ts")
    .add(mockJavaScriptGrammar).as("js")
    .rule(grammar("ts").overrides("js"), when.in("*.ts", "*.tsx"));

  const config = builder.build();
  assertEquals(config.grammarRules.length, 1);
  assertEquals(config.grammarRules[0]?.action.relationship, "overrides");
  assertEquals(config.grammarRules[0]?.action.primary, "ts");
  assertEquals(config.grammarRules[0]?.action.secondary, "js");
});

Deno.test("ViolaBuilder - add grammar supplements rule", () => {
  const builder = viola()
    .add(mockTypeScriptGrammar).as("ts")
    .add(mockJavaScriptGrammar).as("js")
    .rule(grammar("ts").supplements("js"), when.in("*.js"));

  const config = builder.build();
  assertEquals(config.grammarRules.length, 1);
  assertEquals(config.grammarRules[0]?.action.relationship, "supplements");
  assertEquals(config.grammarRules[0]?.action.primary, "ts");
  assertEquals(config.grammarRules[0]?.action.secondary, "js");
});

Deno.test("ViolaBuilder - grammar rules separate from report rules", () => {
  const builder = viola()
    .add(mockTypeScriptGrammar).as("ts")
    .add(mockJavaScriptGrammar).as("js")
    .rule(report.error, when.in("src/**"))
    .rule(grammar("ts").overrides("js"), when.in("*.ts"))
    .rule(report.warn, when.in("test/**"));

  const config = builder.build();

  // Report rules
  assertEquals(config.rules.length, 2);
  assertEquals(config.rules[0]?.action.type, "report");
  assertEquals(config.rules[1]?.action.type, "report");

  // Grammar rules
  assertEquals(config.grammarRules.length, 1);
  assertEquals(config.grammarRules[0]?.action.type, "grammar-relationship");
});

// =============================================================================
// Test Linter Class
// =============================================================================

class TestLinter extends BaseLinter {
  readonly meta = {
    id: "test-linter",
    name: "Test Linter",
    description: "A test linter for testing",
  };

  readonly catalog = {};

  readonly requirements = {};

  lint(_data: CodebaseData, _config: LinterConfig): Issue[] {
    return [];
  }
}

// =============================================================================
// Mixed Linter and Grammar Registration Tests
// =============================================================================

Deno.test("ViolaBuilder - add both linters and grammars", () => {
  // Create a proper mock linter instance
  const mockLinter = new TestLinter();

  const builder = viola()
    .add(mockLinter)
    .add(mockTypeScriptGrammar).as("ts");

  const config = builder.build();

  // Both should be registered
  assertEquals(config.linters.length, 1);
  assertEquals(config.linters[0]?.meta.id, "test-linter");
  assertEquals(config.grammarRegistry.size, 1);
  assertEquals(config.grammarRegistry.has("ts"), true);
});

// =============================================================================
// Chaining Tests
// =============================================================================

Deno.test("ViolaBuilder - fluent chaining with grammars", () => {
  const config = viola()
    .add(mockTypeScriptGrammar).as("ts")
    .add(mockJavaScriptGrammar).as("js")
    .add(mockBashGrammar).as("bash")
    .rule(grammar("ts").overrides("js"), when.in("*.ts"))
    .rule(grammar("ts").supplements("js"), when.in("*.js"))
    .rule(report.error, when.in("src/**"))
    .set("some-linter.option", true)
    .build();

  // Verify all parts
  assertEquals(config.grammarRegistry.size, 3);
  assertEquals(config.grammarRules.length, 2);
  assertEquals(config.rules.length, 1);
  assertEquals(config.settings.length, 1);
});

Deno.test("ViolaBuilder - chaining after .as() returns builder", () => {
  // Verify that .as() returns the builder for continued chaining
  const builder = viola()
    .add(mockTypeScriptGrammar).as("ts")
    .add(mockJavaScriptGrammar).as("js");

  // Should be able to continue chaining
  const config = builder
    .rule(grammar("ts").overrides("js"), when.in("*.ts"))
    .build();

  assertEquals(config.grammarRules.length, 1);
});

// =============================================================================
// Complex Configuration Tests
// =============================================================================

Deno.test("ViolaBuilder - real-world configuration pattern", () => {
  const config = viola()
    // Register grammars
    .add(mockTypeScriptGrammar).as("ts")
    .add(mockJavaScriptGrammar).as("js")
    .add(mockBashGrammar).as("bash")
    // TypeScript overrides JavaScript for .ts/.tsx files
    .rule(grammar("ts").overrides("js"), when.in("*.ts", "*.tsx"))
    // TypeScript supplements JavaScript for .js files (JSDoc support)
    .rule(grammar("ts").supplements("js"), when.in("*.js", "*.jsx"))
    // Report rules
    .rule(report.error, when.in("src/**"))
    .rule(report.off, when.in("**/*_test.ts"))
    // Settings
    .set("similar-functions.threshold", 0.85)
    .build();

  // Verify grammars
  assertEquals(config.grammarRegistry.size, 3);
  assertEquals(config.grammarRegistry.has("ts"), true);
  assertEquals(config.grammarRegistry.has("js"), true);
  assertEquals(config.grammarRegistry.has("bash"), true);

  // Verify grammar rules
  assertEquals(config.grammarRules.length, 2);
  assertEquals(config.grammarRules[0]?.action.relationship, "overrides");
  assertEquals(config.grammarRules[1]?.action.relationship, "supplements");

  // Verify report rules
  assertEquals(config.rules.length, 2);

  // Verify settings
  assertEquals(config.settings.length, 1);
  assertEquals(config.settings[0]?.linter, "similar-functions");
  assertEquals(config.settings[0]?.key, "threshold");
  assertEquals(config.settings[0]?.value, 0.85);
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("ViolaBuilder - empty config has empty grammar registry", () => {
  const config = viola().build();

  assertExists(config.grammarRegistry);
  assertEquals(config.grammarRegistry.size, 0);
  assertEquals(config.grammarRules.length, 0);
});

Deno.test("ViolaBuilder - grammar rule without registering grammars", () => {
  // This is valid syntax, though semantically the rule won't match anything
  const config = viola()
    .rule(grammar("ts").overrides("js"), when.in("*.ts"))
    .build();

  assertEquals(config.grammarRules.length, 1);
  assertEquals(config.grammarRegistry.size, 0);
});

Deno.test("ViolaBuilder - multiple overrides rules for same pair", () => {
  const config = viola()
    .add(mockTypeScriptGrammar).as("ts")
    .add(mockJavaScriptGrammar).as("js")
    .rule(grammar("ts").overrides("js"), when.in("*.ts"))
    .rule(grammar("ts").overrides("js"), when.in("*.tsx"))
    .build();

  // Both rules should be stored (last-wins at evaluation time)
  assertEquals(config.grammarRules.length, 2);
});

// =============================================================================
// Factory Function Tests
// =============================================================================

Deno.test("viola() - creates new builder instance", () => {
  const builder1 = viola();
  const builder2 = viola();

  // Should be different instances
  builder1.add(mockTypeScriptGrammar).as("ts");

  assertEquals(builder1.grammars.has("ts"), true);
  assertEquals(builder2.grammars.has("ts"), false);
});

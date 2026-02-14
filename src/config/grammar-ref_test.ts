/**
 * Grammar Reference Tests
 *
 * Tests for the `grammar()` helper function that creates grammar relationship actions.
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import { grammar, isGrammarRelationship } from "./grammar-ref.ts";

// =============================================================================
// Basic Grammar Reference Tests
// =============================================================================

Deno.test("grammar() - creates overrides relationship action", () => {
  const action = grammar("ts").overrides("js");

  assertEquals(action.type, "grammar-relationship");
  assertEquals(action.relationship, "overrides");
  assertEquals(action.primary, "ts");
  assertEquals(action.secondary, "js");
});

Deno.test("grammar() - creates supplements relationship action", () => {
  const action = grammar("ts").supplements("js");

  assertEquals(action.type, "grammar-relationship");
  assertEquals(action.relationship, "supplements");
  assertEquals(action.primary, "ts");
  assertEquals(action.secondary, "js");
});

Deno.test("grammar() - actions are frozen", () => {
  const action = grammar("ts").overrides("js");

  // Attempting to modify should fail silently in non-strict mode
  // or throw in strict mode. We just verify it's frozen.
  assertEquals(Object.isFrozen(action), true);
});

// =============================================================================
// Type Guard Tests
// =============================================================================

Deno.test("isGrammarRelationship - returns true for valid action", () => {
  const action = grammar("ts").overrides("js");
  assertEquals(isGrammarRelationship(action), true);
});

Deno.test("isGrammarRelationship - returns false for report action", () => {
  const reportAction = { type: "report", level: 0 };
  assertEquals(isGrammarRelationship(reportAction), false);
});

Deno.test("isGrammarRelationship - returns false for null", () => {
  assertEquals(isGrammarRelationship(null), false);
});

Deno.test("isGrammarRelationship - returns false for undefined", () => {
  assertEquals(isGrammarRelationship(undefined), false);
});

Deno.test("isGrammarRelationship - returns false for string", () => {
  assertEquals(isGrammarRelationship("grammar-relationship"), false);
});

Deno.test("isGrammarRelationship - returns false for object without type", () => {
  assertEquals(isGrammarRelationship({ relationship: "overrides" }), false);
});

Deno.test("isGrammarRelationship - returns false for object with wrong type", () => {
  assertEquals(
    isGrammarRelationship({ type: "other", relationship: "overrides" }),
    false
  );
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("grammar() - handles empty alias strings", () => {
  const action = grammar("").overrides("");

  assertEquals(action.type, "grammar-relationship");
  assertEquals(action.primary, "");
  assertEquals(action.secondary, "");
});

Deno.test("grammar() - handles special characters in aliases", () => {
  const action = grammar("my-grammar_v2").overrides("legacy.grammar");

  assertEquals(action.primary, "my-grammar_v2");
  assertEquals(action.secondary, "legacy.grammar");
});

Deno.test("grammar() - can create multiple actions from same builder", () => {
  const builder = grammar("ts");
  const overridesAction = builder.overrides("js");
  const supplementsAction = builder.supplements("bash");

  // Both should be independent
  assertEquals(overridesAction.relationship, "overrides");
  assertEquals(overridesAction.secondary, "js");

  assertEquals(supplementsAction.relationship, "supplements");
  assertEquals(supplementsAction.secondary, "bash");
});


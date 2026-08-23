/**
 * Grammar Reference Helpers
 *
 * Provides a fluent API for defining grammar relationships in rules.
 * Used with `.rule()` to specify how grammars interact with each other.
 *
 * @example
 * ```ts
 * import { viola, grammar, when } from "@hiisi/viola";
 * import ts from "@hiisi/viola-grammar-ts";
 * import js from "@hiisi/viola-grammar-js";
 *
 * viola()
 *   .add(ts).as("ts")
 *   .add(js).as("js")
 *   // TypeScript overrides JavaScript for .ts files (only TS runs)
 *   .rule(grammar("ts").overrides("js"), when.in("*.ts", "*.tsx"))
 *   // TypeScript supplements JavaScript for .js files (JS runs, TS fills gaps)
 *   .rule(grammar("ts").supplements("js"), when.in("*.js", "*.jsx"));
 * ```
 *
 * @module
 */

import { deepFreeze, type Frozen } from "@hiisi/flash-freeze";
import type { GrammarRelationshipAction } from "./types/actions.types.ts";

// =============================================================================
// Types
// =============================================================================

/**
 * Builder for grammar relationship actions.
 * Created by the `grammar()` helper function.
 */
export interface GrammarRelationshipBuilder {
  /**
   * Create an "overrides" relationship.
   *
   * When this relationship applies, the primary grammar completely replaces
   * the secondary grammar for matching files. Only the primary grammar runs.
   *
   * @param secondary - The grammar alias being overridden
   * @returns A frozen GrammarRelationshipAction
   *
   * @example
   * // TypeScript completely replaces JavaScript for .ts files
   * grammar("ts").overrides("js")
   */
  overrides(secondary: string): Frozen<GrammarRelationshipAction>;

  /**
   * Create a "supplements" relationship.
   *
   * When this relationship applies, the primary grammar runs first, and the
   * secondary grammar runs after to fill in any gaps (elements the primary
   * didn't capture).
   *
   * @param secondary - The grammar alias being supplemented
   * @returns A frozen GrammarRelationshipAction
   *
   * @example
   * // TypeScript supplements JavaScript for .js files with JSDoc types
   * grammar("ts").supplements("js")
   */
  supplements(secondary: string): Frozen<GrammarRelationshipAction>;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a grammar relationship builder for the given grammar alias.
 *
 * Use this to define how grammars interact in rules. The resulting action
 * can be passed to `.rule()` along with a condition.
 *
 * @param primaryAlias - The alias of the grammar initiating the relationship
 * @returns A builder for creating relationship actions
 *
 * @example
 * ```ts
 * // In your viola config:
 * viola()
 *   .add(typescript).as("ts")
 *   .add(javascript).as("js")
 *   .rule(grammar("ts").overrides("js"), when.in("*.ts"))
 *   .rule(grammar("ts").supplements("js"), when.in("*.js"));
 * ```
 */
export function grammar(primaryAlias: string): GrammarRelationshipBuilder {
  return {
    overrides(secondary: string): Frozen<GrammarRelationshipAction> {
      return deepFreeze({
        type: "grammar-relationship" as const,
        relationship: "overrides" as const,
        primary: primaryAlias,
        secondary,
      });
    },

    supplements(secondary: string): Frozen<GrammarRelationshipAction> {
      return deepFreeze({
        type: "grammar-relationship" as const,
        relationship: "supplements" as const,
        primary: primaryAlias,
        secondary,
      });
    },
  };
}

// =============================================================================
// Type Guard
// =============================================================================

/**
 * Type guard to check if an action is a grammar relationship action.
 */
export function isGrammarRelationship(
  action: unknown,
): action is GrammarRelationshipAction {
  return (
    typeof action === "object" &&
    action !== null &&
    "type" in action &&
    (action as { type: string }).type === "grammar-relationship"
  );
}

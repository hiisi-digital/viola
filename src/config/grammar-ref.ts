//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

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
  /** The half of both relationships that is not the relationship. */
  const relate = (
    relationship: GrammarRelationshipAction["relationship"],
    secondary: string,
  ): Frozen<GrammarRelationshipAction> =>
    deepFreeze({
      type: "grammar-relationship" as const,
      relationship,
      primary: primaryAlias,
      secondary,
    });

  return {
    /**
     * The primary wins and the secondary is dropped for that file.
     *
     * Use it where two grammars both match and one of them is simply the
     * better answer, so the other has nothing left to say.
     */
    overrides: (secondary) => relate("overrides", secondary),

    /**
     * The secondary runs first and the primary fills whatever it left out.
     *
     * Both are kept, so this is the one to reach for when the grammars
     * disagree about coverage rather than about correctness.
     */
    supplements: (secondary) => relate("supplements", secondary),
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

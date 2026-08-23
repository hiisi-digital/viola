/**
 * Grammar Resolver
 *
 * Resolves which grammars should run for a given file and in what order,
 * taking into account grammar relationships (overrides/supplements) defined
 * in the configuration.
 *
 * ## Resolution Semantics
 *
 * By default, all matching grammars run in parallel and their results are merged.
 * Relationships modify this behavior:
 *
 * - **overrides**: The primary grammar completely replaces the secondary.
 *   Only the primary runs when this relationship applies.
 *
 * - **supplements**: The primary grammar runs first, then the secondary
 *   fills in any gaps (elements the primary didn't capture).
 *
 * @module
 */

import type { Frozen } from "@hiisi/flash-freeze";
import { evaluateCondition } from "../conditions/evaluate.ts";
import type { Condition, EvaluationContext } from "../conditions/types.ts";
import type { GrammarRelationshipAction } from "../config/types/actions.types.ts";
import type { GrammarEntry, GrammarRegistry } from "./registry.ts";

// =============================================================================
// Types
// =============================================================================

/**
 * The role a grammar plays in the resolution.
 */
export type GrammarRole =
  | "primary" // Normal execution
  | "overriding" // This grammar overrides another
  | "supplement" // This grammar supplements another (fills gaps)
  | "suppressed"; // This grammar is suppressed by an override

/**
 * A grammar with its resolved role for a specific file.
 */
export interface ResolvedGrammar {
  /** The grammar entry */
  readonly entry: GrammarEntry;
  /** The role this grammar plays */
  readonly role: GrammarRole;
  /** If supplementing, the grammar being supplemented */
  readonly supplementsGrammar?: string;
  /** If overriding, the grammar being overridden */
  readonly overridesGrammar?: string;
}

/**
 * Result of grammar resolution for a file.
 */
export interface GrammarResolution {
  /** The file path that was resolved */
  readonly filePath: string;
  /**
   * Grammars to execute, in order.
   * - Overriding grammars come first
   * - Primary grammars next
   * - Supplementing grammars last (to fill gaps)
   */
  readonly grammars: readonly ResolvedGrammar[];
  /**
   * Grammars that were suppressed by overrides.
   * These won't run but are tracked for debugging.
   */
  readonly suppressed: readonly ResolvedGrammar[];
}

/**
 * A grammar relationship rule (action + condition).
 */
export interface GrammarRelationshipRule {
  readonly action: Frozen<GrammarRelationshipAction>;
  readonly condition: Frozen<Condition>;
}

// =============================================================================
// Resolver
// =============================================================================

/**
 * Resolves grammars for files based on matching and relationships.
 *
 * The resolver:
 * 1. Finds all grammars matching the file (by extension/glob)
 * 2. Evaluates relationship rules against the context
 * 3. Applies overrides (suppressing secondary grammars)
 * 4. Orders supplements appropriately
 *
 * @example
 * ```ts
 * const resolver = new GrammarResolver(registry, relationshipRules);
 *
 * const resolution = resolver.resolve("src/app.ts", {
 *   file: { path: "src/app.ts", extension: ".ts", grammarId: "" },
 *   env: Deno.env.toObject(),
 *   projectRoot: "/project",
 * });
 *
 * for (const { entry, role } of resolution.grammars) {
 *   console.log(`Run ${entry.alias} as ${role}`);
 * }
 * ```
 */
export class GrammarResolver {
  constructor(
    private readonly registry: GrammarRegistry,
    private readonly rules: readonly GrammarRelationshipRule[],
  ) {}

  /**
   * Resolve which grammars should run for a file.
   *
   * @param filePath - The file path to resolve grammars for
   * @param context - The evaluation context for conditions
   * @returns Resolution result with ordered grammars and suppressed list
   */
  resolve(filePath: string, context: EvaluationContext): GrammarResolution {
    // Step 1: Find all matching grammars
    const matchingEntries = this.registry.findMatchingGrammars(filePath);

    if (matchingEntries.length === 0) {
      return { filePath, grammars: [], suppressed: [] };
    }

    // Step 2: Evaluate relationship rules
    const activeRelationships = this.evaluateRelationships(context);

    // Step 3: Build resolution with roles
    const resolved = new Map<string, ResolvedGrammar>();
    const suppressed: ResolvedGrammar[] = [];

    // Initialize all matching grammars as primary
    for (const entry of matchingEntries) {
      resolved.set(entry.alias, {
        entry,
        role: "primary",
      });
    }

    // Apply relationships
    for (const rel of activeRelationships) {
      const primaryAlias = rel.primary;
      const secondaryAlias = rel.secondary;

      // Both grammars must be in matching set for relationship to apply
      const primaryEntry = resolved.get(primaryAlias);
      const secondaryEntry = resolved.get(secondaryAlias);

      if (!primaryEntry || !secondaryEntry) {
        continue;
      }

      if (rel.relationship === "overrides") {
        // Primary overrides secondary: secondary gets suppressed
        resolved.set(primaryAlias, {
          ...primaryEntry,
          role: "overriding",
          overridesGrammar: secondaryAlias,
        });

        // Move secondary to suppressed
        resolved.delete(secondaryAlias);
        suppressed.push({
          ...secondaryEntry,
          role: "suppressed",
        });
      } else if (rel.relationship === "supplements") {
        // Primary supplements secondary: secondary runs first, primary fills gaps
        // Keep secondary as primary, mark primary as supplement
        resolved.set(primaryAlias, {
          ...primaryEntry,
          role: "supplement",
          supplementsGrammar: secondaryAlias,
        });
      }
    }

    // Step 4: Order grammars by role
    const grammars = this.orderByRole(Array.from(resolved.values()));

    return {
      filePath,
      grammars,
      suppressed,
    };
  }

  /**
   * Check if any grammar is registered for a file.
   *
   * @param filePath - The file path to check
   */
  hasGrammarFor(filePath: string): boolean {
    return this.registry.findMatchingGrammars(filePath).length > 0;
  }

  /**
   * Get all grammars that match a file (without applying relationships).
   *
   * @param filePath - The file path to match
   */
  getMatchingGrammars(filePath: string): readonly GrammarEntry[] {
    return this.registry.findMatchingGrammars(filePath);
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Evaluate all relationship rules against the context.
   * Returns the relationships that are active (condition passes).
   */
  private evaluateRelationships(
    context: EvaluationContext,
  ): GrammarRelationshipAction[] {
    const active: GrammarRelationshipAction[] = [];

    for (const rule of this.rules) {
      // A condition is data now, so reading one is the evaluator's job rather
      // than the condition's. That is what lets a rule written by `when` in a
      // config reach here at all: it used to be built as one kind of object
      // and read as another, which is why this whole path never ran.
      if (evaluateCondition(rule.condition as Condition, context)) {
        active.push(rule.action);
      }
    }

    return active;
  }

  /**
   * Order resolved grammars by role.
   * Order: overriding > primary > supplement
   */
  private orderByRole(grammars: ResolvedGrammar[]): ResolvedGrammar[] {
    const roleOrder: Record<GrammarRole, number> = {
      overriding: 0,
      primary: 1,
      supplement: 2,
      suppressed: 3, // Should not appear in active list
    };

    return grammars.sort((a, b) => {
      return roleOrder[a.role] - roleOrder[b.role];
    });
  }
}

/**
 * Create a grammar resolver.
 *
 * @param registry - The grammar registry
 * @param rules - Grammar relationship rules from configuration
 * @returns A new resolver
 */
export function createGrammarResolver(
  registry: GrammarRegistry,
  rules: readonly GrammarRelationshipRule[],
): GrammarResolver {
  return new GrammarResolver(registry, rules);
}

// =============================================================================
// Merge Utilities
// =============================================================================

/**
 * Merge extraction results from multiple grammars.
 *
 * This handles the "supplements" semantic: the supplementing grammar's
 * results are only included if the primary grammar didn't capture them.
 *
 * For normal/overriding roles, results are simply concatenated.
 * For supplement roles, we check for duplicates based on location.
 *
 * @param results - Array of extraction results with their grammar roles
 * @returns Merged results
 */
export function mergeExtractionResults<
  T extends { location: { line: number; column?: number } },
>(
  results: Array<{ items: readonly T[]; role: GrammarRole }>,
): T[] {
  const merged: T[] = [];
  const seenLocations = new Set<string>();

  /**
   * What makes two extracted items the same item.
   *
   * Line and column only. The name is deliberately not in the key, since the
   * whole point of merging is that two grammars may name one thing
   * differently and the position is what says they mean it.
   */
  const locationKey = (item: T): string => {
    const loc = item.location;
    return `${loc.line}:${loc.column ?? 0}`;
  };

  // Process in order: overriding/primary first, supplements last
  const sortedResults = [...results].sort((a, b) => {
    const order: Record<GrammarRole, number> = {
      overriding: 0,
      primary: 1,
      supplement: 2,
      suppressed: 3,
    };
    return order[a.role] - order[b.role];
  });

  for (const { items, role } of sortedResults) {
    for (const item of items) {
      const key = locationKey(item);

      if (role === "supplement") {
        // Only add if not already captured
        if (!seenLocations.has(key)) {
          merged.push(item);
          seenLocations.add(key);
        }
      } else {
        // Always add for primary/overriding
        merged.push(item);
        seenLocations.add(key);
      }
    }
  }

  return merged;
}

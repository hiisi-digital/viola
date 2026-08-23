/**
 * Action types for viola configuration.
 *
 * Actions define what to do when a rule condition matches.
 *
 * @module
 */

import type { ReportLevel } from "../../conditions/vocabulary.ts";

// =============================================================================
// Action Types
// =============================================================================

/**
 * Base interface for all rule actions.
 */
export interface RuleAction {
  readonly type: string;
}

/**
 * Report action - classify issues to a report level.
 */
export interface ReportAction extends RuleAction {
  readonly type: "report";
  readonly level: ReportLevel;
}

/**
 * Grammar relationship action - defines how grammars interact.
 *
 * Used to specify override/supplement relationships between grammars.
 */
export interface GrammarRelationshipAction extends RuleAction {
  readonly type: "grammar-relationship";
  /**
   * The relationship type:
   * - "overrides": primary grammar replaces secondary for matching files
   * - "supplements": primary runs, secondary fills gaps where primary didn't capture
   */
  readonly relationship: "overrides" | "supplements";
  /** The primary grammar alias (the one doing the overriding/supplementing) */
  readonly primary: string;
  /** The secondary grammar alias (the one being overridden/supplemented) */
  readonly secondary: string;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for report actions.
 */
export function isReportAction(action: RuleAction): action is ReportAction {
  return action.type === "report";
}

/**
 * Type guard for grammar relationship actions.
 */
export function isGrammarRelationshipAction(
  action: RuleAction,
): action is GrammarRelationshipAction {
  return action.type === "grammar-relationship";
}

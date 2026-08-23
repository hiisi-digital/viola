/**
 * Evaluator types for viola configuration.
 *
 * Types for rule evaluation context and results.
 *
 * @module
 */

import type { Issue } from "../../data/types.ts";
import type { ReportLevel } from "../../conditions/vocabulary.ts";

// =============================================================================
// Evaluation Types
// =============================================================================

/**
 * What a run knows that an issue does not.
 *
 * A condition may ask about an environment variable or a path relative to the
 * project, and neither is on an `Issue`. Passed in rather than read here, so
 * evaluating a rule stays a pure function of what it was given.
 */
export interface RunContext {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly projectRoot: string;
}

/**
 * Result of evaluating an issue against rules.
 */
export interface EvaluatedIssue {
  /** Original issue */
  readonly issue: Issue;
  /** Determined report level */
  readonly level: ReportLevel;
  /** Which rule matched (index in rules array), or -1 for default */
  readonly matchedRule: number;
}

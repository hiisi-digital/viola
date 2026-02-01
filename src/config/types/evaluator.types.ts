/**
 * Evaluator types for viola configuration.
 *
 * Types for rule evaluation context and results.
 *
 * @module
 */

import type { Issue } from "../../data/types.ts";
import type { ReportLevel } from "../enums.ts";
import type { IssueDef } from "../types.ts";

// =============================================================================
// Evaluation Types
// =============================================================================

/**
 * Context for evaluating conditions against an issue.
 */
export interface EvaluationContext {
  /** The issue being evaluated */
  readonly issue: Issue;
  /** Issue definition from catalog (if found) */
  readonly issueDef?: IssueDef;
  /** Linter ID (extracted from issue.kind) */
  readonly linterId: string;
  /** Issue name (extracted from issue.kind) */
  readonly issueName: string;
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

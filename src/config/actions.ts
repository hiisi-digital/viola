/**
 * Rule actions for viola configuration.
 *
 * Actions define what to do when a condition matches.
 *
 * @module
 */

import { deepFreeze, type Frozen } from "@hiisi/flash-freeze";
import { ReportLevel } from "./enums.ts";

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
 * Create a report action.
 */
function createReportAction(level: ReportLevel): Frozen<ReportAction> {
  return deepFreeze({ type: "report" as const, level });
}

/**
 * Report action namespace.
 *
 * @example
 * ```ts
 * import { report, when, Impact } from "@hiisi/viola";
 *
 * viola()
 *   .rule(report.error, when.impact.atLeast(Impact.Major))
 *   .rule(report.off, when.in("**\/*_test.ts"));
 * ```
 */
export const report = deepFreeze({
  /** Fails build, exits non-zero */
  error: createReportAction(ReportLevel.Error),
  /** Yellow output, doesn't fail */
  warn: createReportAction(ReportLevel.Warn),
  /** Blue, informational */
  info: createReportAction(ReportLevel.Info),
  /** Dim, subtle suggestion */
  hint: createReportAction(ReportLevel.Hint),
  /** Suppress, don't show */
  off: createReportAction(ReportLevel.Off),
  /** Don't run linters at all (file-scope only) */
  skip: createReportAction(ReportLevel.Skip),
});

/**
 * Type guard for report actions.
 */
export function isReportAction(action: RuleAction): action is ReportAction {
  return action.type === "report";
}

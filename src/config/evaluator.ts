//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Picking a report level for an issue.
 *
 * Rules are read last to first and the first that matches decides, so a later
 * rule overrides an earlier one the way a later CSS rule does.
 *
 * Whether a rule matches is not decided here. That is one condition evaluator
 * in `src/conditions/`, and this module's job is only to turn an issue plus a
 * catalog into the context that evaluator reads, and then to walk the rules.
 * There used to be a second evaluator here, with its own opinion about what
 * `Impact` and `Category` were.
 *
 * @module
 */

import type { Frozen } from "@hiisi/flash-freeze";
import { evaluateCondition } from "../conditions/evaluate.ts";
import type {
  Condition,
  EvaluationContext,
  IssueContext,
} from "../conditions/types.ts";
import { Category, Impact, ReportLevel } from "../conditions/vocabulary.ts";
import type { Issue } from "../data/types.ts";
import { isReportAction } from "./actions.ts";
import type { IssueCatalog } from "./types.ts";
import type { Rule } from "./types/builder.types.ts";
import type { EvaluatedIssue, RunContext } from "./types/evaluator.types.ts";

export type { EvaluatedIssue, RunContext } from "./types/evaluator.types.ts";

/** A run that asked about neither the environment nor the project root. */
const NO_RUN_CONTEXT: RunContext = { env: {}, projectRoot: "" };

// =============================================================================
// Rule Evaluation
// =============================================================================

/**
 * Parse an issue kind into linter ID and issue name.
 */
function parseIssueKind(kind: string): { linterId: string; issueName: string } {
  const slashIndex = kind.indexOf("/");
  if (slashIndex === -1) {
    return { linterId: kind, issueName: "" };
  }
  return {
    linterId: kind.slice(0, slashIndex),
    issueName: kind.slice(slashIndex + 1),
  };
}

/**
 * Turn an issue into something a condition can read.
 *
 * Impact and category live in the reporting linter's catalog rather than on
 * the issue, and looking them up is done once here so no condition has to know
 * that. A kind with no catalog entry leaves them absent, which every condition
 * over them then reads as false rather than as a match.
 */
export function createEvaluationContext(
  issue: Issue,
  catalogs: Map<string, IssueCatalog>,
  run: RunContext = NO_RUN_CONTEXT,
): EvaluationContext {
  const { linterId, issueName } = parseIssueKind(issue.kind);
  const issueDef = catalogs.get(linterId)?.[issue.kind];

  const context: IssueContext = {
    by: linterId,
    kind: issue.kind,
    name: issueName,
    impact: issueDef?.impact as Impact | undefined,
    category: issueDef?.category as Category | undefined,
    confidence: issue.confidence,
    line: issue.location.line,
    ...(issue.location.column === undefined
      ? {}
      : { column: issue.location.column }),
  };

  return {
    issue: context,
    file: {
      path: issue.location.file,
      extension: extensionOf(issue.location.file),
      grammarId: "",
    },
    env: run.env,
    projectRoot: run.projectRoot,
  };
}

/** The extension including its dot, or empty when the name carries none. */
function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}

/**
 * Evaluate an issue against a set of rules.
 *
 * Rules are evaluated in reverse order (last to first). The first matching
 * rule (from the end) determines the report level. This gives "last wins"
 * semantics - later rules override earlier ones, like CSS.
 *
 * @param issue - The issue to evaluate
 * @param rules - Rules to evaluate against (in definition order)
 * @param catalogs - Map of linter ID -> issue catalog
 * @param defaultLevel - Default level if no rule matches
 * @returns Evaluated issue with report level
 */
export function evaluateIssue(
  issue: Issue,
  rules: readonly Frozen<Rule>[],
  catalogs: Map<string, IssueCatalog>,
  defaultLevel: ReportLevel = ReportLevel.Warn,
  run: RunContext = NO_RUN_CONTEXT,
): EvaluatedIssue {
  const context = createEvaluationContext(issue, catalogs, run);

  // Iterate in reverse order - last matching rule wins
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]!;

    if (evaluateCondition(rule.condition, context)) {
      // Rule matched - extract report level from action
      if (isReportAction(rule.action)) {
        return {
          issue,
          level: rule.action.level,
          matchedRule: i,
        };
      }
    }
  }

  // No rule matched, use default
  return {
    issue,
    level: defaultLevel,
    matchedRule: -1,
  };
}

/**
 * Evaluate multiple issues against rules.
 *
 * @param issues - Issues to evaluate
 * @param rules - Rules to evaluate against
 * @param catalogs - Map of linter ID -> issue catalog
 * @param defaultLevel - Default level if no rule matches
 * @returns Evaluated issues
 */
export function evaluateIssues(
  issues: readonly Issue[],
  rules: readonly Frozen<Rule>[],
  catalogs: Map<string, IssueCatalog>,
  defaultLevel: ReportLevel = ReportLevel.Warn,
  run: RunContext = NO_RUN_CONTEXT,
): EvaluatedIssue[] {
  return issues.map((issue) =>
    evaluateIssue(issue, rules, catalogs, defaultLevel, run)
  );
}

/**
 * Filter evaluated issues to only include those that should be reported.
 * Removes issues with level "off" or "skip".
 */
export function filterReportableIssues(
  issues: readonly EvaluatedIssue[],
): EvaluatedIssue[] {
  return issues.filter(
    (i) => i.level !== ReportLevel.Off && i.level !== ReportLevel.Skip,
  );
}

/**
 * Check if any evaluated issue has error level.
 */
export function hasErrors(issues: readonly EvaluatedIssue[]): boolean {
  return issues.some((i) => i.level === ReportLevel.Error);
}

/**
 * Group issues by report level.
 */
export function groupByLevel(
  issues: readonly EvaluatedIssue[],
): Map<ReportLevel, EvaluatedIssue[]> {
  const groups = new Map<ReportLevel, EvaluatedIssue[]>();

  for (const issue of issues) {
    const group = groups.get(issue.level);
    if (group) {
      group.push(issue);
    } else {
      groups.set(issue.level, [issue]);
    }
  }

  return groups;
}

/**
 * Get issue counts by level.
 */
export function countByLevel(
  issues: readonly EvaluatedIssue[],
): Record<ReportLevel, number> {
  const counts: Record<ReportLevel, number> = {
    [ReportLevel.Error]: 0,
    [ReportLevel.Warn]: 0,
    [ReportLevel.Info]: 0,
    [ReportLevel.Hint]: 0,
    [ReportLevel.Off]: 0,
    [ReportLevel.Skip]: 0,
  };

  for (const issue of issues) {
    counts[issue.level]++;
  }

  return counts;
}

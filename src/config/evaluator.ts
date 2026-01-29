/**
 * Rule evaluator for viola configuration.
 *
 * Evaluates conditions against issues to determine the appropriate report level.
 * Uses "last wins" semantics - rules are evaluated in reverse order, so later
 * rules take precedence over earlier ones (like CSS).
 *
 * @module
 */

import type { Frozen } from "@hiisi/flash-freeze";
import type { Issue } from "../data/types.ts";
import { isReportAction } from "./actions.ts";
import type { Rule } from "./builder.ts";
import {
    isCategoryCondition,
    isCompoundCondition,
    isConfidenceCondition,
    isFileCondition,
    isImpactCondition,
    isLinterCondition,
    isNotCondition,
    type CategoryCondition,
    type CompoundCondition,
    type Condition,
    type ConfidenceCondition,
    type FileCondition,
    type ImpactCondition,
    type LinterCondition,
    type NotCondition,
} from "./conditions.ts";
import { Category, Impact, impactValue, ReportLevel } from "./enums.ts";
import type { IssueCatalog, IssueDef } from "./types.ts";

// =============================================================================
// Types
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

// =============================================================================
// Glob Matching
// =============================================================================

/**
 * Convert a glob pattern to a regex.
 * Supports: * (any chars except /), ** (any chars including /), ? (single char)
 */
function globToRegex(pattern: string): RegExp {
  let regex = pattern
    // Escape special regex chars (except * and ?)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // ** matches anything including /
    .replace(/\*\*/g, "<<<DOUBLESTAR>>>")
    // * matches anything except /
    .replace(/\*/g, "[^/]*")
    // ? matches single char
    .replace(/\?/g, ".")
    // Restore **
    .replace(/<<<DOUBLESTAR>>>/g, ".*");

  return new RegExp(`^${regex}$`);
}

/**
 * Check if a string matches a glob pattern.
 */
function matchesGlob(value: string, pattern: string): boolean {
  return globToRegex(pattern).test(value);
}

/**
 * Check if a string matches any of the given patterns.
 */
function matchesAnyGlob(value: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => matchesGlob(value, p));
}

// =============================================================================
// Condition Evaluation
// =============================================================================

/**
 * Evaluate an impact condition.
 */
function evaluateImpactCondition(
  condition: ImpactCondition,
  context: EvaluationContext
): boolean {
  const issueDef = context.issueDef;
  if (!issueDef) {
    // No catalog entry, can't evaluate impact
    return false;
  }

  // Convert string impact to enum for comparison
  const issueImpact = stringToImpact(issueDef.impact);
  if (issueImpact === null) return false;

  const issueValue = impactValue(issueImpact);
  const conditionValue = impactValue(condition.value);

  switch (condition.operator) {
    case "=":
      return issueValue === conditionValue;
    case "!=":
      return issueValue !== conditionValue;
    case ">=":
      // >= means at least as severe (lower value = more severe)
      return issueValue <= conditionValue;
    case "<=":
      // <= means at most as severe (higher value = less severe)
      return issueValue >= conditionValue;
    case ">":
      // > means more severe (lower value)
      return issueValue < conditionValue;
    case "<":
      // < means less severe (higher value)
      return issueValue > conditionValue;
    default:
      return false;
  }
}

/**
 * Convert string impact to Impact enum.
 */
function stringToImpact(impact: string): Impact | null {
  switch (impact) {
    case "critical":
      return Impact.Critical;
    case "major":
      return Impact.Major;
    case "minor":
      return Impact.Minor;
    case "trivial":
      return Impact.Trivial;
    default:
      return null;
  }
}

/**
 * Convert string category to Category enum.
 */
function stringToCategory(category: string): Category | null {
  switch (category) {
    case "correctness":
      return Category.Correctness;
    case "maintainability":
      return Category.Maintainability;
    case "consistency":
      return Category.Consistency;
    case "performance":
      return Category.Performance;
    case "style":
      return Category.Style;
    default:
      return null;
  }
}

/**
 * Evaluate a category condition.
 */
function evaluateCategoryCondition(
  condition: CategoryCondition,
  context: EvaluationContext
): boolean {
  const issueDef = context.issueDef;
  if (!issueDef) {
    // No catalog entry, can't evaluate category
    return false;
  }

  const issueCategory = stringToCategory(issueDef.category);
  if (issueCategory === null) return false;

  // Check include list
  if (condition.include && condition.include.length > 0) {
    if (!condition.include.includes(issueCategory)) {
      return false;
    }
  }

  // Check exclude list
  if (condition.exclude && condition.exclude.length > 0) {
    if (condition.exclude.includes(issueCategory)) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluate a file condition.
 */
function evaluateFileCondition(
  condition: FileCondition,
  context: EvaluationContext
): boolean {
  const file = context.issue.location.file;
  return matchesAnyGlob(file, condition.patterns);
}

/**
 * Evaluate a linter condition.
 */
function evaluateLinterCondition(
  condition: LinterCondition,
  context: EvaluationContext
): boolean {
  // Match against linter ID or full issue kind
  return (
    matchesAnyGlob(context.linterId, condition.patterns) ||
    matchesAnyGlob(context.issue.kind, condition.patterns)
  );
}

/**
 * Evaluate a confidence condition.
 */
function evaluateConfidenceCondition(
  condition: ConfidenceCondition,
  context: EvaluationContext
): boolean {
  const confidence = context.issue.confidence;

  if (condition.min !== undefined && confidence < condition.min) {
    return false;
  }

  if (condition.max !== undefined && confidence > condition.max) {
    return false;
  }

  return true;
}

/**
 * Evaluate a compound condition (AND/OR).
 */
function evaluateCompoundCondition(
  condition: CompoundCondition,
  context: EvaluationContext
): boolean {
  if (condition.operator === "and") {
    return condition.conditions.every((c) => evaluateCondition(c, context));
  } else {
    // "or"
    return condition.conditions.some((c) => evaluateCondition(c, context));
  }
}

/**
 * Evaluate a NOT condition.
 */
function evaluateNotCondition(
  condition: NotCondition,
  context: EvaluationContext
): boolean {
  return !evaluateCondition(condition.condition, context);
}

/**
 * Evaluate any condition type.
 */
export function evaluateCondition(
  condition: Condition | Frozen<Condition>,
  context: EvaluationContext
): boolean {
  // Cast away Frozen for evaluation (it's just readonly)
  const cond = condition as Condition;

  if (isImpactCondition(cond)) {
    return evaluateImpactCondition(cond, context);
  }
  if (isCategoryCondition(cond)) {
    return evaluateCategoryCondition(cond, context);
  }
  if (isFileCondition(cond)) {
    return evaluateFileCondition(cond, context);
  }
  if (isLinterCondition(cond)) {
    return evaluateLinterCondition(cond, context);
  }
  if (isConfidenceCondition(cond)) {
    return evaluateConfidenceCondition(cond, context);
  }
  if (isCompoundCondition(cond)) {
    return evaluateCompoundCondition(cond, context);
  }
  if (isNotCondition(cond)) {
    return evaluateNotCondition(cond, context);
  }

  // Unknown condition type
  return false;
}

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
 * Create evaluation context for an issue.
 */
export function createEvaluationContext(
  issue: Issue,
  catalogs: Map<string, IssueCatalog>
): EvaluationContext {
  const { linterId, issueName } = parseIssueKind(issue.kind);

  // Look up issue definition from catalog
  const catalog = catalogs.get(linterId);
  const issueDef = catalog?.[issue.kind];

  return {
    issue,
    issueDef,
    linterId,
    issueName,
  };
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
  defaultLevel: ReportLevel = ReportLevel.Warn
): EvaluatedIssue {
  const context = createEvaluationContext(issue, catalogs);

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
  defaultLevel: ReportLevel = ReportLevel.Warn
): EvaluatedIssue[] {
  return issues.map((issue) =>
    evaluateIssue(issue, rules, catalogs, defaultLevel)
  );
}

/**
 * Filter evaluated issues to only include those that should be reported.
 * Removes issues with level "off" or "skip".
 */
export function filterReportableIssues(
  issues: readonly EvaluatedIssue[]
): EvaluatedIssue[] {
  return issues.filter(
    (i) => i.level !== ReportLevel.Off && i.level !== ReportLevel.Skip
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
  issues: readonly EvaluatedIssue[]
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
  issues: readonly EvaluatedIssue[]
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

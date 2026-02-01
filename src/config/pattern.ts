/**
 * Shared pattern matching utilities for viola configuration.
 *
 * Consolidates glob matching and pattern parsing functions used by
 * multiple config modules.
 *
 * @module
 */

import type {
    IssueCategory,
    IssueImpact,
    ParsedPattern,
    PatternValue,
    ResolvedPatternValue,
} from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

/** Valid issue categories */
const CATEGORIES: readonly IssueCategory[] = [
  "correctness",
  "maintainability",
  "consistency",
  "performance",
  "style",
] as const;

/** Valid impact levels in order */
const IMPACTS: readonly IssueImpact[] = [
  "critical",
  "major",
  "minor",
  "trivial",
] as const;

// =============================================================================
// Glob Matching
// =============================================================================

/**
 * Convert a glob pattern to a regex.
 * Supports: * (any chars except /), ** (any chars including /), ? (single char)
 *
 * @param pattern - Glob pattern to convert
 * @returns Regular expression for matching
 */
export function globToRegex(pattern: string): RegExp {
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
 *
 * @param value - String to check
 * @param pattern - Glob pattern
 * @returns Whether the string matches the pattern
 */
export function matchesGlob(value: string, pattern: string): boolean {
  // Fast path for wildcard
  if (pattern === "*") return true;
  return globToRegex(pattern).test(value);
}

/**
 * Check if a string matches any of the given patterns.
 *
 * @param value - String to check
 * @param patterns - Patterns to match against
 * @returns Whether the string matches any pattern
 */
export function matchesAnyGlob(value: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => matchesGlob(value, p));
}

/**
 * Check if a file matches a glob pattern.
 * Supports ** for directory wildcards.
 *
 * @param filePath - File path to check
 * @param pattern - Glob pattern
 * @returns Whether the file matches the pattern
 */
export function matchesFilePattern(filePath: string, pattern: string): boolean {
  return matchesGlob(filePath, pattern);
}

// =============================================================================
// Pattern Parsing
// =============================================================================

/**
 * Parse a pattern string into components.
 *
 * Formats:
 * - `linter/issue` - exact match
 * - `linter/*` - all issues from linter
 * - `*::category` - category filter
 * - `*>=impact` - impact comparison
 * - `linter/*::category>=impact` - combined
 *
 * @param pattern - Pattern string to parse
 * @returns Parsed pattern or null if invalid
 */
export function parsePattern(pattern: string): ParsedPattern | null {
  let remaining = pattern;
  let linter = "*";
  let issue = "*";
  let category: IssueCategory | undefined;
  let impact: ParsedPattern["impact"];

  // Extract category filter (::category)
  const categoryMatch = remaining.match(/::(\w+)/);
  if (categoryMatch) {
    const cat = categoryMatch[1] as IssueCategory;
    if (CATEGORIES.includes(cat)) {
      category = cat;
    }
    remaining = remaining.replace(categoryMatch[0], "");
  }

  // Extract impact comparison (>=major, =minor, !=trivial, etc.)
  const impactMatch = remaining.match(/(>=|<=|>|<|!=|=)(critical|major|minor|trivial)/);
  if (impactMatch) {
    const operator = impactMatch[1] as NonNullable<ParsedPattern["impact"]>["operator"];
    const value = impactMatch[2] as IssueImpact;
    if (IMPACTS.includes(value)) {
      impact = { operator, value };
    }
    remaining = remaining.replace(impactMatch[0], "");
  }

  // Parse linter/issue
  remaining = remaining.trim();
  if (remaining) {
    const slashIdx = remaining.indexOf("/");
    if (slashIdx !== -1) {
      linter = remaining.slice(0, slashIdx) || "*";
      issue = remaining.slice(slashIdx + 1) || "*";
    } else {
      // Just a linter name or "*"
      linter = remaining;
      issue = "*";
    }
  }

  return {
    raw: pattern,
    linter,
    issue,
    category,
    impact,
  };
}

/**
 * Check if an issue matches a parsed pattern.
 *
 * @param issueKind - The issue kind (linter/issue format)
 * @param issueCategory - The issue's category
 * @param issueImpact - The issue's impact level
 * @param pattern - The parsed pattern to match against
 * @returns Whether the issue matches the pattern
 */
export function matchesIssuePattern(
  issueKind: string,
  issueCategory: IssueCategory,
  issueImpact: IssueImpact,
  pattern: ParsedPattern
): boolean {
  // Parse issue kind (linter/issue format)
  const slashIdx = issueKind.indexOf("/");
  const linterId = slashIdx !== -1 ? issueKind.slice(0, slashIdx) : issueKind;
  const issueName = slashIdx !== -1 ? issueKind.slice(slashIdx + 1) : "*";

  // Check linter match
  if (pattern.linter !== "*" && !matchesGlob(linterId, pattern.linter)) {
    return false;
  }

  // Check issue match
  if (pattern.issue !== "*" && !matchesGlob(issueName, pattern.issue)) {
    return false;
  }

  // Check category
  if (pattern.category && pattern.category !== issueCategory) {
    return false;
  }

  // Check impact
  if (pattern.impact) {
    const issueIdx = IMPACTS.indexOf(issueImpact);
    const patternIdx = IMPACTS.indexOf(pattern.impact.value);

    switch (pattern.impact.operator) {
      case "=":
        if (issueIdx !== patternIdx) return false;
        break;
      case "!=":
        if (issueIdx === patternIdx) return false;
        break;
      case ">=":
        // Higher impact = lower index
        if (issueIdx > patternIdx) return false;
        break;
      case "<=":
        if (issueIdx < patternIdx) return false;
        break;
      case ">":
        if (issueIdx >= patternIdx) return false;
        break;
      case "<":
        if (issueIdx <= patternIdx) return false;
        break;
    }
  }

  return true;
}

// =============================================================================
// Pattern Value Resolution
// =============================================================================

/**
 * Resolve a pattern value to normalized form.
 *
 * @param value - Pattern value (string severity or full config object)
 * @returns Resolved pattern value with severity and minConfidence
 */
export function resolvePatternValue(value: PatternValue): ResolvedPatternValue {
  if (typeof value === "string") {
    return { severity: value, minConfidence: 0 };
  }
  return {
    severity: value.severity,
    minConfidence: value.minConfidence ?? 0,
  };
}

//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Shared pattern matching utilities for viola configuration.
 *
 * Consolidates glob matching and pattern parsing functions used by
 * multiple config modules.
 *
 * @module
 */

import {
  Category,
  type CategoryName,
  Impact,
  IMPACT_ORDER,
  type ImpactName,
} from "../conditions/vocabulary.ts";

import { matchesGlob } from "../utils/glob.ts";

import type {
  ParsedPattern,
  PatternValue,
  ResolvedPatternValue,
} from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

/**
 * Every category a pattern may name.
 *
 * Read off the enum rather than listed again, so a category added to the
 * vocabulary is nameable in a pattern without anybody remembering to come
 * here. This list had five members where the vocabulary now has eight.
 */
const CATEGORIES: readonly CategoryName[] = Object.values(Category);

/** Valid impact levels in order */
/**
 * Every impact a pattern may name, most severe first.
 *
 * `IMPACT_ORDER` is the ordering, so this is the same array rather than a
 * second one that has to agree with it.
 */
const IMPACTS: readonly ImpactName[] = IMPACT_ORDER;

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
  let category: Category | undefined;
  let impact: ParsedPattern["impact"];

  // Extract category filter (::category)
  const categoryMatch = remaining.match(/::(\w+)/);
  if (categoryMatch) {
    const cat = categoryMatch[1] as Category;
    if (CATEGORIES.includes(cat)) {
      category = cat;
    }
    remaining = remaining.replace(categoryMatch[0], "");
  }

  // Extract impact comparison (>=major, =minor, !=trivial, etc.)
  const impactMatch = remaining.match(
    /(>=|<=|>|<|!=|=)(critical|major|minor|trivial)/,
  );
  if (impactMatch) {
    const operator = impactMatch[1] as NonNullable<
      ParsedPattern["impact"]
    >["operator"];
    const value = impactMatch[2] as Impact;
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
  issueCategory: Category,
  issueImpact: Impact,
  pattern: ParsedPattern,
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

/**
 * Core enums for viola configuration.
 *
 * @module
 */

/**
 * Impact level of an issue - how urgent it is.
 * 
 * Order: Critical > Major > Minor > Trivial
 */
export enum Impact {
  /** Must fix, blocks release */
  Critical = "critical",
  /** Should fix soon */
  Major = "major",
  /** Fix when convenient */
  Minor = "minor",
  /** Nice to have */
  Trivial = "trivial",
}

/**
 * Impact levels in order from highest to lowest.
 */
export const IMPACT_ORDER: readonly Impact[] = [
  Impact.Critical,
  Impact.Major,
  Impact.Minor,
  Impact.Trivial,
] as const;

/**
 * Get numeric value for impact comparison (lower = more severe).
 */
export function impactValue(impact: Impact): number {
  return IMPACT_ORDER.indexOf(impact);
}

/**
 * Compare two impacts. Returns negative if a > b, positive if a < b, 0 if equal.
 */
export function compareImpact(a: Impact, b: Impact): number {
  return impactValue(a) - impactValue(b);
}

/**
 * Category of an issue - what kind of problem it represents.
 */
export enum Category {
  /** Code is wrong or broken */
  Correctness = "correctness",
  /** Harder to work with over time */
  Maintainability = "maintainability",
  /** Breaks project conventions */
  Consistency = "consistency",
  /** Slower than needed */
  Performance = "performance",
  /** Cosmetic/formatting */
  Style = "style",
}

/**
 * Report level - how to report/classify an issue in output.
 */
export enum ReportLevel {
  /** Fails build, exits non-zero */
  Error = "error",
  /** Yellow output, doesn't fail */
  Warn = "warn",
  /** Blue, informational */
  Info = "info",
  /** Dim, subtle suggestion */
  Hint = "hint",
  /** Suppress, don't show */
  Off = "off",
  /** Don't run linters at all (file-scope only) */
  Skip = "skip",
}

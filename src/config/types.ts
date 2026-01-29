/**
 * Viola configuration types.
 *
 * Configuration is specified in `deno.json` under the `viola` field.
 * Config is always scoped by file patterns.
 */

// =============================================================================
// Issue Classification
// =============================================================================

/**
 * Category of an issue - what kind of problem it represents.
 */
export type IssueCategory =
  | "correctness"    // Code is wrong or broken
  | "maintainability" // Harder to work with over time
  | "consistency"    // Breaks project conventions
  | "performance"    // Slower than needed
  | "style";         // Cosmetic/formatting

/**
 * Impact level of an issue - how urgent it is (ordered).
 * 
 * Order: critical > major > minor > trivial
 */
export type IssueImpact =
  | "critical"  // Must fix, blocks release
  | "major"     // Should fix soon
  | "minor"     // Fix when convenient
  | "trivial";  // Nice to have

/**
 * Impact levels in order from highest to lowest.
 */
export const IMPACT_ORDER: readonly IssueImpact[] = [
  "critical",
  "major",
  "minor",
  "trivial",
] as const;

/**
 * Get numeric value for impact comparison.
 */
export function impactValue(impact: IssueImpact): number {
  return IMPACT_ORDER.indexOf(impact);
}

/**
 * Compare two impacts. Returns negative if a > b, positive if a < b, 0 if equal.
 */
export function compareImpact(a: IssueImpact, b: IssueImpact): number {
  return impactValue(a) - impactValue(b);
}

/**
 * Output severity for reporting.
 */
export type Severity = "error" | "warn" | "info" | "off";

// =============================================================================
// Issue Catalog
// =============================================================================

/**
 * Definition of an issue kind that a linter can emit.
 */
export interface IssueDef {
  /** What kind of problem this is */
  category: IssueCategory;
  /** How urgent this is by default */
  impact: IssueImpact;
  /** Human-readable description */
  description: string;
  /** Default confidence if not specified per-issue (0-100) */
  defaultConfidence?: number;
}

/**
 * Catalog of all issue kinds a linter can emit.
 * Keys are in format "linter-id/issue-kind".
 */
export type IssueCatalog = Record<string, IssueDef>;

// =============================================================================
// Configuration
// =============================================================================

/**
 * Simple severity value or full config object.
 */
export type PatternValue =
  | Severity
  | {
      /** Output severity */
      severity: Severity;
      /** Minimum confidence to report (0-100) */
      minConfidence?: number;
    };

/**
 * Scope configuration - patterns mapped to severities.
 * 
 * Pattern syntax:
 * - `linter/issue` - exact issue
 * - `linter/*` - all issues from linter
 * - `*::category` - all issues with category
 * - `*>=impact` - all issues with impact >= threshold
 * - `*=impact` - all issues with exact impact
 * - `*!=impact` - all issues except impact
 * - Combinations: `linter/*::category`, `linter/*>=impact`
 */
export type ScopeConfig = Record<string, PatternValue>;

/**
 * Root viola configuration.
 * 
 * Contains a `plugins` array and file glob patterns mapped to scope configs.
 * 
 * @example
 * ```json
 * {
 *   "plugins": ["@hiisi/viola-linters"],
 *   "**\/*.ts": {
 *     "*>=major": "error",
 *     "*>=minor": "warn",
 *     "deprecation/stale": "error"
 *   },
 *   "**\/*_test.ts": {
 *     "*>=major": "warn"
 *   }
 * }
 * ```
 */
export interface ViolaConfig {
  /**
   * List of plugin modules to load.
   * Uses the same syntax as TypeScript/Deno imports:
   * - Import map references: `@hiisi/viola-linters`
   * - JSR specifiers: `jsr:@scope/package`
   * - npm specifiers: `npm:package`
   * - URLs: `https://example.com/linter.ts`
   * - Local paths: `./local-linter.ts`
   */
  plugins?: string[];
  
  /**
   * File glob patterns mapped to scope configs.
   * All other keys are treated as file patterns.
   */
  [filePattern: string]: ScopeConfig | string[] | undefined;
}

// =============================================================================
// Resolved Configuration
// =============================================================================

/**
 * A parsed pattern with its components.
 */
export interface ParsedPattern {
  /** Original pattern string */
  raw: string;
  /** Linter glob (e.g., "deprecation", "*", "similar-*") */
  linter: string;
  /** Issue glob (e.g., "stale", "*") */
  issue: string;
  /** Category filter if present */
  category?: IssueCategory;
  /** Impact comparison if present */
  impact?: {
    operator: "=" | "!=" | ">=" | "<=" | ">" | "<";
    value: IssueImpact;
  };
}

/**
 * Resolved pattern value.
 */
export interface ResolvedPatternValue {
  severity: Severity;
  minConfidence: number;
}

/**
 * A scope with parsed patterns.
 */
export interface ResolvedScope {
  /** File glob pattern */
  filePattern: string;
  /** Patterns in resolution order (last wins) */
  patterns: Array<{
    pattern: ParsedPattern;
    value: ResolvedPatternValue;
  }>;
}

/**
 * Fully resolved configuration.
 */
export interface ResolvedConfig {
  /** Plugin specifiers to load */
  plugins: string[];
  /** Scopes in order of definition */
  scopes: ResolvedScope[];
  /** Include paths for crawling */
  include: string[];
  /** Exclude patterns for crawling */
  exclude: string[];
  /** File extensions to check */
  extensions: string[];
}

// =============================================================================
// Configuration Source
// =============================================================================

/**
 * Configuration source for debugging.
 */
export interface ConfigSource {
  /** Path to the config file */
  path: string;
  /** Type of config */
  type: "deno.json" | "viola.json" | "env";
}

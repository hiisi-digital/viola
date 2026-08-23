/**
 * Viola configuration types.
 *
 * Configuration is specified in `deno.json` under the `viola` field.
 * Config is always scoped by file patterns.
 */

import type {
  Category,
  CategoryName,
  Impact,
  ImpactName,
  ReportLevel,
  ReportLevelName,
} from "../conditions/vocabulary.ts";

// The vocabulary lives in `src/conditions/vocabulary.ts`, and this file used
// to hold a second copy of it: `IssueCategory` beside `Category`,
// `IssueImpact` beside `Impact`, `Severity` beside `ReportLevel`, and its own
// `IMPACT_ORDER`, `impactValue` and `compareImpact`. Unifying the two
// condition systems still left this third copy standing, and the linter is
// what found it.

/**
 * What a linter says about one kind of issue it can report.
 *
 * Declared once in the linter's catalog and read whenever an issue of that
 * kind turns up, which is how a rule about impact or category reaches a
 * finding that carries neither.
 */
export interface IssueDef {
  /** What kind of problem this is */
  category: CategoryName;
  /** How urgent this is by default */
  impact: ImpactName;
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
  | ReportLevelName
  | {
    /** Output severity */
    severity: ReportLevelName;
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
 * Contains a `plugins` array, `inherit` for presets, `config` for per-linter
 * options, and file glob patterns mapped to scope configs.
 *
 * @example
 * ```json
 * {
 *   "plugins": ["@hiisi/viola-default-lints"],
 *   "inherit": ["strict"],
 *   "config": {
 *     "type-location": { "allowedDirs": ["src/types"] }
 *   },
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
   * - Import map references: `@hiisi/viola-default-lints`
   * - JSR specifiers: `jsr:@scope/package`
   * - npm specifiers: `npm:package`
   * - URLs: `https://example.com/linter.ts`
   * - Local paths: `./local-linter.ts`
   */
  plugins?: string[];

  /**
   * Preset names to inherit from loaded plugins.
   * Presets are applied in order (later presets override earlier).
   * User's own rules are applied last (always win).
   *
   * Note: "default" presets from plugins are auto-applied before these.
   * Use short names or qualified names (plugin/preset) if ambiguous.
   */
  inherit?: string[];

  /**
   * Per-linter configuration options.
   * Keys are linter IDs, values are linter-specific config objects.
   * Validated against schemas provided by plugins.
   */
  config?: Record<string, Record<string, unknown>>;

  /**
   * File glob patterns mapped to scope configs.
   * All other keys are treated as file patterns.
   */
  [filePattern: string]:
    | ScopeConfig
    | string[]
    | Record<string, unknown>
    | undefined;
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
  category?: Category;
  /** Impact comparison if present */
  impact?: {
    operator: "=" | "!=" | ">=" | "<=" | ">" | "<";
    value: Impact;
  };
}

/**
 * Resolved pattern value.
 */
export interface ResolvedPatternValue {
  severity: ReportLevelName;
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
  /** Preset names to inherit (after auto-applied defaults) */
  inherit: string[];
  /** Per-linter configuration options */
  linterConfig: Record<string, Record<string, unknown>>;
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
  /** Type of config. There is one, and it is the only one there has been
   * since the `deno.json` block went; the field stays so a reader of a
   * source list can see what answered rather than infer it. */
  type: "viola.config.ts";
}

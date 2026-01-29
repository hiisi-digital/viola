/**
 * Viola configuration types.
 *
 * Configuration can be specified in:
 * 1. `deno.json` under the `viola` field
 * 2. `viola.json` at project root or subdirectories
 * 3. Environment variable `VIOLA_CONFIG` pointing to a config file
 *
 * Subdirectory configs inherit from parent configs and can override.
 * Explicit `viola.json` takes precedence over `deno.json`.
 */

/**
 * Severity level for a checker.
 */
export type Severity = "error" | "warning" | "info" | "off";

/**
 * Configuration for a single checker.
 * Can be just the checker name (string) for defaults,
 * or an object with options.
 */
export type CheckerConfig =
  | string // Just the checker name, use defaults
  | {
      /** Checker ID */
      id: string;
      /** Override severity */
      severity?: Severity;
      /** Checker-specific options */
      options?: Record<string, unknown>;
    };

/**
 * A scoped configuration that applies to files matching a pattern.
 */
export interface ScopedConfig {
  /** Glob pattern for files this config applies to */
  pattern: string;
  /** Checkers to run on matching files */
  checkers?: CheckerConfig[];
  /** Checkers to skip on matching files */
  skip?: string[];
  /** Override severity for specific checkers */
  severity?: Record<string, Severity>;
}

/**
 * Root viola configuration.
 */
export interface ViolaFileConfig {
  /**
   * Checkers to run globally (implicit "*" pattern).
   * Can be an array of checker names/configs.
   */
  checkers?: CheckerConfig[];

  /**
   * Checkers to skip globally.
   */
  skip?: string[];

  /**
   * Override severity for specific checkers globally.
   */
  severity?: Record<string, Severity>;

  /**
   * Scoped configurations by pattern.
   * Keys are glob patterns, values are scoped configs.
   */
  scopes?: Record<string, Omit<ScopedConfig, "pattern">>;

  /**
   * Directories to include.
   */
  include?: string[];

  /**
   * Directories/patterns to exclude.
   */
  exclude?: string[];

  /**
   * File extensions to check.
   */
  extensions?: string[];

  /**
   * Paths to additional config files to extend.
   */
  extends?: string | string[];
}

/**
 * Resolved configuration after merging all sources.
 */
export interface ResolvedConfig {
  /** Root checkers (apply to all files unless overridden) */
  checkers: Map<string, { severity: Severity; options: Record<string, unknown> }>;

  /** Scoped configs by pattern */
  scopes: Map<string, {
    checkers: Map<string, { severity: Severity; options: Record<string, unknown> }>;
    skip: Set<string>;
  }>;

  /** Global skip list */
  skip: Set<string>;

  /** Include paths */
  include: string[];

  /** Exclude patterns */
  exclude: string[];

  /** File extensions */
  extensions: string[];
}

/**
 * Configuration source for debugging.
 */
export interface ConfigSource {
  /** Path to the config file */
  path: string;
  /** Type of config */
  type: "deno.json" | "viola.json" | "env";
  /** Whether this config was inherited */
  inherited: boolean;
}

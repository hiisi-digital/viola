/**
 * Configuration loader.
 *
 * Loads viola configuration from viola.config.ts or deno.json.
 */


import { resolve } from "@std/path";
import {
    type ViolaBuilderConfig
} from "./builder.ts";
import {
    matchesFilePattern,
    matchesIssuePattern,
    parsePattern,
    resolvePatternValue,
} from "./pattern.ts";
import {
    type ConfigSource,
    type IssueCategory,
    type IssueImpact,
    type ResolvedConfig,
    type ResolvedPatternValue,
    type ResolvedScope,
    type ScopeConfig,
    type Severity,
    type ViolaConfig
} from "./types.ts";

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_EXCLUDE = ["node_modules", ".git", "dist", "build", "coverage"];

/**
 * Load configuration, preferring viola.config.ts over deno.json.
 */
export async function loadConfig(
  dir: string,
  options: { verbose?: boolean; configPath?: string; preloadedModule?: unknown } = {}
): Promise<{ config: ResolvedConfig; sources: ConfigSource[]; builderConfig?: ViolaBuilderConfig }> {
  const sources: ConfigSource[] = [];

  // Try viola.config.ts first (or custom config path)
  const configTsPath = options.configPath ?? resolve(dir, "viola.config.ts");

  if (options.verbose) {
    console.log(`[loader] Looking for config at: ${configTsPath}`);
  }

  // Use pre-loaded module if provided (for when running from non-file context)
  const builderConfig = options.preloadedModule
    ? processModuleDefault(options.preloadedModule, options.verbose)
    : await loadBuilderConfig(configTsPath, options.verbose);

  if (builderConfig) {
    sources.push({ path: configTsPath, type: "viola.config.ts" as ConfigSource["type"] });

    if (options.verbose) {
      console.log("Config sources:");
      console.log(`  - ${configTsPath} (viola.config.ts)`);
    }

    const resolved = resolveBuilderConfig(builderConfig);
    return { config: resolved, sources, builderConfig };
  }

  // Fall back to deno.json (deprecated)
  const denoPath = resolve(dir, "deno.json");
  const violaConfig = await loadDenoConfig(denoPath);

  if (violaConfig) {
    sources.push({ path: denoPath, type: "deno.json" });
    
    if (options.verbose) {
      console.log("Config sources:");
      console.log(`  - ${denoPath} (deno.json) [deprecated: use viola.config.ts]`);
    }
  }

  const resolved = resolveConfig(violaConfig ?? {});
  return { config: resolved, sources };
}

/**
 * Check if an object looks like a ViolaBuilder (duck typing).
 * 
 * We can't use instanceof because the config file may import ViolaBuilder
 * from a different module instance than the loader.
 */
function isViolaBuilder(obj: unknown): boolean {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "_linters" in obj &&
    "_rules" in obj &&
    "_settings" in obj &&
    "build" in obj &&
    typeof (obj as unknown as { build: unknown }).build === "function"
  );
}

/**
 * Process an already-loaded module default export into builder config.
 */
function processModuleDefault(defaultExport: unknown, verbose = false): ViolaBuilderConfig | null {
  if (!defaultExport) {
    if (verbose) {
      console.log(`[loader] Config has no default export`);
    }
    return null;
  }

  if (verbose) {
    console.log(`[loader] Default export type: ${typeof defaultExport}`);
    console.log(`[loader] Is ViolaBuilder: ${isViolaBuilder(defaultExport)}`);
  }

  // If it's a ViolaBuilder (duck typing), call build()
  if (isViolaBuilder(defaultExport)) {
    const built = (defaultExport as { build(): ViolaBuilderConfig }).build();
    if (verbose) {
      console.log(`[loader] Built config: ${built.linters.length} linters, ${built.rules.length} rules`);
    }
    return built;
  }

  // If it's already a built config object
  if (typeof defaultExport === "object" && "linters" in defaultExport && "rules" in defaultExport) {
    if (verbose) {
      console.log(`[loader] Config is already built`);
    }
    return defaultExport as ViolaBuilderConfig;
  }

  if (verbose) {
    console.log(`[loader] Config format not recognized`);
  }
  return null;
}

/**
 * Load viola.config.ts and get the builder config.
 */
async function loadBuilderConfig(path: string, verbose = false): Promise<ViolaBuilderConfig | null> {
  try {
    // Check if file exists
    await Deno.stat(path);

    if (verbose) {
      console.log(`[loader] Found config file: ${path}`);
    }

    // Dynamic import the config file
    const module = await import(`file://${path}`);
    return processModuleDefault(module.default, verbose);
  } catch (err) {
    if (verbose) {
      console.log(`[loader] Error loading config: ${err}`);
    }
    return null;
  }
}

/**
 * Convert builder config to resolved config.
 * 
 * Note: The new rule-based config uses Condition objects that are evaluated
 * at runtime. This function extracts linter settings but leaves rules
 * in their native format for the new evaluation engine.
 */
export function resolveBuilderConfig(config: ViolaBuilderConfig): ResolvedConfig {
  // Build linter config from settings
  const linterConfig: Record<string, Record<string, unknown>> = {};

  for (const setting of config.settings) {
    if (!linterConfig[setting.linter]) {
      linterConfig[setting.linter] = {};
    }
    const linterCfg = linterConfig[setting.linter]!;
    linterCfg[setting.key] = setting.value;
  }

  return {
    plugins: [], // Plugins are handled separately (they're actual objects, not strings)
    inherit: [],
    linterConfig,
    scopes: [], // Rules are now in config.rules, evaluated separately
    include: [],
    exclude: [...DEFAULT_EXCLUDE],
    extensions: [...DEFAULT_EXTENSIONS],
  };
}

/**
 * Load viola config from deno.json.
 */
async function loadDenoConfig(path: string): Promise<ViolaConfig | null> {
  try {
    const text = await Deno.readTextFile(path);
    const deno = JSON.parse(text) as { viola?: ViolaConfig };
    return deno.viola ?? null;
  } catch {
    return null;
  }
}

/** Known non-scope fields in viola config */
const RESERVED_CONFIG_FIELDS = ["plugins", "inherit", "config", "include", "exclude"];

/**
 * Resolve raw config into parsed patterns.
 */
function resolveConfig(config: ViolaConfig): ResolvedConfig {
  const scopes: ResolvedScope[] = [];
  const plugins: string[] = config.plugins ?? [];
  const inherit: string[] = config.inherit ?? [];
  const linterConfig: Record<string, Record<string, unknown>> = config.config ?? {};

  for (const [key, value] of Object.entries(config)) {
    // Skip known non-scope fields
    if (RESERVED_CONFIG_FIELDS.includes(key)) {
      continue;
    }

    // Skip non-object entries (shouldn't happen with proper config)
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }

    // Check if this looks like a scope config (has pattern-like keys)
    // vs a linter config object (which would have been in the config field)
    const scopeConfig = value as ScopeConfig;
    const patterns: ResolvedScope["patterns"] = [];

    for (const [patternStr, patternValue] of Object.entries(scopeConfig)) {
      const pattern = parsePattern(patternStr);
      if (!pattern) continue;

      const resolvedValue = resolvePatternValue(patternValue);
      patterns.push({ pattern, value: resolvedValue });
    }

    scopes.push({ filePattern: key, patterns });
  }

  return {
    plugins,
    inherit,
    linterConfig,
    scopes,
    include: [],
    exclude: [...DEFAULT_EXCLUDE],
    extensions: [...DEFAULT_EXTENSIONS],
  };
}

// Re-export shared pattern utilities for backwards compatibility
export { matchesFilePattern, matchesIssuePattern } from "./pattern.ts";

/**
 * Resolve the severity for an issue given a config and file path.
 */
export function resolveIssueSeverity(
  config: ResolvedConfig,
  filePath: string,
  issueKind: string,
  issueCategory: IssueCategory,
  issueImpact: IssueImpact,
  confidence: number
): Severity | null {
  let result: ResolvedPatternValue | null = null;

  // Find matching scopes
  for (const scope of config.scopes) {
    if (!matchesFilePattern(filePath, scope.filePattern)) {
      continue;
    }

    // Find last matching pattern (last wins)
    for (const { pattern, value } of scope.patterns) {
      if (matchesIssuePattern(issueKind, issueCategory, issueImpact, pattern)) {
        result = value;
      }
    }
  }

  // No match - default to warn
  if (!result) {
    return "warn";
  }

  // Check confidence threshold
  if (confidence < result.minConfidence) {
    return null; // Filter out
  }

  return result.severity === "off" ? null : result.severity;
}

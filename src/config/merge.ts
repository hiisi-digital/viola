/**
 * Configuration Merging
 *
 * Handles merging of config presets with user configuration.
 * Presets are underlaid (user config wins), applied in order.
 *
 * @module
 */

import { resolvePreset } from "../runtime/plugins.ts";
import type {
    DiscoveredPreset,
    PluginsDiscoveryResult,
    ViolaConfigPreset,
} from "../types/plugin.ts";
import type {
    PatternValue,
    ResolvedConfig,
    ResolvedPatternValue,
    ResolvedScope
} from "./types.ts";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of merging presets with user config.
 */
export interface MergeResult {
  /** Merged scopes (presets first, then user) */
  scopes: ResolvedScope[];
  /** Warnings generated during merge */
  warnings: string[];
  /** Presets that were applied */
  appliedPresets: string[];
}

/**
 * Options for merging configuration.
 */
export interface MergeOptions {
  /** Whether to log verbose output */
  verbose?: boolean;
}

// =============================================================================
// Preset Resolution
// =============================================================================

/**
 * Resolve preset names to actual presets.
 *
 * @param names - Preset names (short or qualified)
 * @param discovery - Plugin discovery result
 * @returns Resolved presets and any warnings
 */
export function resolvePresets(
  names: string[],
  discovery: PluginsDiscoveryResult
): { presets: DiscoveredPreset[]; warnings: string[] } {
  const presets: DiscoveredPreset[] = [];
  const warnings: string[] = [];

  for (const name of names) {
    const preset = resolvePreset(name, discovery);

    if (!preset) {
      // Check if it's a collision issue
      if (discovery.presetCollisions.includes(name)) {
        warnings.push(
          `Preset "${name}" is ambiguous (multiple plugins define it). ` +
            `Use qualified name: <plugin>/${name}`
        );
      } else {
        warnings.push(`Preset "${name}" not found in any loaded plugin.`);
      }
      continue;
    }

    presets.push(preset);
  }

  return { presets, warnings };
}

/**
 * Collect default presets from all plugins.
 * Default presets are those named "default".
 */
export function collectDefaultPresets(
  discovery: PluginsDiscoveryResult
): DiscoveredPreset[] {
  return discovery.defaultPresets;
}

// =============================================================================
// Config Merging
// =============================================================================

/**
 * Parse a pattern string into components.
 * (Duplicated from loader.ts to avoid circular deps - consider extracting to shared)
 */
function parsePattern(pattern: string): {
  raw: string;
  linter: string;
  issue: string;
  category?: string;
  impact?: { operator: string; value: string };
} | null {
  const CATEGORIES = ["correctness", "maintainability", "consistency", "performance", "style"];
  const IMPACTS = ["critical", "major", "minor", "trivial"];

  let remaining = pattern;
  let linter = "*";
  let issue = "*";
  let category: string | undefined;
  let impact: { operator: string; value: string } | undefined;

  // Extract category filter (::category)
  const categoryMatch = remaining.match(/::(\w+)/);
  if (categoryMatch) {
    const cat = categoryMatch[1];
    if (cat && CATEGORIES.includes(cat)) {
      category = cat;
    }
    remaining = remaining.replace(categoryMatch[0], "");
  }

  // Extract impact comparison (>=major, =minor, !=trivial, etc.)
  const impactMatch = remaining.match(/(>=|<=|>|<|!=|=)(critical|major|minor|trivial)/);
  if (impactMatch) {
    const operator = impactMatch[1];
    const value = impactMatch[2];
    if (operator && value && IMPACTS.includes(value)) {
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
 * Resolve a pattern value to normalized form.
 */
function resolvePatternValue(value: PatternValue): ResolvedPatternValue {
  if (typeof value === "string") {
    return { severity: value, minConfidence: 0 };
  }
  return {
    severity: value.severity,
    minConfidence: value.minConfidence ?? 0,
  };
}

/**
 * Convert a preset's scope config into ResolvedScope format.
 */
function presetToScopes(preset: ViolaConfigPreset): ResolvedScope[] {
  const scopes: ResolvedScope[] = [];

  for (const [filePattern, scopeConfig] of Object.entries(preset)) {
    const patterns: ResolvedScope["patterns"] = [];

    for (const [patternStr, patternValue] of Object.entries(scopeConfig)) {
      const parsed = parsePattern(patternStr);
      if (!parsed) continue;

      // Convert to full ParsedPattern type
      const pattern = {
        raw: parsed.raw,
        linter: parsed.linter,
        issue: parsed.issue,
        category: parsed.category as "correctness" | "maintainability" | "consistency" | "performance" | "style" | undefined,
        impact: parsed.impact as { operator: "=" | "!=" | ">=" | "<=" | ">" | "<"; value: "critical" | "major" | "minor" | "trivial" } | undefined,
      };

      const value = resolvePatternValue(patternValue);
      patterns.push({ pattern, value });
    }

    if (patterns.length > 0) {
      scopes.push({ filePattern, patterns });
    }
  }

  return scopes;
}

/**
 * Merge preset scopes with user scopes.
 *
 * Presets are applied first, then user config.
 * For the same file pattern, patterns are concatenated (user patterns come last = win).
 */
function mergeScopes(
  presetScopes: ResolvedScope[],
  userScopes: ResolvedScope[]
): ResolvedScope[] {
  // Group scopes by file pattern
  const byPattern = new Map<string, ResolvedScope["patterns"][]>();

  // Add preset scopes first
  for (const scope of presetScopes) {
    const existing = byPattern.get(scope.filePattern) ?? [];
    existing.push(scope.patterns);
    byPattern.set(scope.filePattern, existing);
  }

  // Add user scopes (come after = win)
  for (const scope of userScopes) {
    const existing = byPattern.get(scope.filePattern) ?? [];
    existing.push(scope.patterns);
    byPattern.set(scope.filePattern, existing);
  }

  // Flatten into final scopes
  const result: ResolvedScope[] = [];
  for (const [filePattern, patternArrays] of byPattern) {
    const allPatterns = patternArrays.flat();
    result.push({ filePattern, patterns: allPatterns });
  }

  return result;
}

/**
 * Merge configuration presets with user configuration.
 *
 * Order of application:
 * 1. Default presets from plugins (auto-applied)
 * 2. Explicitly inherited presets (in order)
 * 3. User's own config (always wins)
 *
 * @param userConfig - The user's resolved configuration
 * @param discovery - Plugin discovery results
 * @param options - Merge options
 * @returns Merged configuration scopes
 */
export function mergeConfigWithPresets(
  userConfig: ResolvedConfig,
  discovery: PluginsDiscoveryResult,
  options: MergeOptions = {}
): MergeResult {
  const warnings: string[] = [];
  const appliedPresets: string[] = [];

  // Collect all scopes in order
  let mergedScopes: ResolvedScope[] = [];

  // 1. Apply default presets first
  const defaultPresets = collectDefaultPresets(discovery);
  for (const preset of defaultPresets) {
    const presetScopes = presetToScopes(preset.config);
    mergedScopes = mergeScopes(mergedScopes, presetScopes);
    appliedPresets.push(`${preset.pluginName}/${preset.name} (default)`);

    if (options.verbose) {
      console.log(`  Applied default preset: ${preset.pluginName}/${preset.name}`);
    }
  }

  // 2. Apply explicitly inherited presets
  const { presets: inheritedPresets, warnings: resolveWarnings } = resolvePresets(
    userConfig.inherit,
    discovery
  );
  warnings.push(...resolveWarnings);

  for (const preset of inheritedPresets) {
    const presetScopes = presetToScopes(preset.config);
    mergedScopes = mergeScopes(mergedScopes, presetScopes);
    appliedPresets.push(`${preset.pluginName}/${preset.name}`);

    if (options.verbose) {
      console.log(`  Applied inherited preset: ${preset.pluginName}/${preset.name}`);
    }
  }

  // 3. Apply user's own scopes (always win)
  mergedScopes = mergeScopes(mergedScopes, userConfig.scopes);

  if (options.verbose && userConfig.scopes.length > 0) {
    console.log(`  Applied ${userConfig.scopes.length} user scope(s)`);
  }

  return {
    scopes: mergedScopes,
    warnings,
    appliedPresets,
  };
}

/**
 * Merge per-linter configuration from presets with user config.
 *
 * User config always wins over preset config.
 * Nested objects are shallow-merged (user keys override preset keys).
 */
export function mergeLinterConfig(
  presetConfigs: Record<string, Record<string, unknown>>[],
  userConfig: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> {
  const merged: Record<string, Record<string, unknown>> = {};

  // Apply preset configs in order
  for (const presetConfig of presetConfigs) {
    for (const [linterId, config] of Object.entries(presetConfig)) {
      merged[linterId] = { ...merged[linterId], ...config };
    }
  }

  // Apply user config (wins)
  for (const [linterId, config] of Object.entries(userConfig)) {
    merged[linterId] = { ...merged[linterId], ...config };
  }

  return merged;
}

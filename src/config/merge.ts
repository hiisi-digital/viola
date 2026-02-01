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
import { parsePattern, resolvePatternValue } from "./pattern.ts";
import type {
    ResolvedConfig,
    ResolvedScope
} from "./types.ts";
import type { MergeOptions, MergeResult } from "./types/merge.types.ts";

// Re-export types for convenience
export type { MergeOptions, MergeResult } from "./types/merge.types.ts";

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
 * Convert a preset's scope config into ResolvedScope format.
 */
function presetToScopes(preset: ViolaConfigPreset): ResolvedScope[] {
  const scopes: ResolvedScope[] = [];

  for (const [filePattern, scopeConfig] of Object.entries(preset)) {
    const patterns: ResolvedScope["patterns"] = [];

    for (const [patternStr, patternValue] of Object.entries(scopeConfig)) {
      const parsed = parsePattern(patternStr);
      if (!parsed) continue;

      const value = resolvePatternValue(patternValue);
      patterns.push({ pattern: parsed, value });
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

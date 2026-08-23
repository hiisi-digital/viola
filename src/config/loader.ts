//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Configuration loader.
 *
 * Loads viola configuration from viola.config.ts, and from nowhere else.
 */

import { resolve } from "@std/path";
import {
  type Category,
  type Impact,
  ReportLevel,
  type ReportLevelName,
} from "../conditions/vocabulary.ts";
import type {
  ViolaBuilderConfig,
  ViolaBuilderConfigExtended,
} from "./builder.ts";
import { matchesIssuePattern } from "./pattern.ts";
import { matchesGlob } from "../utils/glob.ts";
import type {
  ConfigSource,
  ResolvedConfig,
  ResolvedPatternValue,
} from "./types.ts";

/** The method that says an object is a builder rather than a plain config. */
const BUILDER_MARKER = "build";

/** The field that says an object is a plugin rather than a builder. */
const PLUGIN_MARKER = "linters";

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_EXCLUDE = ["node_modules", ".git", "dist", "build", "coverage"];

/**
 * Load configuration.
 *
 * `viola.config.ts` is the only config, so a project without one gets the
 * defaults rather than a second format's answer. Reading a `viola` block out
 * of `deno.json` used to be the fallback and is gone: it was a second way to
 * say the same thing, it could not express a rule or a condition, and a
 * project carrying both had no way to tell which one was in force.
 */
export async function loadConfig(
  dir: string,
  options: {
    verbose?: boolean;
    configPath?: string;
    preloadedModule?: unknown;
  } = {},
): Promise<
  {
    config: ResolvedConfig;
    sources: ConfigSource[];
    builderConfig?: ViolaBuilderConfigExtended;
  }
> {
  const sources: ConfigSource[] = [];

  // Try viola.config.ts first (or custom config path)
  const configTsPath = options.configPath ?? resolve(dir, "viola.config.ts");

  if (options.verbose) {
    console.log(`[loader] Looking for config at: ${configTsPath}`);
  }

  // Use pre-loaded module if provided (for when running from non-file context)
  const builderConfig = options.preloadedModule
    ? await processModuleDefault(options.preloadedModule, options.verbose)
    : await loadBuilderConfig(configTsPath, options.verbose);

  if (builderConfig) {
    sources.push({
      path: configTsPath,
      type: "viola.config.ts" as ConfigSource["type"],
    });

    if (options.verbose) {
      console.log("Config sources:");
      console.log(`  - ${configTsPath} (viola.config.ts)`);
    }

    const resolved = resolveBuilderConfig(builderConfig);
    return { config: resolved, sources, builderConfig };
  }

  if (options.verbose) {
    console.log(`[loader] No config at ${configTsPath}, using defaults`);
  }

  return { config: defaultConfig(), sources };
}

/**
 * What a project without a config gets.
 *
 * Every linter on, nothing excluded beyond the usual build output. It reports
 * rather than refuses, since a project that has not written a config has not
 * said what it wants refused.
 */
function defaultConfig(): ResolvedConfig {
  return {
    plugins: [],
    inherit: [],
    linterConfig: {},
    scopes: [],
    include: [],
    exclude: [...DEFAULT_EXCLUDE],
    extensions: [...DEFAULT_EXTENSIONS],
  };
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
    BUILDER_MARKER in obj &&
    typeof (obj as unknown as { build: unknown }).build === "function"
  );
}

/**
 * Process an already-loaded module default export into builder config.
 */
async function processModuleDefault(
  defaultExport: unknown,
  verbose = false,
): Promise<ViolaBuilderConfigExtended | null> {
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
    // resolve() where the builder has it: a plugin may supply its linters as a
    // function, and build() refuses while any are undrained rather than
    // returning a config that lints nothing. Older builders have only build().
    const b = defaultExport as {
      build(): ViolaBuilderConfigExtended;
      resolve?: () => Promise<ViolaBuilderConfigExtended>;
    };
    const built = typeof b.resolve === "function"
      ? await b.resolve()
      : b.build();
    if (verbose) {
      console.log(
        `[loader] Built config: ${built.linters.length} linters, ${built.rules.length} rules`,
      );
    }
    return built;
  }

  // If it's already a built config object
  if (
    typeof defaultExport === "object" && PLUGIN_MARKER in defaultExport &&
    "rules" in defaultExport
  ) {
    if (verbose) {
      console.log(`[loader] Config is already built`);
    }
    return defaultExport as ViolaBuilderConfigExtended;
  }

  if (verbose) {
    console.log(`[loader] Config format not recognized`);
  }
  return null;
}

/**
 * Load viola.config.ts and get the builder config.
 */
async function loadBuilderConfig(
  path: string,
  verbose = false,
): Promise<ViolaBuilderConfigExtended | null> {
  try {
    // Check if file exists
    await Deno.stat(path);

    if (verbose) {
      console.log(`[loader] Found config file: ${path}`);
    }

    // Dynamic import the config file
    const module = await import(`file://${path}`);
    return await processModuleDefault(module.default, verbose);
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
export function resolveBuilderConfig(
  config: ViolaBuilderConfig,
): ResolvedConfig {
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

// Re-exported because a config's own pattern matching is what a consumer
// reaching for `resolveIssueSeverity` needs alongside it. Glob matching is
// not here: it lives in `src/utils/glob.ts`, which is the only copy.
export { matchesIssuePattern } from "./pattern.ts";

/**
 * Resolve the severity for an issue given a config and file path.
 */
export function resolveIssueSeverity(
  config: ResolvedConfig,
  filePath: string,
  issueKind: string,
  issueCategory: Category,
  issueImpact: Impact,
  confidence: number,
): ReportLevelName | null {
  let result: ResolvedPatternValue | null = null;

  // Find matching scopes
  for (const scope of config.scopes) {
    if (!matchesGlob(filePath, scope.filePattern)) {
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
    return ReportLevel.Warn;
  }

  // Check confidence threshold
  if (confidence < result.minConfidence) {
    return null; // Filter out
  }

  return result.severity === "off" ? null : result.severity;
}

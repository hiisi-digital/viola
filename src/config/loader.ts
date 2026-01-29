/**
 * Configuration loader.
 *
 * Loads and merges viola configuration from multiple sources:
 * 1. Environment variable VIOLA_CONFIG
 * 2. viola.json in current/parent directories
 * 3. deno.json viola field
 *
 * Subdirectory configs inherit from parents.
 */

import { dirname, join, resolve } from "@std/path";
import type {
  CheckerConfig,
  ConfigSource,
  ResolvedConfig,
  Severity,
  ViolaFileConfig,
} from "./types.ts";

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_EXCLUDE = ["node_modules", ".git", "dist", "build", "coverage"];

/**
 * Load configuration for a given directory.
 */
export async function loadConfig(
  dir: string,
  options: { verbose?: boolean } = {}
): Promise<{ config: ResolvedConfig; sources: ConfigSource[] }> {
  const sources: ConfigSource[] = [];
  const configs: ViolaFileConfig[] = [];

  // 1. Check environment variable
  const envPath = Deno.env.get("VIOLA_CONFIG");
  if (envPath) {
    const envConfig = await loadConfigFile(envPath);
    if (envConfig) {
      configs.push(envConfig);
      sources.push({ path: envPath, type: "env", inherited: false });
    }
  }

  // 2. Walk up directory tree looking for configs
  const dirConfigs = await loadConfigChain(dir);
  for (const { config, source } of dirConfigs) {
    configs.push(config);
    sources.push(source);
  }

  // 3. Merge configs (later configs override earlier)
  const resolved = mergeConfigs(configs);

  if (options.verbose) {
    console.log("Config sources:");
    for (const source of sources) {
      console.log(`  - ${source.path} (${source.type}${source.inherited ? ", inherited" : ""})`);
    }
  }

  return { config: resolved, sources };
}

/**
 * Load config chain from directory up to root.
 */
async function loadConfigChain(
  dir: string
): Promise<Array<{ config: ViolaFileConfig; source: ConfigSource }>> {
  const results: Array<{ config: ViolaFileConfig; source: ConfigSource }> = [];
  let currentDir = resolve(dir);
  const root = resolve("/");
  let isFirst = true;

  while (currentDir !== root) {
    // Try viola.json first
    const violaPath = join(currentDir, "viola.json");
    const violaConfig = await loadConfigFile(violaPath);
    if (violaConfig) {
      results.unshift({
        config: violaConfig,
        source: { path: violaPath, type: "viola.json", inherited: !isFirst },
      });
      isFirst = false;
      currentDir = dirname(currentDir);
      continue;
    }

    // Try deno.json
    const denoPath = join(currentDir, "deno.json");
    const denoConfig = await loadDenoConfig(denoPath);
    if (denoConfig) {
      results.unshift({
        config: denoConfig,
        source: { path: denoPath, type: "deno.json", inherited: !isFirst },
      });
      isFirst = false;
    }

    currentDir = dirname(currentDir);
  }

  return results;
}

/**
 * Load a viola.json config file.
 */
async function loadConfigFile(path: string): Promise<ViolaFileConfig | null> {
  try {
    const text = await Deno.readTextFile(path);
    return JSON.parse(text) as ViolaFileConfig;
  } catch {
    return null;
  }
}

/**
 * Load viola config from deno.json.
 */
async function loadDenoConfig(path: string): Promise<ViolaFileConfig | null> {
  try {
    const text = await Deno.readTextFile(path);
    const deno = JSON.parse(text) as { viola?: ViolaFileConfig };
    return deno.viola ?? null;
  } catch {
    return null;
  }
}

/**
 * Merge multiple configs into a resolved config.
 * Later configs override earlier ones.
 */
function mergeConfigs(configs: ViolaFileConfig[]): ResolvedConfig {
  const resolved: ResolvedConfig = {
    checkers: new Map(),
    scopes: new Map(),
    skip: new Set(),
    include: [],
    exclude: [...DEFAULT_EXCLUDE],
    extensions: [...DEFAULT_EXTENSIONS],
  };

  for (const config of configs) {
    // Merge checkers
    if (config.checkers) {
      for (const checker of config.checkers) {
        const { id, severity, options } = normalizeChecker(checker);
        resolved.checkers.set(id, { severity, options });
      }
    }

    // Merge skip
    if (config.skip) {
      for (const id of config.skip) {
        resolved.skip.add(id);
      }
    }

    // Merge severity overrides
    if (config.severity) {
      for (const [id, severity] of Object.entries(config.severity)) {
        const existing = resolved.checkers.get(id);
        if (existing) {
          existing.severity = severity;
        } else {
          resolved.checkers.set(id, { severity, options: {} });
        }
      }
    }

    // Merge scopes
    if (config.scopes) {
      for (const [pattern, scopeConfig] of Object.entries(config.scopes)) {
        const existing = resolved.scopes.get(pattern) ?? {
          checkers: new Map(),
          skip: new Set(),
        };

        if (scopeConfig.checkers) {
          for (const checker of scopeConfig.checkers) {
            const { id, severity, options } = normalizeChecker(checker);
            existing.checkers.set(id, { severity, options });
          }
        }

        if (scopeConfig.skip) {
          for (const id of scopeConfig.skip) {
            existing.skip.add(id);
          }
        }

        if (scopeConfig.severity) {
          for (const [id, severity] of Object.entries(scopeConfig.severity)) {
            const checkerConfig = existing.checkers.get(id);
            if (checkerConfig) {
              checkerConfig.severity = severity;
            } else {
              existing.checkers.set(id, { severity, options: {} });
            }
          }
        }

        resolved.scopes.set(pattern, existing);
      }
    }

    // Override arrays (don't merge, replace)
    if (config.include) {
      resolved.include = config.include;
    }
    if (config.exclude) {
      resolved.exclude = config.exclude;
    }
    if (config.extensions) {
      resolved.extensions = config.extensions;
    }
  }

  return resolved;
}

/**
 * Normalize a checker config to a consistent format.
 */
function normalizeChecker(checker: CheckerConfig): {
  id: string;
  severity: Severity;
  options: Record<string, unknown>;
} {
  if (typeof checker === "string") {
    return { id: checker, severity: "warning", options: {} };
  }
  return {
    id: checker.id,
    severity: checker.severity ?? "warning",
    options: checker.options ?? {},
  };
}

/**
 * Get the effective checker config for a file path.
 */
export function getCheckersForFile(
  config: ResolvedConfig,
  filePath: string
): Map<string, { severity: Severity; options: Record<string, unknown> }> {
  const result = new Map(config.checkers);

  // Remove globally skipped
  for (const id of config.skip) {
    result.delete(id);
  }

  // Apply scoped configs
  for (const [pattern, scopeConfig] of config.scopes) {
    if (matchesGlob(filePath, pattern)) {
      // Add/override checkers from scope
      for (const [id, checkerConfig] of scopeConfig.checkers) {
        result.set(id, checkerConfig);
      }
      // Remove skipped in scope
      for (const id of scopeConfig.skip) {
        result.delete(id);
      }
    }
  }

  // Filter out "off" severity
  for (const [id, { severity }] of result) {
    if (severity === "off") {
      result.delete(id);
    }
  }

  return result;
}

/**
 * Simple glob matching.
 */
function matchesGlob(path: string, pattern: string): boolean {
  // Convert glob to regex
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, "{{DOUBLESTAR}}")
        .replace(/\*/g, "[^/]*")
        .replace(/{{DOUBLESTAR}}/g, ".*") +
      "$"
  );
  return regex.test(path);
}

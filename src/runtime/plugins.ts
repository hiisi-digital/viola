/**
 * Viola Plugin Loader
 *
 * Dynamically loads plugin modules and discovers linters exported from them.
 * Plugins can export linters in several ways:
 * - Named exports of BaseLinter instances
 * - A `linters` array export
 * - A default export that is a linter or array of linters
 *
 * @module
 */

import type { BaseLinter } from "../linters/base.ts";
import { isLinter } from "../linters/base.ts";
import { registry } from "../linters/registry.ts";

/**
 * Result of loading a plugin.
 */
export interface PluginLoadResult {
  /** The plugin specifier that was loaded */
  specifier: string;
  /** Whether the plugin loaded successfully */
  success: boolean;
  /** Linters discovered and registered from this plugin */
  linters: string[];
  /** Error message if loading failed */
  error?: string;
}

/**
 * Result of loading all plugins.
 */
export interface PluginsLoadResult {
  /** Results for each plugin */
  results: PluginLoadResult[];
  /** Total number of linters registered */
  totalLinters: number;
  /** Whether all plugins loaded successfully */
  allSucceeded: boolean;
}

/**
 * Discover linters from a module's exports.
 *
 * Looks for:
 * 1. A `linters` export (array of linters)
 * 2. Individual named exports that are linters
 * 3. A default export that is a linter or array of linters
 *
 * @param exports - The module's exports object
 * @returns Array of discovered linters
 */
function discoverLinters(exports: Record<string, unknown>): BaseLinter[] {
  const discovered: BaseLinter[] = [];
  const seen = new Set<string>();

  // Helper to add a linter if not already seen
  const addLinter = (linter: BaseLinter) => {
    if (!seen.has(linter.meta.id)) {
      seen.add(linter.meta.id);
      discovered.push(linter);
    }
  };

  // Check for `linters` array export (preferred convention)
  if (Array.isArray(exports.linters)) {
    for (const item of exports.linters) {
      if (isLinter(item)) {
        addLinter(item);
      }
    }
  }

  // Check all named exports
  for (const [key, value] of Object.entries(exports)) {
    // Skip the linters array we already processed
    if (key === "linters") continue;
    // Skip default export (handled separately)
    if (key === "default") continue;

    if (isLinter(value)) {
      addLinter(value);
    }
  }

  // Check default export
  if (exports.default !== undefined) {
    const defaultExport = exports.default;

    if (isLinter(defaultExport)) {
      addLinter(defaultExport);
    } else if (Array.isArray(defaultExport)) {
      for (const item of defaultExport) {
        if (isLinter(item)) {
          addLinter(item);
        }
      }
    }
  }

  return discovered;
}

/**
 * Load a single plugin module and register its linters.
 *
 * @param specifier - Import specifier (JSR, npm, URL, or import map reference)
 * @returns Result of loading the plugin
 */
export async function loadPlugin(specifier: string): Promise<PluginLoadResult> {
  try {
    // Dynamically import the plugin module
    const module = await import(specifier) as Record<string, unknown>;

    // Discover linters in the module
    const linters = discoverLinters(module);

    // Register each discovered linter
    const registeredIds: string[] = [];
    for (const linter of linters) {
      // Only register if not already registered
      if (!registry.has(linter.meta.id)) {
        registry.register(linter);
        registeredIds.push(linter.meta.id);
      } else {
        // Already registered (maybe from another plugin or duplicate)
        registeredIds.push(linter.meta.id);
      }
    }

    return {
      specifier,
      success: true,
      linters: registeredIds,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      specifier,
      success: false,
      linters: [],
      error: message,
    };
  }
}

/**
 * Load multiple plugin modules and register their linters.
 *
 * @param specifiers - Array of import specifiers
 * @param options - Loading options
 * @returns Results of loading all plugins
 */
export async function loadPlugins(
  specifiers: string[],
  options: { verbose?: boolean; parallel?: boolean } = {}
): Promise<PluginsLoadResult> {
  const results: PluginLoadResult[] = [];

  if (options.parallel) {
    // Load all plugins in parallel
    const promises = specifiers.map((spec) => loadPlugin(spec));
    results.push(...(await Promise.all(promises)));
  } else {
    // Load plugins sequentially
    for (const specifier of specifiers) {
      if (options.verbose) {
        console.log(`Loading plugin: ${specifier}...`);
      }

      const result = await loadPlugin(specifier);
      results.push(result);

      if (options.verbose) {
        if (result.success) {
          console.log(`  Registered ${result.linters.length} linter(s): ${result.linters.join(", ")}`);
        } else {
          console.log(`  Failed: ${result.error}`);
        }
      }
    }
  }

  // Count total linters registered
  const totalLinters = results.reduce((sum, r) => sum + r.linters.length, 0);
  const allSucceeded = results.every((r) => r.success);

  return {
    results,
    totalLinters,
    allSucceeded,
  };
}

/**
 * Clear all registered linters.
 * Useful for testing or reloading plugins.
 */
export function clearLinters(): void {
  registry.clear();
}

/**
 * Get list of all registered linter IDs.
 */
export function getRegisteredLinters(): string[] {
  return registry.getIds();
}

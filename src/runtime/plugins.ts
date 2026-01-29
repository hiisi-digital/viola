/**
 * Viola Plugin Loader
 *
 * Dynamically loads plugin modules and discovers all exports:
 * - linters: Array of BaseLinter instances
 * - bundles: Named collections of linters
 * - configPresets: Configuration presets that can be inherited
 * - schemas: JSON schemas for validating per-linter config
 *
 * @module
 */

import type { BaseLinter } from "../linters/base.ts";
import { isLinter } from "../linters/base.ts";
import { registry } from "../linters/registry.ts";
import type {
    DiscoveredBundle,
    DiscoveredPreset,
    DiscoveredSchema,
    JSONSchema,
    PluginDiscoveryResult,
    PluginsDiscoveryResult,
    ViolaConfigPreset,
} from "../types/plugin.ts";
import { derivePluginName, qualifiedName } from "../types/plugin.ts";

// =============================================================================
// Legacy Types (for backwards compatibility)
// =============================================================================

/**
 * Result of loading a plugin (legacy format).
 * @deprecated Use PluginDiscoveryResult instead
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
 * Result of loading all plugins (legacy format).
 * @deprecated Use PluginsDiscoveryResult instead
 */
export interface PluginsLoadResult {
  /** Results for each plugin */
  results: PluginLoadResult[];
  /** Total number of linters registered */
  totalLinters: number;
  /** Whether all plugins loaded successfully */
  allSucceeded: boolean;
}

// =============================================================================
// Discovery Functions
// =============================================================================

/**
 * Discover linters from a module's exports.
 *
 * Looks for:
 * 1. A `linters` export (array of linters)
 * 2. Individual named exports that are linters
 * 3. A default export that is a linter or array of linters
 */
function discoverLinters(exports: Record<string, unknown>): BaseLinter[] {
  const discovered: BaseLinter[] = [];
  const seen = new Set<string>();

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
    if (key === "linters" || key === "default") continue;
    if (key === "bundles" || key === "configPresets" || key === "schemas") continue;

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
 * Discover bundles from a module's exports.
 */
function discoverBundles(
  exports: Record<string, unknown>,
  pluginName: string
): DiscoveredBundle[] {
  const bundles: DiscoveredBundle[] = [];

  const bundlesExport = exports.bundles;
  if (bundlesExport && typeof bundlesExport === "object" && !Array.isArray(bundlesExport)) {
    for (const [name, linters] of Object.entries(bundlesExport as Record<string, unknown>)) {
      if (!Array.isArray(linters)) continue;

      const validLinters: BaseLinter[] = [];
      for (const item of linters) {
        if (isLinter(item)) {
          validLinters.push(item);
        }
      }

      if (validLinters.length > 0) {
        bundles.push({
          name,
          linters: validLinters,
          pluginName,
        });
      }
    }
  }

  return bundles;
}

/**
 * Check if a value looks like a config preset (object of scope configs).
 */
function isConfigPreset(value: unknown): value is ViolaConfigPreset {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  // A preset should have string keys mapping to objects (scope configs)
  for (const [key, scopeConfig] of Object.entries(value)) {
    // Keys should be glob-like patterns
    if (typeof key !== "string") return false;

    // Values should be objects (scope configs)
    if (!scopeConfig || typeof scopeConfig !== "object" || Array.isArray(scopeConfig)) {
      return false;
    }
  }

  return true;
}

/**
 * Discover config presets from a module's exports.
 */
function discoverPresets(
  exports: Record<string, unknown>,
  pluginName: string
): DiscoveredPreset[] {
  const presets: DiscoveredPreset[] = [];

  const presetsExport = exports.configPresets;
  if (presetsExport && typeof presetsExport === "object" && !Array.isArray(presetsExport)) {
    for (const [name, config] of Object.entries(presetsExport as Record<string, unknown>)) {
      if (isConfigPreset(config)) {
        presets.push({
          name,
          config,
          pluginName,
          isDefault: name === "default",
        });
      }
    }
  }

  return presets;
}

/**
 * Check if a value looks like a JSON schema.
 */
function isJSONSchema(value: unknown): value is JSONSchema {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // A JSON schema typically has a type, properties, or other schema keywords
  return (
    "type" in obj ||
    "properties" in obj ||
    "items" in obj ||
    "oneOf" in obj ||
    "anyOf" in obj ||
    "allOf" in obj ||
    "$ref" in obj
  );
}

/**
 * Discover schemas from a module's exports.
 */
function discoverSchemas(
  exports: Record<string, unknown>,
  pluginName: string
): DiscoveredSchema[] {
  const schemas: DiscoveredSchema[] = [];

  const schemasExport = exports.schemas;
  if (schemasExport && typeof schemasExport === "object" && !Array.isArray(schemasExport)) {
    for (const [linterId, schema] of Object.entries(schemasExport as Record<string, unknown>)) {
      if (isJSONSchema(schema)) {
        schemas.push({
          linterId,
          schema,
          pluginName,
        });
      }
    }
  }

  return schemas;
}

// =============================================================================
// Plugin Loading (Full Discovery)
// =============================================================================

/**
 * Load a single plugin module and discover all its exports.
 */
export async function discoverPlugin(specifier: string): Promise<PluginDiscoveryResult> {
  const pluginName = derivePluginName(specifier);

  try {
    const module = await import(specifier) as Record<string, unknown>;

    const linters = discoverLinters(module);
    const bundles = discoverBundles(module, pluginName);
    const presets = discoverPresets(module, pluginName);
    const schemas = discoverSchemas(module, pluginName);

    return {
      specifier,
      pluginName,
      success: true,
      linters,
      bundles,
      presets,
      schemas,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      specifier,
      pluginName,
      success: false,
      error: message,
      linters: [],
      bundles: [],
      presets: [],
      schemas: [],
    };
  }
}

/**
 * Load multiple plugin modules and aggregate all discoveries.
 */
export async function discoverPlugins(
  specifiers: string[],
  options: { verbose?: boolean; parallel?: boolean } = {}
): Promise<PluginsDiscoveryResult> {
  const results: PluginDiscoveryResult[] = [];

  if (options.parallel) {
    const promises = specifiers.map((spec) => discoverPlugin(spec));
    results.push(...(await Promise.all(promises)));
  } else {
    for (const specifier of specifiers) {
      if (options.verbose) {
        console.log(`Loading plugin: ${specifier}...`);
      }

      const result = await discoverPlugin(specifier);
      results.push(result);

      if (options.verbose) {
        if (result.success) {
          console.log(`  Linters: ${result.linters.length}`);
          console.log(`  Bundles: ${result.bundles.length}`);
          console.log(`  Presets: ${result.presets.length}`);
          console.log(`  Schemas: ${result.schemas.length}`);
        } else {
          console.log(`  Failed: ${result.error}`);
        }
      }
    }
  }

  // Aggregate all discoveries
  const allLinters: BaseLinter[] = [];
  const allBundles = new Map<string, DiscoveredBundle>();
  const allPresets = new Map<string, DiscoveredPreset>();
  const allSchemas = new Map<string, DiscoveredSchema>();
  const defaultPresets: DiscoveredPreset[] = [];
  const bundleCollisions: string[] = [];
  const presetCollisions: string[] = [];

  // Track short names for collision detection
  const bundleShortNames = new Map<string, string[]>(); // shortName -> [fullNames]
  const presetShortNames = new Map<string, string[]>(); // shortName -> [fullNames]

  for (const result of results) {
    if (!result.success) continue;

    // Collect linters
    for (const linter of result.linters) {
      allLinters.push(linter);
    }

    // Collect bundles
    for (const bundle of result.bundles) {
      const fullName = qualifiedName(result.pluginName, bundle.name);
      allBundles.set(fullName, bundle);

      // Track for collision detection
      const existing = bundleShortNames.get(bundle.name) ?? [];
      existing.push(fullName);
      bundleShortNames.set(bundle.name, existing);
    }

    // Collect presets
    for (const preset of result.presets) {
      const fullName = qualifiedName(result.pluginName, preset.name);
      allPresets.set(fullName, preset);

      if (preset.isDefault) {
        defaultPresets.push(preset);
      }

      // Track for collision detection
      const existing = presetShortNames.get(preset.name) ?? [];
      existing.push(fullName);
      presetShortNames.set(preset.name, existing);
    }

    // Collect schemas (keyed by linter ID, last one wins)
    for (const schema of result.schemas) {
      allSchemas.set(schema.linterId, schema);
    }
  }

  // Detect collisions
  for (const [shortName, fullNames] of bundleShortNames) {
    if (fullNames.length > 1) {
      bundleCollisions.push(shortName);
    }
  }

  for (const [shortName, fullNames] of presetShortNames) {
    if (fullNames.length > 1) {
      presetCollisions.push(shortName);
    }
  }

  return {
    results,
    allLinters,
    allBundles,
    allPresets,
    allSchemas,
    defaultPresets,
    allSucceeded: results.every((r) => r.success),
    bundleCollisions,
    presetCollisions,
  };
}

/**
 * Register all discovered linters with the global registry.
 */
export function registerDiscoveredLinters(discovery: PluginsDiscoveryResult): string[] {
  const registeredIds: string[] = [];

  for (const linter of discovery.allLinters) {
    if (!registry.has(linter.meta.id)) {
      registry.register(linter);
    }
    registeredIds.push(linter.meta.id);
  }

  return registeredIds;
}

// =============================================================================
// Legacy Plugin Loading (Simple)
// =============================================================================

/**
 * Load a single plugin module and register its linters.
 * This is the legacy/simple API that only handles linters.
 *
 * @param specifier - Import specifier (JSR, npm, URL, or import map reference)
 * @returns Result of loading the plugin
 */
export async function loadPlugin(specifier: string): Promise<PluginLoadResult> {
  try {
    const module = await import(specifier) as Record<string, unknown>;
    const linters = discoverLinters(module);

    const registeredIds: string[] = [];
    for (const linter of linters) {
      if (!registry.has(linter.meta.id)) {
        registry.register(linter);
        registeredIds.push(linter.meta.id);
      } else {
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
 * This is the legacy/simple API that only handles linters.
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
    const promises = specifiers.map((spec) => loadPlugin(spec));
    results.push(...(await Promise.all(promises)));
  } else {
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

  const totalLinters = results.reduce((sum, r) => sum + r.linters.length, 0);
  const allSucceeded = results.every((r) => r.success);

  return {
    results,
    totalLinters,
    allSucceeded,
  };
}

// =============================================================================
// Bundle Resolution
// =============================================================================

/**
 * Resolve a bundle name to a DiscoveredBundle.
 *
 * @param name - Bundle name (short or qualified)
 * @param discovery - Plugin discovery result
 * @returns The resolved bundle, or null if not found or ambiguous
 */
export function resolveBundle(
  name: string,
  discovery: PluginsDiscoveryResult
): DiscoveredBundle | null {
  // Check if it's a qualified name
  if (name.includes("/")) {
    return discovery.allBundles.get(name) ?? null;
  }

  // Check for collision
  if (discovery.bundleCollisions.includes(name)) {
    return null; // Ambiguous, caller must use qualified name
  }

  // Find the bundle by short name
  for (const [fullName, bundle] of discovery.allBundles) {
    if (bundle.name === name) {
      return bundle;
    }
  }

  return null;
}

/**
 * Resolve a preset name to a DiscoveredPreset.
 *
 * @param name - Preset name (short or qualified)
 * @param discovery - Plugin discovery result
 * @returns The resolved preset, or null if not found or ambiguous
 */
export function resolvePreset(
  name: string,
  discovery: PluginsDiscoveryResult
): DiscoveredPreset | null {
  // Check if it's a qualified name
  if (name.includes("/")) {
    return discovery.allPresets.get(name) ?? null;
  }

  // Check for collision
  if (discovery.presetCollisions.includes(name)) {
    return null; // Ambiguous, caller must use qualified name
  }

  // Find the preset by short name
  for (const [fullName, preset] of discovery.allPresets) {
    if (preset.name === name) {
      return preset;
    }
  }

  return null;
}

// =============================================================================
// Registry Utilities
// =============================================================================

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

//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Plugin Types
 *
 * Defines the interface for viola plugins, including linters, bundles,
 * config presets, and schemas.
 *
 * @module
 */

import type { BaseLinter } from "../linters/base.ts";

// =============================================================================
// JSON Schema Types (subset for plugin schemas)
// =============================================================================

/**
 * JSON Schema type definition (draft-07 subset).
 * Used for validating plugin-specific configuration.
 */
export interface JSONSchema {
  type?:
    | "object"
    | "array"
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "null";
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  additionalProperties?: boolean | JSONSchema;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  allOf?: JSONSchema[];
  $ref?: string;
  $defs?: Record<string, JSONSchema>;
}

// =============================================================================
// Config Preset Types
// =============================================================================

/**
 * Pattern value in a config preset - same as user config.
 */
export type PresetPatternValue =
  | "error"
  | "warn"
  | "info"
  | "off"
  | { severity: "error" | "warn" | "info" | "off"; minConfidence?: number };

/**
 * Scope config in a preset - maps patterns to severities.
 */
export type PresetScopeConfig = Record<string, PresetPatternValue>;

/**
 * A config preset that can be inherited by user config.
 *
 * Structure mirrors the viola config, but without plugins/inherit fields.
 */
export type ViolaConfigPreset = Record<string, PresetScopeConfig>;

// =============================================================================
// Plugin Interface
// =============================================================================

/**
 * A viola plugin module's exports.
 *
 * All fields are optional - a plugin can provide any combination.
 * A minimal plugin just exports a `linters` array.
 */
export interface ViolaPlugin {
  /**
   * Array of linter instances.
   * This is the most common export - most plugins just provide linters.
   */
  linters?: BaseLinter[];

  /**
   * Named bundles of linters.
   * Bundles are curated subsets for convenience (e.g., "strict", "minimal").
   *
   * A bundle named "default" has no special treatment - it's just a name.
   * Users reference bundles via the bundle name or `<plugin>/<bundle>` if ambiguous.
   */
  bundles?: Record<string, BaseLinter[]>;

  /**
   * Named configuration presets.
   *
   * A preset named "default" is automatically applied when the plugin loads.
   * Other presets must be explicitly enabled via the `inherit` field.
   */
  configPresets?: Record<string, ViolaConfigPreset>;

  /**
   * JSON schemas for validating per-linter configuration.
   *
   * Keys are linter IDs. Viola uses these to validate the `config` field
   * in user's viola configuration.
   */
  schemas?: Record<string, JSONSchema>;
}

// =============================================================================
// Plugin Discovery Results
// =============================================================================

/**
 * Information about a single discovered bundle.
 */
export interface DiscoveredBundle {
  /** Bundle name */
  name: string;
  /** Linters in this bundle */
  linters: BaseLinter[];
  /** Plugin this bundle came from */
  pluginName: string;
}

/**
 * Information about a single discovered preset.
 */
export interface DiscoveredPreset {
  /** Preset name */
  name: string;
  /** The preset configuration */
  config: ViolaConfigPreset;
  /** Plugin this preset came from */
  pluginName: string;
  /** Whether this is a default preset (auto-applied) */
  isDefault: boolean;
}

/**
 * Information about a single discovered schema.
 */
export interface DiscoveredSchema {
  /** Linter ID this schema validates */
  linterId: string;
  /** The JSON schema */
  schema: JSONSchema;
  /** Plugin this schema came from */
  pluginName: string;
}

/**
 * Result of discovering all exports from a plugin module.
 */
export interface PluginDiscoveryResult {
  /** The plugin specifier/name */
  specifier: string;
  /** Derived short name for collision resolution */
  pluginName: string;
  /** Whether discovery succeeded */
  success: boolean;
  /** Error message if discovery failed */
  error?: string;
  /** Discovered linters */
  linters: BaseLinter[];
  /** Discovered bundles */
  bundles: DiscoveredBundle[];
  /** Discovered presets */
  presets: DiscoveredPreset[];
  /** Discovered schemas */
  schemas: DiscoveredSchema[];
}

/**
 * Aggregated result of loading all plugins.
 */
export interface PluginsDiscoveryResult {
  /** Results for each plugin */
  results: PluginDiscoveryResult[];
  /** All linters from all plugins */
  allLinters: BaseLinter[];
  /** All bundles from all plugins (keyed by full name: plugin/bundle) */
  allBundles: Map<string, DiscoveredBundle>;
  /** All presets from all plugins (keyed by full name: plugin/preset) */
  allPresets: Map<string, DiscoveredPreset>;
  /** All schemas from all plugins (keyed by linter ID) */
  allSchemas: Map<string, DiscoveredSchema>;
  /** Default presets to auto-apply */
  defaultPresets: DiscoveredPreset[];
  /** Whether all plugins loaded successfully */
  allSucceeded: boolean;
  /** Bundle name collisions detected */
  bundleCollisions: string[];
  /** Preset name collisions detected */
  presetCollisions: string[];
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Derive a short plugin name from an import specifier.
 *
 * Examples:
 * - "@hiisi/viola-default-lints" -> "viola-default-lints"
 * - "jsr:@hiisi/viola-default-lints" -> "viola-default-lints"
 * - "npm:some-plugin" -> "some-plugin"
 * - "./local-plugin.ts" -> "local-plugin"
 * - "https://example.com/plugin.ts" -> "plugin"
 */
export function derivePluginName(specifier: string): string {
  // Remove protocol prefixes
  let name = specifier
    .replace(/^jsr:/, "")
    .replace(/^npm:/, "")
    .replace(/^https?:\/\/[^/]+\//, "");

  // Handle scoped packages: @scope/name -> name
  if (name.startsWith("@")) {
    const parts = name.split("/");
    name = parts[1] ?? parts[0] ?? name;
  }

  // Handle file paths: ./path/to/file.ts -> file
  if (name.includes("/")) {
    const parts = name.split("/");
    name = parts[parts.length - 1] ?? name;
  }

  // Remove file extension
  name = name.replace(/\.(ts|js|mts|mjs)$/, "");

  // Remove version suffix if present: name@1.0.0 -> name
  name = name.replace(/@[\d.]+.*$/, "");

  return name;
}

/**
 * Create a fully qualified name for a bundle or preset.
 */
export function qualifiedName(pluginName: string, itemName: string): string {
  return `${pluginName}/${itemName}`;
}

/**
 * Check if a name is qualified (contains plugin prefix).
 */
export function isQualifiedName(name: string): boolean {
  return name.includes("/");
}

/**
 * Parse a qualified name into plugin and item parts.
 * Returns null if not qualified.
 */
export function parseQualifiedName(
  name: string,
): { pluginName: string; itemName: string } | null {
  if (!isQualifiedName(name)) {
    return null;
  }
  const slashIndex = name.indexOf("/");
  return {
    pluginName: name.slice(0, slashIndex),
    itemName: name.slice(slashIndex + 1),
  };
}

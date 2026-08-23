//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Plugin loading types for viola runtime.
 *
 * Types for plugin loading results and discovery.
 *
 * @module
 */

// =============================================================================
// Plugin Loading Types
// =============================================================================

/**
 * Result of loading a plugin (simple format).
 * For full discovery including bundles/presets/schemas, use PluginDiscoveryResult.
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
 * Result of loading all plugins (simple format).
 * For full discovery including bundles/presets/schemas, use PluginsDiscoveryResult.
 */
export interface PluginsLoadResult {
  /** Results for each plugin */
  results: PluginLoadResult[];
  /** Total number of linters registered */
  totalLinters: number;
  /** Whether all plugins loaded successfully */
  allSucceeded: boolean;
}

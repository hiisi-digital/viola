/**
 * Viola Types Module
 *
 * Exports all type definitions used across viola.
 *
 * @module
 */

export type {
  DiscoveredBundle,
  DiscoveredPreset,
  DiscoveredSchema,
  JSONSchema,
  PluginDiscoveryResult,
  PluginsDiscoveryResult,
  PresetPatternValue,
  PresetScopeConfig,
  ViolaConfigPreset,
  ViolaPlugin,
} from "./plugin.ts";

export {
  derivePluginName,
  isQualifiedName,
  parseQualifiedName,
  qualifiedName,
} from "./plugin.ts";

//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

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

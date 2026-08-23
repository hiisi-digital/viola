//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Viola Runtime Module
 *
 * Exports the crawler, plugin loader, and runtime utilities for the viola lint system.
 *
 * @module
 */

// Crawler
export { crawlCodebase, DEFAULT_CONFIG } from "./crawler.ts";

// Plugin loader
export {
  clearLinters,
  getRegisteredLinters,
  loadPlugin,
  loadPlugins,
  type PluginLoadResult,
  type PluginsLoadResult,
} from "./plugins.ts";

// Re-export config type from data for convenience
export type { CrawlConfig } from "../data/types.ts";

export {
  catalogsOf,
  DEFAULT_INCLUDE,
  type ProjectRunOptions,
  registerBuilderLinters,
  type ResolvedRun,
  resolveRun,
} from "./project.ts";

export type { ViolaOptions } from "./types/run.types.ts";

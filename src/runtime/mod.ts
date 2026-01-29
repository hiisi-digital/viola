/**
 * Viola Runtime Module
 *
 * Exports the crawler and runtime utilities for the viola lint system.
 *
 * @module
 */

// Crawler
export { crawlCodebase, DEFAULT_CONFIG } from "./crawler.ts";

// Re-export config type from data for convenience
export type { ViolaConfig } from "../data/types.ts";

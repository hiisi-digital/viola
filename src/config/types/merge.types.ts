/**
 * Merge types for viola configuration.
 *
 * Types for configuration merging operations.
 *
 * @module
 */

import type { ResolvedScope } from "../types.ts";

// =============================================================================
// Merge Types
// =============================================================================

/**
 * Result of merging presets with user config.
 */
export interface MergeResult {
  /** Merged scopes (presets first, then user) */
  scopes: ResolvedScope[];
  /** Warnings generated during merge */
  warnings: string[];
  /** Presets that were applied */
  appliedPresets: string[];
}

/**
 * Options for merging configuration.
 */
export interface MergeOptions {
  /** Whether to log verbose output */
  verbose?: boolean;
}

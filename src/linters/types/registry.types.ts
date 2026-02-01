/**
 * Linter registry types for viola.
 *
 * Types for linter registration and running.
 *
 * @module
 */

import type { LinterConfig } from "../../data/types.ts";

// =============================================================================
// Registry Types
// =============================================================================

/**
 * Options for running linters.
 */
export interface RunOptions {
  /** Only run these linters (by ID) */
  readonly only?: readonly string[];
  /** Skip these linters (by ID) */
  readonly skip?: readonly string[];
  /** Per-linter configuration */
  readonly config?: Record<string, LinterConfig>;
  /** Run linters in parallel */
  readonly parallel?: boolean;
  /** Verbose output */
  readonly verbose?: boolean;
}

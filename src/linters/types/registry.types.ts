//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Linter registry types for viola.
 *
 * Types for linter registration and running.
 *
 * @module
 */

import type { LinterConfig } from "../../data/types.ts";
import type { LinterRegistry } from "../registry.ts";

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
  /**
   * Which registry to run.
   *
   * Defaults to the module-level one, which is the singleton every consumer
   * has been getting implicitly. Naming it here is what lets two lint sets
   * exist in one process at all: without it `runLinters` closes over shared
   * mutable state, so a second caller sees whatever the first registered and
   * a test cannot isolate its own fixtures from the real linters.
   */
  readonly registry?: LinterRegistry;
}

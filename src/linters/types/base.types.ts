//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Linter base types for viola.
 *
 * Types for linter metadata and data requirements.
 *
 * @module
 */

// =============================================================================
// Linter Metadata Types
// =============================================================================

/**
 * Metadata describing a linter.
 */
export interface LinterMeta {
  /** Unique linter ID (e.g., "type-location", "similar-functions") */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Description of what this linter checks */
  readonly description: string;
  /** Documentation URL (optional) */
  readonly docsUrl?: string;
}

/**
 * Data requirements for a linter.
 * Linters declare what data they need and the runtime provides only that.
 */
export interface LinterDataRequirements {
  /** Need function information */
  readonly functions?: boolean;
  /** Need type/interface information */
  readonly types?: boolean;
  /** Need string literal information */
  readonly strings?: boolean;
  /** Need export information */
  readonly exports?: boolean;
  /** Need import information */
  readonly imports?: boolean;
  /** Need schema information */
  readonly schemas?: boolean;
  /** Need raw file content (for linters that do their own parsing) */
  readonly content?: boolean;
  /** Need full file information */
  readonly files?: boolean;
}

/**
 * Constructor type for linters.
 */
export interface LinterConstructor {
  new (): import("../base.ts").BaseLinter;
}

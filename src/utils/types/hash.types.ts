/**
 * Hash utility types for viola.
 *
 * Types for code fingerprinting and hashing.
 *
 * @module
 */

// =============================================================================
// Hash Types
// =============================================================================

/**
 * A fingerprint is a collection of hashes for different aspects of code.
 */
export interface CodeFingerprint {
  /** Hash of raw content */
  readonly raw: string;
  /** Hash of normalized content (whitespace normalized) */
  readonly normalized: string;
  /** Hash of structure (identifiers replaced) */
  readonly structural: string;
  /** Content length */
  readonly length: number;
  /** Line count */
  readonly lines: number;
}

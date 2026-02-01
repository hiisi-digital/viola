/**
 * Similarity utility types for viola.
 *
 * Types for similarity comparison and matching.
 *
 * @module
 */

// =============================================================================
// Similarity Types
// =============================================================================

/**
 * Similarity thresholds for classification.
 */
export interface SimilarityThresholds {
  /** Below this = no match */
  readonly low: number;
  /** Above this = warning (medium similarity) */
  readonly medium: number;
  /** Above this = error (high similarity) */
  readonly high: number;
}

/**
 * Similarity classification result.
 */
export type SimilarityLevel = "none" | "low" | "medium" | "high" | "exact";

/**
 * Result of comparing an item against many others.
 */
export interface SimilarityMatch<T> {
  /** The matched item */
  readonly item: T;
  /** Similarity score */
  readonly similarity: number;
  /** Similarity level */
  readonly level: SimilarityLevel;
}

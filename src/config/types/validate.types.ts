/**
 * Validation types for viola configuration.
 *
 * Types for configuration validation results.
 *
 * @module
 */

// =============================================================================
// Validation Types
// =============================================================================

/**
 * A validation error.
 */
export interface ValidationError {
  /** Path to the invalid value (e.g., "type-location.allowedDirs[0]") */
  path: string;
  /** Error message */
  message: string;
  /** The invalid value */
  value?: unknown;
}

/**
 * Result of validating linter config.
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors (empty if valid) */
  errors: ValidationError[];
  /** Warnings (e.g., unknown linter IDs) */
  warnings: string[];
}

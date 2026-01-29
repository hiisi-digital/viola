/**
 * Viola Base Linter
 *
 * Abstract base class for all linters. Each linter declares what data it needs
 * and implements the lint() method to find violations.
 *
 * @module
 */

import type {
    CodebaseData,
    LinterConfig,
    LinterResult,
    Violation,
    ViolationSeverity,
} from "../data/types.ts";

// =============================================================================
// Linter Metadata
// =============================================================================

/**
 * Metadata describing a linter.
 */
export interface LinterMeta {
  /** Unique linter ID */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Description of what this linter checks */
  readonly description: string;
  /** Default severity for violations */
  readonly defaultSeverity: ViolationSeverity;
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
  /** Need deprecation information */
  readonly deprecations?: boolean;
  /** Need full file information */
  readonly files?: boolean;
}

// =============================================================================
// Base Linter Class
// =============================================================================

/**
 * Abstract base class for all viola linters.
 *
 * Linters extend this class and implement:
 * - meta: Metadata about the linter
 * - requirements: What data the linter needs
 * - lint(): The actual linting logic
 *
 * @example
 * ```ts
 * class MyLinter extends BaseLinter {
 *   readonly meta: LinterMeta = {
 *     id: "my-linter",
 *     name: "My Linter",
 *     description: "Checks for something",
 *     defaultSeverity: "warning",
 *   };
 *
 *   readonly requirements: LinterDataRequirements = {
 *     functions: true,
 *   };
 *
 *   lint(data: CodebaseData, config: LinterConfig): Violation[] {
 *     const violations: Violation[] = [];
 *     // ... check data.allFunctions ...
 *     return violations;
 *   }
 * }
 * ```
 */
export abstract class BaseLinter {
  /**
   * Metadata describing this linter.
   */
  abstract readonly meta: LinterMeta;

  /**
   * Data requirements for this linter.
   */
  abstract readonly requirements: LinterDataRequirements;

  /**
   * Run the linter and return violations.
   *
   * @param data - Frozen codebase data
   * @param config - Linter configuration
   * @returns Array of violations found
   */
  abstract lint(data: CodebaseData, config: LinterConfig): Violation[];

  /**
   * Run the linter with timing and error handling.
   *
   * @param data - Frozen codebase data
   * @param config - Linter configuration
   * @returns Linter result with violations and timing
   */
  run(data: CodebaseData, config: LinterConfig): LinterResult {
    const startTime = performance.now();

    try {
      const violations = this.lint(data, config);
      const durationMs = performance.now() - startTime;

      return {
        linter: this.meta.id,
        violations,
        durationMs,
        success: true,
      };
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        linter: this.meta.id,
        violations: [],
        durationMs,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Create a violation with this linter's info pre-filled.
   *
   * @param violation - Partial violation (without linter field)
   * @param config - Linter config for severity override
   * @returns Complete violation
   */
  protected createViolation(
    violation: Omit<Violation, "linter" | "severity"> & {
      severity?: ViolationSeverity;
    },
    config?: LinterConfig
  ): Violation {
    return {
      linter: this.meta.id,
      severity:
        config?.severity ?? violation.severity ?? this.meta.defaultSeverity,
      ...violation,
    };
  }

  /**
   * Create an error-level violation.
   */
  protected error(
    code: string,
    message: string,
    location: Violation["location"],
    extra?: Partial<Omit<Violation, "linter" | "severity" | "code" | "message" | "location">>
  ): Violation {
    return {
      linter: this.meta.id,
      severity: "error",
      code,
      message,
      location,
      ...extra,
    };
  }

  /**
   * Create a warning-level violation.
   */
  protected warning(
    code: string,
    message: string,
    location: Violation["location"],
    extra?: Partial<Omit<Violation, "linter" | "severity" | "code" | "message" | "location">>
  ): Violation {
    return {
      linter: this.meta.id,
      severity: "warning",
      code,
      message,
      location,
      ...extra,
    };
  }

  /**
   * Create an info-level violation.
   */
  protected info(
    code: string,
    message: string,
    location: Violation["location"],
    extra?: Partial<Omit<Violation, "linter" | "severity" | "code" | "message" | "location">>
  ): Violation {
    return {
      linter: this.meta.id,
      severity: "info",
      code,
      message,
      location,
      ...extra,
    };
  }
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Constructor type for linters.
 */
export type LinterConstructor = new () => BaseLinter;

/**
 * Check if an object is a linter.
 */
export function isLinter(obj: unknown): obj is BaseLinter {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "meta" in obj &&
    "requirements" in obj &&
    "lint" in obj &&
    typeof (obj as BaseLinter).lint === "function"
  );
}

/**
 * Viola Base Linter
 *
 * Abstract base class for all linters (rules). Each linter declares:
 * - meta: Basic info about the rule
 * - catalog: All issue kinds it can emit with their category/impact
 * - requirements: What codebase data it needs
 * - lint(): The actual linting logic
 *
 * @module
 */

import type {
    IssueCatalog,
    IssueCategory,
    IssueDef,
    IssueImpact,
} from "../config/types.ts";
import type {
    CodebaseData,
    LinterConfig,
    LinterResult,
    SourceLocation,
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
  /** Unique linter ID (e.g., "type-location", "similar-functions") */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Description of what this linter checks */
  readonly description: string;
  /** Default severity (for backward compatibility) */
  readonly defaultSeverity?: ViolationSeverity;
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
// Issue Types (New System)
// =============================================================================

/**
 * An issue emitted by a linter (new system).
 */
export interface Issue {
  /** Issue kind in format "rule-id/issue-name" */
  kind: string;
  /** Source location where issue was found */
  location: SourceLocation;
  /** Human-readable message */
  message: string;
  /** Confidence score 0-100 (how sure is the linter) */
  confidence: number;
  /** Optional suggestion for fixing */
  suggestion?: string;
  /** Related locations (e.g., duplicate found at these locations) */
  relatedLocations?: SourceLocation[];
  /** Additional context data */
  context?: Record<string, unknown>;
}

/**
 * Result of running a linter (new system).
 */
export interface RuleResult {
  /** Rule ID */
  rule: string;
  /** Issues found */
  issues: Issue[];
  /** Time taken in milliseconds */
  durationMs: number;
  /** Whether the run completed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Base Linter Class
// =============================================================================

/**
 * Abstract base class for all viola linters.
 *
 * Supports both old Violation-based API and new Issue-based API for
 * gradual migration.
 */
export abstract class BaseLinter {
  /**
   * Metadata describing this linter.
   */
  abstract readonly meta: LinterMeta;

  /**
   * Catalog of all issue kinds this linter can emit.
   * Keys must be in format "rule-id/issue-name".
   * 
   * Optional for backward compatibility - linters without catalog
   * use the old Violation system.
   */
  readonly catalog: IssueCatalog = {};

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
   * Get the definition for an issue kind.
   */
  getIssueDef(kind: string): IssueDef | undefined {
    return this.catalog[kind];
  }

  /**
   * Get category for an issue kind.
   */
  getCategory(kind: string): IssueCategory {
    return this.catalog[kind]?.category ?? "consistency";
  }

  /**
   * Get impact for an issue kind.
   */
  getImpact(kind: string): IssueImpact {
    return this.catalog[kind]?.impact ?? "minor";
  }

  /**
   * Create a violation with this linter's info pre-filled.
   * (Backward compatibility)
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
        config?.severity ?? violation.severity ?? this.meta.defaultSeverity ?? "warning",
      ...violation,
    };
  }

  /**
   * Create an error-level violation.
   * (Backward compatibility)
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
   * (Backward compatibility)
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
   * (Backward compatibility)
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

  /**
   * Create an issue with this linter's info (new system).
   *
   * @param issueKind - The issue kind (e.g., "bad-thing", will be prefixed with rule id)
   * @param location - Source location
   * @param message - Human-readable message
   * @param options - Additional options
   */
  protected issue(
    issueKind: string,
    location: SourceLocation,
    message: string,
    options: {
      confidence?: number;
      suggestion?: string;
      relatedLocations?: SourceLocation[];
      context?: Record<string, unknown>;
    } = {}
  ): Issue {
    const kind = issueKind.includes("/") 
      ? issueKind 
      : `${this.meta.id}/${issueKind}`;
    
    const def = this.catalog[kind];
    const defaultConfidence = def?.defaultConfidence ?? 80;

    return {
      kind,
      location,
      message,
      confidence: options.confidence ?? defaultConfidence,
      suggestion: options.suggestion,
      relatedLocations: options.relatedLocations,
      context: options.context,
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

/**
 * Viola Base Linter
 *
 * Abstract base class for all linters. Each linter declares:
 * - meta: Basic info about the linter
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
    Issue,
    LinterConfig,
    LinterResult,
    SourceLocation,
} from "../data/types.ts";
import type {
    LinterDataRequirements,
    LinterMeta,
} from "./types/base.types.ts";

// Re-export types for convenience
export type {
    LinterConstructor,
    LinterDataRequirements,
    LinterMeta
} from "./types/base.types.ts";

// =============================================================================
// Base Linter Class
// =============================================================================

/**
 * Abstract base class for all viola linters.
 */
export abstract class BaseLinter {
  /**
   * Metadata describing this linter.
   */
  abstract readonly meta: LinterMeta;

  /**
   * Catalog of all issue kinds this linter can emit.
   * Keys must be in format "linter-id/issue-name".
   */
  abstract readonly catalog: IssueCatalog;

  /**
   * Data requirements for this linter.
   */
  abstract readonly requirements: LinterDataRequirements;

  /**
   * Run the linter and return issues.
   *
   * @param data - Frozen codebase data
   * @param config - Linter configuration
   * @returns Array of issues found
   */
  abstract lint(data: CodebaseData, config: LinterConfig): Issue[];

  /**
   * Run the linter with timing and error handling.
   *
   * @param data - Frozen codebase data
   * @param config - Linter configuration
   * @returns Linter result with issues and timing
   */
  run(data: CodebaseData, config: LinterConfig): LinterResult {
    const startTime = performance.now();

    try {
      const issues = this.lint(data, config);
      const durationMs = performance.now() - startTime;

      return {
        linter: this.meta.id,
        issues,
        durationMs,
        success: true,
      };
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        linter: this.meta.id,
        issues: [],
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
   * Create an issue with this linter's info.
   *
   * @param issueKind - The issue kind (e.g., "duplicate-string") - will be prefixed with linter id
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
// Type Guard
// =============================================================================

/**
 * Check if an object is a linter.
 */
export function isLinter(obj: unknown): obj is BaseLinter {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "meta" in obj &&
    "catalog" in obj &&
    "requirements" in obj &&
    "lint" in obj &&
    typeof (obj as BaseLinter).lint === "function"
  );
}

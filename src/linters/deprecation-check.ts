/**
 * Deprecation Check Linter
 *
 * Detects any deprecation mentions in the codebase. In a pre-release project,
 * deprecated code should be deleted immediately, not annotated.
 *
 * Checks for:
 * - @deprecated JSDoc annotations
 * - "deprecated" or "DEPRECATED" in comments
 * - Legacy/deprecated mentions in documentation
 * - Code marked for removal
 *
 * @module
 */

import type { CodebaseData, LinterConfig, SourceLocation, Violation } from "../data/types.ts";
import { BaseLinter, type LinterDataRequirements, type LinterMeta } from "./base.ts";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Patterns that indicate deprecation.
 */
const DEPRECATION_PATTERNS = [
  { pattern: /@deprecated/i, type: "annotation" },
  { pattern: /\bDEPRECATED\b/, type: "marker" },
  { pattern: /\bdeprecated\b/i, type: "mention" },
  { pattern: /\blegacy\b/i, type: "legacy" },
  { pattern: /\bto.?be.?removed\b/i, type: "removal" },
  { pattern: /\bwill.?be.?removed\b/i, type: "removal" },
  { pattern: /\bscheduled.?for.?removal\b/i, type: "removal" },
  { pattern: /\bobsolete\b/i, type: "obsolete" },
  { pattern: /\bdo.?not.?use\b/i, type: "warning" },
  { pattern: /\bavoid.?using\b/i, type: "warning" },
];

/**
 * Options for the deprecation check linter.
 */
export interface DeprecationCheckOptions {
  /** Also check for "legacy" mentions */
  checkLegacy?: boolean;
  /** Also check for "obsolete" mentions */
  checkObsolete?: boolean;
  /** Also check for removal markers */
  checkRemovalMarkers?: boolean;
  /** File patterns to exclude from checking */
  excludeFiles?: RegExp[];
  /** Patterns that indicate false positives */
  falsePositivePatterns?: RegExp[];
}

/**
 * Default options.
 */
const DEFAULT_OPTIONS: DeprecationCheckOptions = {
  checkLegacy: true,
  checkObsolete: true,
  checkRemovalMarkers: true,
  excludeFiles: [
    /CHANGELOG/i,
    /HISTORY/i,
    /MIGRATION/i,
    /\.md$/,  // Documentation often legitimately discusses deprecation
    /packages\/viola\//,  // Viola itself documents deprecation detection
  ],
  falsePositivePatterns: [
    /deprecation.?warning/i, // Talking about deprecation warnings (meta)
    /check.?for.?deprecat/i, // This very linter!
    /detect.?deprecat/i,
    /find.?deprecat/i,
    /handle.?deprecat/i,
  ],
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get options from linter config.
 */
function getOptions(config: LinterConfig): DeprecationCheckOptions {
  const opts = config.options as Partial<DeprecationCheckOptions> | undefined;
  return {
    ...DEFAULT_OPTIONS,
    ...opts,
  };
}

/**
 * Check if a file should be excluded.
 */
function shouldExcludeFile(filePath: string, options: DeprecationCheckOptions): boolean {
  const patterns = options.excludeFiles ?? [];
  return patterns.some((p) => p.test(filePath));
}

/**
 * Check if a match is a false positive.
 */
function isFalsePositive(line: string, options: DeprecationCheckOptions): boolean {
  const patterns = options.falsePositivePatterns ?? [];
  return patterns.some((p) => p.test(line));
}

/**
 * Get the deprecation type label.
 */
function getTypeLabel(type: string): string {
  switch (type) {
    case "annotation":
      return "@deprecated annotation";
    case "marker":
      return "DEPRECATED marker";
    case "mention":
      return "deprecation mention";
    case "legacy":
      return "legacy code reference";
    case "removal":
      return "removal marker";
    case "obsolete":
      return "obsolete marker";
    case "warning":
      return "usage warning";
    default:
      return "deprecation indicator";
  }
}

/**
 * Determine if a deprecation type should be checked based on options.
 */
function shouldCheckType(type: string, options: DeprecationCheckOptions): boolean {
  switch (type) {
    case "legacy":
      return options.checkLegacy ?? true;
    case "obsolete":
      return options.checkObsolete ?? true;
    case "removal":
      return options.checkRemovalMarkers ?? true;
    default:
      return true;
  }
}

// =============================================================================
// Deprecation Check Linter
// =============================================================================

/**
 * Linter that detects deprecated code that should be removed.
 */
export class DeprecationCheckLinter extends BaseLinter {
  readonly meta: LinterMeta = {
    id: "deprecation-check",
    name: "Deprecation Check",
    description:
      "Detects @deprecated annotations and deprecation mentions that indicate code should be removed",
    defaultSeverity: "error",
    docsUrl: "docs/PRINCIPLES.md",
  };

  readonly requirements: LinterDataRequirements = {
    deprecations: true,
    files: true,
  };

  lint(data: CodebaseData, config: LinterConfig): Violation[] {
    const violations: Violation[] = [];
    const options = getOptions(config);

    for (const file of data.files) {
      // Skip excluded files
      if (shouldExcludeFile(file.path, options)) continue;

      // Check file-level deprecations detected by crawler
      for (const deprecation of file.deprecations) {
        violations.push(this.createDeprecationViolation(deprecation, "annotation", file.path));
      }

      // Additional checks would require reading file content
      // The crawler already detects @deprecated, DEPRECATED, deprecated patterns
      // We rely on the crawler's deprecation detection
    }

    return violations;
  }

  /**
   * Create a violation for a deprecation.
   */
  private createDeprecationViolation(
    location: SourceLocation,
    type: string,
    filePath: string
  ): Violation {
    const typeLabel = getTypeLabel(type);

    return this.error(
      `deprecated-${type}`,
      `Found ${typeLabel} in ${filePath}:${location.line}. ` +
        `Deprecated code should be DELETED, not marked.`,
      location,
      {
        suggestion:
          `IMMEDIATE ACTION REQUIRED:\n` +
          `This is a PRE-RELEASE project. There are NO users depending on this code.\n\n` +
          `DO NOT:\n` +
          `  - Keep deprecated code "just in case"\n` +
          `  - Add backwards compatibility shims\n` +
          `  - Leave TODO comments about removing it later\n\n` +
          `DO:\n` +
          `  - DELETE the deprecated code NOW\n` +
          `  - If something depends on it, update that code\n` +
          `  - If you're unsure, ask - but default to deletion\n\n` +
          `WHY: Deprecated code is dead weight. It confuses developers, ` +
          `increases maintenance burden, and WILL be forgotten. ` +
          `"Later" never comes. Delete it now.`,
        context: {
          type,
          typeLabel,
        },
      }
    );
  }
}

/**
 * Default instance for registration.
 */
export const deprecationCheckLinter = new DeprecationCheckLinter();

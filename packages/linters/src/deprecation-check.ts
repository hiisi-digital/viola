/**
 * Deprecation Check Linter
 *
 * Detects any deprecation mentions in the codebase. In a pre-release project,
 * deprecated code should be deleted immediately, not annotated.
 *
 * This linter is fully self-contained - it extracts deprecation information
 * directly from file content rather than relying on the crawler.
 *
 * Checks for:
 * - @deprecated JSDoc annotations
 * - "deprecated" or "DEPRECATED" in comments
 * - Legacy/deprecated mentions in documentation
 * - Code marked for removal
 *
 * @module
 */

import {
    BaseLinter,
    type CodebaseData,
    type LinterConfig,
    type LinterDataRequirements,
    type LinterMeta,
    type SourceLocation,
    type Violation,
} from "@hiisi/viola";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Patterns that indicate deprecation.
 */
const DEPRECATION_PATTERNS = [
  { pattern: /@deprecated/i, type: "annotation" },
  { pattern: /\bDEPRECATED\b/, type: "marker" },
  { pattern: /\bis\s+deprecated\b/i, type: "mention" },
  { pattern: /\bare\s+deprecated\b/i, type: "mention" },
  { pattern: /\bmarked\s+(?:as\s+)?deprecated\b/i, type: "mention" },
  { pattern: /\blegacy\b/i, type: "legacy" },
  { pattern: /\bto.?be.?removed\b/i, type: "removal" },
  { pattern: /\bwill.?be.?removed\b/i, type: "removal" },
  { pattern: /\bscheduled.?for.?removal\b/i, type: "removal" },
  { pattern: /\bobsolete\b/i, type: "obsolete" },
  { pattern: /\bdo.?not.?use\b/i, type: "warning" },
  { pattern: /\bavoid.?using\b/i, type: "warning" },
];

/**
 * Patterns that indicate false positives (talking ABOUT deprecation, not actual deprecation).
 */
const FALSE_POSITIVE_PATTERNS = [
  /has\s+any\s+@?deprecated/i,       // "has any @deprecated" - describing a field
  /check.*deprecat/i,                // "check for deprecation"
  /detect.*deprecat/i,               // "detect deprecation"
  /find.*deprecat/i,                 // "find deprecation"
  /deprecation.?pattern/i,           // "deprecation pattern"
  /deprecation.?check/i,             // "deprecation check"
  /deprecation.?linter/i,            // "deprecation linter"
  /deprecation.?mention/i,           // "deprecation mention"
  /deprecation.?marker/i,            // "deprecation marker"
  /deprecation.?warning/i,           // "deprecation warning" (meta)
  /handle.?deprecat/i,               // "handle deprecation"
  /FALSE_POSITIVE/,                  // This file's own constant
  /DEPRECATION_PATTERNS/,            // This file's own constant
];

/**
 * File patterns to exclude from checking.
 */
const EXCLUDED_FILE_PATTERNS = [
  /CHANGELOG/i,
  /HISTORY/i,
  /MIGRATION/i,
  /\.md$/,                           // Documentation often legitimately discusses deprecation
  /deprecation-check\.ts$/,          // This linter itself
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
  /** Additional file patterns to exclude from checking */
  excludeFiles?: RegExp[];
  /** Additional patterns that indicate false positives */
  falsePositivePatterns?: RegExp[];
}

/**
 * Default options.
 */
const DEFAULT_OPTIONS: DeprecationCheckOptions = {
  checkLegacy: false,      // Too noisy by default
  checkObsolete: true,
  checkRemovalMarkers: true,
  excludeFiles: [],
  falsePositivePatterns: [],
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
  // Check built-in exclusions
  if (EXCLUDED_FILE_PATTERNS.some((p) => p.test(filePath))) {
    return true;
  }
  // Check user-provided exclusions
  const userPatterns = options.excludeFiles ?? [];
  return userPatterns.some((p) => p.test(filePath));
}

/**
 * Check if a match is a false positive.
 */
function isFalsePositive(line: string, options: DeprecationCheckOptions): boolean {
  // Check built-in false positive patterns
  if (FALSE_POSITIVE_PATTERNS.some((p) => p.test(line))) {
    return true;
  }
  // Check user-provided false positive patterns
  const userPatterns = options.falsePositivePatterns ?? [];
  return userPatterns.some((p) => p.test(line));
}

/**
 * Determine if a deprecation type should be checked based on options.
 */
function shouldCheckType(type: string, options: DeprecationCheckOptions): boolean {
  switch (type) {
    case "legacy":
      return options.checkLegacy ?? false;
    case "obsolete":
      return options.checkObsolete ?? true;
    case "removal":
      return options.checkRemovalMarkers ?? true;
    default:
      return true;
  }
}

/**
 * Get the deprecation type label for display.
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
 * A detected deprecation in the source code.
 */
interface DeprecationMatch {
  location: SourceLocation;
  type: string;
  line: string;
}

/**
 * Extract deprecations from file content.
 * This is the core extraction logic that was previously in the crawler.
 */
function extractDeprecations(
  content: string,
  filePath: string,
  options: DeprecationCheckOptions
): DeprecationMatch[] {
  const deprecations: DeprecationMatch[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const lineNum = i + 1;

    // Check each deprecation pattern
    for (const { pattern, type } of DEPRECATION_PATTERNS) {
      // Skip types that are disabled by options
      if (!shouldCheckType(type, options)) continue;

      if (pattern.test(line)) {
        // Check for false positives
        if (isFalsePositive(line, options)) continue;

        deprecations.push({
          location: { file: filePath, line: lineNum },
          type,
          line: line.trim(),
        });

        // Only report one deprecation per line
        break;
      }
    }
  }

  return deprecations;
}

// =============================================================================
// Deprecation Check Linter
// =============================================================================

/**
 * Linter that detects deprecated code that should be removed.
 *
 * This linter is fully self-contained - it reads file content directly
 * and performs its own extraction logic. The core viola system provides
 * only structural data; all semantic analysis happens here.
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

  /**
   * This linter needs file content to do its own extraction.
   * It also needs files to iterate over all files.
   */
  readonly requirements: LinterDataRequirements = {
    content: true,
    files: true,
  };

  lint(data: CodebaseData, config: LinterConfig): Violation[] {
    const violations: Violation[] = [];
    const options = getOptions(config);

    for (const file of data.files) {
      // Skip excluded files
      if (shouldExcludeFile(file.path, options)) continue;

      // Get file content - the crawler provides this when content: true is requested
      const content = file.content;
      if (!content) continue;

      // Extract deprecations from file content
      const deprecations = extractDeprecations(content, file.path, options);

      // Create violations for each deprecation found
      for (const deprecation of deprecations) {
        violations.push(this.createDeprecationViolation(deprecation));
      }
    }

    return violations;
  }

  /**
   * Create a violation for a deprecation.
   */
  private createDeprecationViolation(match: DeprecationMatch): Violation {
    const typeLabel = getTypeLabel(match.type);

    return this.error(
      `deprecated-${match.type}`,
      `Found ${typeLabel} in ${match.location.file}:${match.location.line}. ` +
        `Deprecated code should be DELETED, not marked.`,
      match.location,
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
          type: match.type,
          typeLabel,
          sourceLine: match.line,
        },
      }
    );
  }
}

/**
 * Default instance for registration.
 */
export const deprecationCheckLinter: DeprecationCheckLinter = new DeprecationCheckLinter();

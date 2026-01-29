/**
 * Duplicate Strings Linter
 *
 * Detects string literals that appear multiple times in the codebase.
 * - Exact same string appearing 2 times -> warning (suggest moving to const)
 * - Exact same string appearing 3+ times -> error (demand extraction)
 *
 * @module
 */

import {
    BaseLinter,
    type CodebaseData,
    type LinterConfig,
    type LinterDataRequirements,
    type LinterMeta,
    type StringLiteral,
    type Violation,
} from "@hiisi/viola";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Options for the duplicate strings linter.
 */
export interface DuplicateStringsOptions {
  /** Minimum string length to check (shorter strings are ignored) */
  minLength?: number;
  /** Maximum string length to check (very long strings are usually unique) */
  maxLength?: number;
  /** Number of occurrences that triggers a warning */
  warningThreshold?: number;
  /** Number of occurrences that triggers an error */
  errorThreshold?: number;
  /** Patterns to ignore (e.g., common strings like "true", "false") */
  ignorePatterns?: RegExp[];
  /** Ignore strings that look like identifiers (camelCase, snake_case) */
  ignoreIdentifierLike?: boolean;
  /** Ignore strings that look like paths */
  ignorePaths?: boolean;
  /** Ignore strings that look like URLs */
  ignoreUrls?: boolean;
  /** Ignore strings that are likely CSS classes */
  ignoreCssClasses?: boolean;
}

/**
 * Default options.
 */
const DEFAULT_OPTIONS: DuplicateStringsOptions = {
  minLength: 4,
  maxLength: 200,
  warningThreshold: 2,
  errorThreshold: 3,
  ignorePatterns: [
    /^(true|false|null|undefined|yes|no|on|off)$/i,
    /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/,
    /^(utf-8|utf8|ascii|base64|hex|binary)$/i,
    /^(left|right|top|bottom|center|start|end)$/i,
    /^(error|warning|info|debug|success|failure)$/i,
    /^(id|name|type|value|key|data|text|label|title)$/i,
    /^(click|change|submit|focus|blur|input|load)$/i,
    /^\d+$/, // Pure numbers
    /^[a-z]$/, // Single letters
    /^\s+$/, // Whitespace only
  ],
  ignoreIdentifierLike: true,
  ignorePaths: true,
  ignoreUrls: true,
  ignoreCssClasses: true,
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get options from linter config.
 */
function getOptions(config: LinterConfig): DuplicateStringsOptions {
  const opts = config.options as Partial<DuplicateStringsOptions> | undefined;
  return {
    ...DEFAULT_OPTIONS,
    ...opts,
  };
}

/**
 * Check if a string looks like an identifier (camelCase, snake_case, etc.)
 */
function looksLikeIdentifier(str: string): boolean {
  // camelCase
  if (/^[a-z][a-zA-Z0-9]*$/.test(str) && /[A-Z]/.test(str)) return true;
  // PascalCase
  if (/^[A-Z][a-zA-Z0-9]*$/.test(str)) return true;
  // snake_case
  if (/^[a-z][a-z0-9_]*$/.test(str) && str.includes("_")) return true;
  // SCREAMING_SNAKE_CASE
  if (/^[A-Z][A-Z0-9_]*$/.test(str) && str.includes("_")) return true;
  // kebab-case
  if (/^[a-z][a-z0-9-]*$/.test(str) && str.includes("-")) return true;
  return false;
}

/**
 * Check if a string looks like a file path.
 */
function looksLikePath(str: string): boolean {
  // Contains path separators
  if (str.includes("/") || str.includes("\\")) return true;
  // Has file extension
  if (/\.[a-z]{2,4}$/i.test(str)) return true;
  // Starts with relative path indicator
  if (str.startsWith("./") || str.startsWith("../")) return true;
  return false;
}

/**
 * Check if a string looks like a URL.
 */
function looksLikeUrl(str: string): boolean {
  return /^(https?|ftp|file|ws|wss):\/\//i.test(str) ||
         str.startsWith("//") ||
         /^[a-z][a-z0-9+.-]*:/i.test(str);
}

/**
 * Check if a string looks like CSS classes (space-separated words).
 */
function looksLikeCssClasses(str: string): boolean {
  // Multiple space-separated words that look like class names
  const parts = str.split(/\s+/);
  if (parts.length < 2) return false;
  return parts.every((p) => /^[a-z][a-z0-9_-]*$/i.test(p));
}

/**
 * Check if a string should be ignored based on options.
 */
function shouldIgnore(str: string, options: DuplicateStringsOptions): boolean {
  // Length checks
  if (str.length < (options.minLength ?? 4)) return true;
  if (str.length > (options.maxLength ?? 200)) return true;

  // Pattern checks
  const patterns = options.ignorePatterns ?? [];
  if (patterns.some((p) => p.test(str))) return true;

  // Identifier check
  if (options.ignoreIdentifierLike && looksLikeIdentifier(str)) return true;

  // Path check
  if (options.ignorePaths && looksLikePath(str)) return true;

  // URL check
  if (options.ignoreUrls && looksLikeUrl(str)) return true;

  // CSS classes check
  if (options.ignoreCssClasses && looksLikeCssClasses(str)) return true;

  return false;
}

/**
 * Group strings by their value.
 */
function groupByValue(
  strings: readonly StringLiteral[]
): Map<string, StringLiteral[]> {
  const groups = new Map<string, StringLiteral[]>();

  for (const str of strings) {
    const existing = groups.get(str.value);
    if (existing) {
      existing.push(str);
    } else {
      groups.set(str.value, [str]);
    }
  }

  return groups;
}

/**
 * Format a string for display (truncate if too long).
 */
function formatString(str: string, maxLen: number = 50): string {
  if (str.length <= maxLen) return `"${str}"`;
  return `"${str.slice(0, maxLen - 3)}..."`;
}

/**
 * Suggest a constant name based on the string value.
 */
function suggestConstName(str: string): string {
  // Remove special characters and split into words
  const words = str
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 4); // Take first 4 words

  if (words.length === 0) return "STRING_CONSTANT";

  // Convert to SCREAMING_SNAKE_CASE
  return words.map((w) => w.toUpperCase()).join("_");
}

// =============================================================================
// Duplicate Strings Linter
// =============================================================================

/**
 * Linter that detects duplicate string literals.
 */
export class DuplicateStringsLinter extends BaseLinter {
  readonly meta: LinterMeta = {
    id: "duplicate-strings",
    name: "Duplicate Strings",
    description:
      "Detects string literals that appear multiple times and should be extracted to constants",
    defaultSeverity: "warning",
  };

  readonly requirements: LinterDataRequirements = {
    strings: true,
  };

  lint(data: CodebaseData, config: LinterConfig): Violation[] {
    const violations: Violation[] = [];
    const options = getOptions(config);

    // Filter strings to check
    const stringsToCheck = data.allStrings.filter(
      (str) => !shouldIgnore(str.value, options)
    );

    // Group by value
    const groups = groupByValue(stringsToCheck);

    // Find duplicates
    for (const [value, occurrences] of groups) {
      const count = occurrences.length;

      if (count >= (options.errorThreshold ?? 3)) {
        // Error: too many duplicates
        violations.push(this.createDuplicateViolation(value, occurrences, "error", options));
      } else if (count >= (options.warningThreshold ?? 2)) {
        // Warning: potential duplicate
        violations.push(this.createDuplicateViolation(value, occurrences, "warning", options));
      }
    }

    // Sort by occurrence count (most duplicates first)
    violations.sort((a, b) => {
      const countA = (a.context?.count as number) ?? 0;
      const countB = (b.context?.count as number) ?? 0;
      return countB - countA;
    });

    return violations;
  }

  /**
   * Create a violation for duplicate strings.
   */
  private createDuplicateViolation(
    value: string,
    occurrences: StringLiteral[],
    severity: "error" | "warning",
    _options: DuplicateStringsOptions
  ): Violation {
    const count = occurrences.length;
    const firstOccurrence = occurrences[0]!;
    const suggestedName = suggestConstName(value);

    // Get unique files where this string appears
    const files = [...new Set(occurrences.map((o) => o.location.file))];
    const fileCount = files.length;

    // Format locations for display (limit to first 5)
    const locationList = occurrences
      .slice(0, 5)
      .map((o) => `  - ${o.location.file}:${o.location.line}`)
      .join("\n");
    const moreLocations = occurrences.length > 5
      ? `\n  ... and ${occurrences.length - 5} more locations`
      : "";

    const code = severity === "error"
      ? "duplicate-string-many"
      : "duplicate-string-few";

    const message = severity === "error"
      ? `String ${formatString(value)} appears ${count} times across ${fileCount} file(s). ` +
        `EXTRACT TO A CONSTANT IMMEDIATELY.`
      : `String ${formatString(value)} appears ${count} times. ` +
        `Consider extracting to a constant.`;

    return {
      linter: this.meta.id,
      code,
      severity,
      location: firstOccurrence.location,
      relatedLocations: occurrences.slice(1).map((o) => o.location),
      message,
      suggestion:
        severity === "error"
          ? `IMMEDIATE ACTION REQUIRED:\n` +
            `1. Create a constant in an appropriate location:\n` +
            `   export const ${suggestedName} = ${formatString(value, 80)};\n\n` +
            `2. Replace all ${count} occurrences with the constant.\n\n` +
            `Locations:\n${locationList}${moreLocations}\n\n` +
            `WHY: Duplicate strings are maintenance nightmares. When the string ` +
            `needs to change, you'll miss some occurrences and create bugs.`
          : `Consider creating a constant:\n` +
            `  export const ${suggestedName} = ${formatString(value, 80)};\n\n` +
            `Locations:\n${locationList}${moreLocations}`,
      context: {
        value,
        count,
        fileCount,
        suggestedName,
        files,
      },
    };
  }
}

/**
 * Default instance for registration.
 */
export const duplicateStringsLinter: DuplicateStringsLinter = new DuplicateStringsLinter();

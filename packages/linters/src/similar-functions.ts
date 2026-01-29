/**
 * Similar Functions Linter
 *
 * Detects functions with similar names or identical parameter signatures.
 * - Similar names (fuzzy match) -> warning (fairly close) or error (very close)
 * - Same name but different params -> error (demands investigation)
 * - Suggests extracting common logic to reusable helpers
 *
 * @module
 */

import {
    BaseLinter,
    type CodebaseData,
    compareIdentifiers,
    type FunctionInfo,
    type LinterConfig,
    type LinterDataRequirements,
    type LinterMeta,
    type SimilarityThresholds,
    type Violation,
} from "@hiisi/viola";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Thresholds for function name similarity.
 */
const _FUNCTION_NAME_THRESHOLDS: SimilarityThresholds = {
  low: 0.5,    // Below this: no match
  medium: 0.7, // Above this: warning
  high: 0.85,  // Above this: error
};

/**
 * Options for the similar functions linter.
 */
export interface SimilarFunctionsOptions {
  /** Minimum similarity score to report (0-1) */
  minSimilarity?: number;
  /** Threshold for warning level */
  warningThreshold?: number;
  /** Threshold for error level */
  errorThreshold?: number;
  /** Ignore functions shorter than this many lines */
  minFunctionLines?: number;
  /** Ignore functions with names shorter than this */
  minNameLength?: number;
  /** Patterns for function names to ignore */
  ignorePatterns?: RegExp[];
}

/**
 * Default options.
 */
const DEFAULT_OPTIONS: SimilarFunctionsOptions = {
  minSimilarity: 0.7,
  warningThreshold: 0.7,
  errorThreshold: 0.85,
  minFunctionLines: 3,
  minNameLength: 3,
  ignorePatterns: [
    /^handle[A-Z]/, // Event handlers are expected to be similar
    /^on[A-Z]/,     // Event callbacks
    /^get[A-Z]/,    // Getters often have similar patterns
    /^set[A-Z]/,    // Setters
    /^is[A-Z]/,     // Boolean checks
    /^has[A-Z]/,    // Boolean checks
    /^to[A-Z]/,     // Converters
  ],
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get options from linter config.
 */
function getOptions(config: LinterConfig): SimilarFunctionsOptions {
  const opts = config.options as Partial<SimilarFunctionsOptions> | undefined;
  return {
    ...DEFAULT_OPTIONS,
    ...opts,
  };
}

/**
 * Check if a function should be ignored based on name patterns.
 */
function shouldIgnore(name: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(name));
}

/**
 * Compare parameter lists for similarity.
 * Returns 1 if identical, 0 if completely different.
 */
function compareParams(
  paramsA: readonly { name: string; type?: string }[],
  paramsB: readonly { name: string; type?: string }[]
): number {
  if (paramsA.length === 0 && paramsB.length === 0) return 1;
  if (paramsA.length !== paramsB.length) return 0;

  let matchCount = 0;
  for (let i = 0; i < paramsA.length; i++) {
    const a = paramsA[i]!;
    const b = paramsB[i]!;

    // Check type match (if both have types)
    if (a.type && b.type && a.type === b.type) {
      matchCount++;
    } else if (!a.type && !b.type) {
      // Both untyped, check name similarity
      const { similarity } = compareIdentifiers(a.name, b.name);
      if (similarity > 0.8) matchCount++;
    }
  }

  return matchCount / paramsA.length;
}

/**
 * Format function signature for display.
 */
function formatSignature(func: FunctionInfo): string {
  const params = func.params.map((p) => {
    let s = p.name;
    if (p.optional) s += "?";
    if (p.type) s += `: ${p.type}`;
    return s;
  }).join(", ");

  const async = func.isAsync ? "async " : "";
  const ret = func.returnType ? `: ${func.returnType}` : "";

  return `${async}function ${func.name}(${params})${ret}`;
}

/**
 * Get a readable location string.
 */
function locationString(func: FunctionInfo): string {
  return `${func.location.file}:${func.location.line}`;
}

// =============================================================================
// Similar Functions Linter
// =============================================================================

/**
 * Linter that detects functions with similar names or signatures.
 */
export class SimilarFunctionsLinter extends BaseLinter {
  readonly meta: LinterMeta = {
    id: "similar-functions",
    name: "Similar Functions",
    description:
      "Detects functions with similar names that might be duplicates or should be consolidated",
    defaultSeverity: "warning",
  };

  readonly requirements: LinterDataRequirements = {
    functions: true,
  };

  lint(data: CodebaseData, config: LinterConfig): Violation[] {
    const violations: Violation[] = [];
    const options = getOptions(config);

    // Filter functions to check
    const functions = data.allFunctions.filter((func) => {
      // Must have a name
      if (!func.name) return false;

      // Must meet minimum name length
      if (func.name.length < (options.minNameLength ?? 3)) return false;

      // Must not match ignore patterns
      if (shouldIgnore(func.name, options.ignorePatterns ?? [])) return false;

      // Must meet minimum line count
      const lines = func.body.split("\n").length;
      if (lines < (options.minFunctionLines ?? 3)) return false;

      return true;
    });

    // Compare all pairs
    const checked = new Set<string>();

    for (let i = 0; i < functions.length; i++) {
      for (let j = i + 1; j < functions.length; j++) {
        const funcA = functions[i]!;
        const funcB = functions[j]!;

        // Create a unique key for this pair to avoid duplicates
        const pairKey = [
          `${funcA.location.file}:${funcA.location.line}:${funcA.name}`,
          `${funcB.location.file}:${funcB.location.line}:${funcB.name}`,
        ].sort().join("||");

        if (checked.has(pairKey)) continue;
        checked.add(pairKey);

        // Skip if in the same file (likely intentional overloads or related functions)
        // Unless they have the exact same name
        if (funcA.location.file === funcB.location.file && funcA.name !== funcB.name) {
          continue;
        }

        const violation = this.checkPair(funcA, funcB, options);
        if (violation) {
          violations.push(violation);
        }
      }
    }

    return violations;
  }

  /**
   * Check a pair of functions for similarity.
   */
  private checkPair(
    funcA: FunctionInfo,
    funcB: FunctionInfo,
    options: SimilarFunctionsOptions
  ): Violation | null {
    const { similarity, level: _level, metrics } = compareIdentifiers(funcA.name, funcB.name);

    // Exact same name in different files
    if (funcA.name === funcB.name) {
      return this.checkSameNameFunctions(funcA, funcB, options);
    }

    // Check if similarity meets threshold
    if (similarity < (options.minSimilarity ?? 0.7)) {
      return null;
    }

    // Determine severity based on similarity
    const isError = similarity >= (options.errorThreshold ?? 0.85);
    const isWarning = similarity >= (options.warningThreshold ?? 0.7);

    if (!isError && !isWarning) {
      return null;
    }

    const _severity = isError ? "error" : "warning";
    const pct = (similarity * 100).toFixed(0);

    if (isError) {
      return this.error(
        "similar-function-name-high",
        `Function "${funcA.name}" is very similar to "${funcB.name}" (${pct}% match). ` +
          `This likely indicates duplicate code that should be consolidated.`,
        funcA.location,
        {
          relatedLocations: [funcB.location],
          suggestion:
            `Consider:\n` +
            `1. If these do the same thing: consolidate into one function\n` +
            `2. If they do different things: rename to clarify the distinction\n` +
            `3. If they share logic: extract common code to a helper\n\n` +
            `Function A: ${locationString(funcA)}\n` +
            `Function B: ${locationString(funcB)}`,
          context: {
            similarity,
            funcA: formatSignature(funcA),
            funcB: formatSignature(funcB),
            metrics,
          },
        }
      );
    }

    return this.warning(
      "similar-function-name-medium",
      `Function "${funcA.name}" has similar name to "${funcB.name}" (${pct}% match). ` +
        `Review to ensure they serve distinct purposes.`,
      funcA.location,
      {
        relatedLocations: [funcB.location],
        suggestion:
          `If these functions do related things, consider:\n` +
          `1. Consolidating them\n` +
          `2. Extracting shared logic\n` +
          `3. Renaming for clarity\n\n` +
          `Function A: ${locationString(funcA)}\n` +
          `Function B: ${locationString(funcB)}`,
        context: {
          similarity,
          funcA: formatSignature(funcA),
          funcB: formatSignature(funcB),
        },
      }
    );
  }

  /**
   * Check functions with the exact same name in different files.
   */
  private checkSameNameFunctions(
    funcA: FunctionInfo,
    funcB: FunctionInfo,
    _options: SimilarFunctionsOptions
  ): Violation | null {
    // Same name in different files is definitely suspicious
    const paramSimilarity = compareParams(funcA.params, funcB.params);

    if (paramSimilarity === 1) {
      // Identical signatures - likely duplicate
      return this.error(
        "duplicate-function",
        `Function "${funcA.name}" exists in multiple files with identical signature. ` +
          `This is likely duplicate code that should be consolidated.`,
        funcA.location,
        {
          relatedLocations: [funcB.location],
          suggestion:
            `IMMEDIATE ACTION REQUIRED:\n` +
            `1. Determine which is the canonical implementation\n` +
            `2. Move to a shared location (packages/core/ or appropriate module)\n` +
            `3. Update all imports to use the single source\n` +
            `4. Delete the duplicate\n\n` +
            `Locations:\n` +
            `  - ${locationString(funcA)}\n` +
            `  - ${locationString(funcB)}`,
          context: {
            funcA: formatSignature(funcA),
            funcB: formatSignature(funcB),
            paramSimilarity,
          },
        }
      );
    } else {
      // Same name but different params - needs investigation
      return this.error(
        "same-name-different-params",
        `Function "${funcA.name}" exists in multiple files with DIFFERENT signatures. ` +
          `This is confusing and error-prone.`,
        funcA.location,
        {
          relatedLocations: [funcB.location],
          suggestion:
            `IMMEDIATE ACTION REQUIRED:\n` +
            `1. If they do the same thing: unify the signature\n` +
            `2. If they do different things: rename one for clarity\n` +
            `3. Consider if the difference is intentional (overload) or accidental\n\n` +
            `Signatures:\n` +
            `  A: ${formatSignature(funcA)} at ${locationString(funcA)}\n` +
            `  B: ${formatSignature(funcB)} at ${locationString(funcB)}`,
          context: {
            funcA: formatSignature(funcA),
            funcB: formatSignature(funcB),
            paramSimilarity,
          },
        }
      );
    }
  }
}

/**
 * Default instance for registration.
 */
export const similarFunctionsLinter: SimilarFunctionsLinter = new SimilarFunctionsLinter();

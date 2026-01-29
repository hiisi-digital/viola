/**
 * Viola Duplicate Logic Linter
 *
 * Detects functions with similar implementations that could potentially be
 * consolidated. This goes beyond name similarity to actually compare the
 * structure and logic of function bodies.
 *
 * @module
 */

import {
    BaseLinter,
    type CodebaseData,
    compareCodeBodies,
    type FunctionInfo,
    hashCodeBody,
    type LinterConfig,
    type LinterDataRequirements,
    type LinterMeta,
    normalizeCode,
    type SimilarityLevel,
    type SourceLocation,
    type Violation,
} from "@hiisi/viola";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Options for the duplicate-logic linter.
 */
interface DuplicateLogicOptions {
  /**
   * Minimum similarity threshold (0-1) to report as duplicate.
   * @default 0.85
   */
  similarityThreshold?: number;

  /**
   * Minimum function body length (characters) to check.
   * Very small functions are often intentionally similar.
   * @default 50
   */
  minBodyLength?: number;

  /**
   * Minimum number of lines in function body to check.
   * @default 3
   */
  minBodyLines?: number;

  /**
   * Whether to compare functions across different files.
   * @default true
   */
  crossFile?: boolean;

  /**
   * Whether to compare functions with different names.
   * @default true
   */
  differentNamesOnly?: boolean;

  /**
   * Patterns for function names to ignore.
   * @default []
   */
  ignoreFunctionPatterns?: RegExp[];

  /**
   * File patterns to exclude from checking.
   * @default [/\.test\.ts$/, /\.spec\.ts$/, /_test\.ts$/]
   */
  ignoreFilePatterns?: RegExp[];

  /**
   * Maximum number of pairs to report (to avoid overwhelming output).
   * @default 50
   */
  maxPairs?: number;

  /**
   * Report exact duplicates (100% match) as errors instead of warnings.
   * @default true
   */
  errorOnExact?: boolean;
}

const DEFAULT_OPTIONS: Required<DuplicateLogicOptions> = {
  similarityThreshold: 0.85,
  minBodyLength: 50,
  minBodyLines: 3,
  crossFile: true,
  differentNamesOnly: false,
  ignoreFunctionPatterns: [],
  ignoreFilePatterns: [/\.test\.ts$/, /\.spec\.ts$/, /_test\.ts$/],
  maxPairs: 50,
  errorOnExact: true,
};

// =============================================================================
// Types
// =============================================================================

interface FunctionWithMeta extends FunctionInfo {
  /** Pre-computed normalized body for comparison */
  normalized: string;
  /** Pre-computed hash for fast exact-match detection */
  hash: string;
}

interface DuplicatePair {
  func1: FunctionWithMeta;
  func2: FunctionWithMeta;
  similarity: number;
  level: SimilarityLevel;
  isExact: boolean;
}

// =============================================================================
// Linter Implementation
// =============================================================================

/**
 * Duplicate Logic Linter
 *
 * Compares function bodies to find implementations that are similar enough
 * to warrant consolidation. Uses multiple comparison strategies:
 *
 * 1. Hash-based exact duplicate detection (O(n) for grouping)
 * 2. Structural similarity for near-duplicates
 * 3. Token-based comparison for logic similarity
 */
export class DuplicateLogicLinter extends BaseLinter {
  readonly meta: LinterMeta = {
    id: "duplicate-logic",
    name: "Duplicate Logic",
    description: "Detects functions with similar implementations",
    defaultSeverity: "warning",
  };

  readonly requirements: LinterDataRequirements = {
    functions: true,
    files: true,
  };

  lint(data: CodebaseData, config: LinterConfig): Violation[] {
    const violations: Violation[] = [];
    const opts = this.getOptions(config);

    // Collect and prepare functions for comparison
    const functions = this.prepareFunctions(data, opts);

    if (functions.length < 2) {
      return violations;
    }

    // Find duplicates
    const pairs = this.findDuplicates(functions, opts);

    // Convert pairs to violations
    for (const pair of pairs) {
      const violation = this.pairToViolation(pair, opts, config);
      violations.push(violation);
    }

    return violations;
  }

  /**
   * Get options with defaults applied.
   */
  private getOptions(config: LinterConfig): Required<DuplicateLogicOptions> {
    const userOpts = (config.options ?? {}) as DuplicateLogicOptions;
    return {
      ...DEFAULT_OPTIONS,
      ...userOpts,
      ignoreFunctionPatterns: [
        ...DEFAULT_OPTIONS.ignoreFunctionPatterns,
        ...(userOpts.ignoreFunctionPatterns ?? []),
      ],
      ignoreFilePatterns: [
        ...DEFAULT_OPTIONS.ignoreFilePatterns,
        ...(userOpts.ignoreFilePatterns ?? []),
      ],
    };
  }

  /**
   * Prepare functions for comparison by filtering and pre-computing data.
   */
  private prepareFunctions(
    data: CodebaseData,
    opts: Required<DuplicateLogicOptions>
  ): FunctionWithMeta[] {
    const functions: FunctionWithMeta[] = [];

    for (const file of data.files) {
      // Skip ignored files
      if (opts.ignoreFilePatterns.some((p) => p.test(file.path))) {
        continue;
      }

      for (const func of file.functions) {
        // Skip functions that don't meet criteria
        if (!this.shouldCheck(func, opts)) {
          continue;
        }

        // Pre-compute normalized body and hash
        const normalized = func.normalizedBody || normalizeCode(func.body);
        const hash = func.bodyHash || hashCodeBody(normalized);

        functions.push({
          ...func,
          normalized,
          hash,
        });
      }
    }

    return functions;
  }

  /**
   * Check if a function should be included in comparison.
   */
  private shouldCheck(
    func: FunctionInfo,
    opts: Required<DuplicateLogicOptions>
  ): boolean {
    // Skip ignored function names
    if (func.name && opts.ignoreFunctionPatterns.some((p) => p.test(func.name))) {
      return false;
    }

    // Skip functions with bodies that are too short
    if (func.body.length < opts.minBodyLength) {
      return false;
    }

    // Skip functions with too few lines
    const lineCount = func.body.split("\n").length;
    if (lineCount < opts.minBodyLines) {
      return false;
    }

    return true;
  }

  /**
   * Find duplicate function pairs.
   */
  private findDuplicates(
    functions: FunctionWithMeta[],
    opts: Required<DuplicateLogicOptions>
  ): DuplicatePair[] {
    const pairs: DuplicatePair[] = [];
    const seenPairs = new Set<string>();

    // Group by hash for fast exact duplicate detection
    const byHash = new Map<string, FunctionWithMeta[]>();
    for (const func of functions) {
      const group = byHash.get(func.hash) ?? [];
      group.push(func);
      byHash.set(func.hash, group);
    }

    // Find exact duplicates (same hash)
    for (const group of byHash.values()) {
      if (group.length < 2) continue;

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const func1 = group[i]!;
          const func2 = group[j]!;

          if (!this.shouldCompare(func1, func2, opts)) continue;

          const pairKey = this.pairKey(func1, func2);
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);

          pairs.push({
            func1,
            func2,
            similarity: 1.0,
            level: "exact",
            isExact: true,
          });
        }
      }
    }

    // Find near-duplicates using structural comparison
    // This is O(n²) but we limit to maxPairs and filter aggressively
    if (pairs.length < opts.maxPairs) {
      for (let i = 0; i < functions.length && pairs.length < opts.maxPairs; i++) {
        for (let j = i + 1; j < functions.length && pairs.length < opts.maxPairs; j++) {
          const func1 = functions[i]!;
          const func2 = functions[j]!;

          if (!this.shouldCompare(func1, func2, opts)) continue;

          // Skip if already found as exact duplicate
          const pairKey = this.pairKey(func1, func2);
          if (seenPairs.has(pairKey)) continue;

          // Compare bodies
          const { similarity, level } = compareCodeBodies(
            func1.normalized,
            func2.normalized
          );

          if (similarity >= opts.similarityThreshold) {
            seenPairs.add(pairKey);
            pairs.push({
              func1,
              func2,
              similarity,
              level,
              isExact: similarity >= 0.99,
            });
          }
        }
      }
    }

    // Sort by similarity (highest first)
    pairs.sort((a, b) => b.similarity - a.similarity);

    return pairs.slice(0, opts.maxPairs);
  }

  /**
   * Check if two functions should be compared.
   */
  private shouldCompare(
    func1: FunctionWithMeta,
    func2: FunctionWithMeta,
    opts: Required<DuplicateLogicOptions>
  ): boolean {
    // Don't compare function to itself
    if (
      func1.location.file === func2.location.file &&
      func1.location.line === func2.location.line
    ) {
      return false;
    }

    // Check cross-file comparison setting
    if (!opts.crossFile && func1.location.file !== func2.location.file) {
      return false;
    }

    // Check different-names-only setting
    if (opts.differentNamesOnly && func1.name === func2.name) {
      return false;
    }

    return true;
  }

  /**
   * Create a unique key for a function pair.
   */
  private pairKey(func1: FunctionWithMeta, func2: FunctionWithMeta): string {
    const key1 = `${func1.location.file}:${func1.location.line}`;
    const key2 = `${func2.location.file}:${func2.location.line}`;
    return key1 < key2 ? `${key1}|${key2}` : `${key2}|${key1}`;
  }

  /**
   * Convert a duplicate pair to a violation.
   */
  private pairToViolation(
    pair: DuplicatePair,
    opts: Required<DuplicateLogicOptions>,
    config: LinterConfig
  ): Violation {
    const { func1, func2, similarity, isExact } = pair;
    const similarityPct = Math.round(similarity * 100);

    const name1 = func1.name || "(anonymous)";
    const name2 = func2.name || "(anonymous)";

    const relatedLocations: SourceLocation[] = [func2.location];

    if (isExact && opts.errorOnExact) {
      return this.error(
        "exact-duplicate",
        `Function "${name1}" is an exact duplicate of "${name2}". ` +
          `Consider extracting to a shared function.`,
        func1.location,
        {
          relatedLocations,
          suggestion:
            "Extract the duplicated logic into a single shared function and call it from both places.",
          context: {
            function1: name1,
            function2: name2,
            similarity: similarityPct,
            file1: func1.location.file,
            file2: func2.location.file,
          },
        }
      );
    }

    return this.createViolation(
      {
        code: "similar-implementation",
        message:
          `Function "${name1}" has ${similarityPct}% similar implementation to "${name2}". ` +
          `Consider consolidating.`,
        location: func1.location,
        relatedLocations,
        suggestion:
          "Review both functions and consider extracting common logic into a shared helper.",
        context: {
          function1: name1,
          function2: name2,
          similarity: similarityPct,
          file1: func1.location.file,
          file2: func2.location.file,
        },
      },
      config
    );
  }
}

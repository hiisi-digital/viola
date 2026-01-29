/**
 * Viola - Violation Detection for Muse
 *
 * A unified lint runtime that crawls the codebase once and provides
 * immutable data to multiple linters. Each linter declares what data
 * it needs and receives only that, frozen and ready for analysis.
 *
 * ## Usage
 *
 * ```ts
 * import { createViola, runViola } from "@hiisi/viola";
 *
 * // Simple usage with defaults
 * const results = await runViola({
 *   projectRoot: Deno.cwd(),
 *   include: ["packages", "app"],
 * });
 *
 * if (results.hasErrors) {
 *   console.error("Lint failed!");
 *   Deno.exit(1);
 * }
 * ```
 *
 * ## Built-in Linters
 *
 * - `type-location` - Types must be in types/ directories
 * - `similar-functions` - Detect similar function names
 * - `similar-types` - Detect similar type names
 * - `duplicate-strings` - Find repeated string literals
 * - `deprecation-check` - Find deprecated code that should be deleted
 *
 * ## Custom Linters
 *
 * ```ts
 * import { BaseLinter, registry } from "@hiisi/viola";
 *
 * class MyLinter extends BaseLinter {
 *   readonly meta = {
 *     id: "my-linter",
 *     name: "My Linter",
 *     description: "Checks something",
 *     defaultSeverity: "warning",
 *   };
 *
 *   readonly requirements = { functions: true };
 *
 *   lint(data, config) {
 *     // Return violations
 *     return [];
 *   }
 * }
 *
 * registry.register(new MyLinter());
 * ```
 *
 * @module
 */

// =============================================================================
// Data Types
// =============================================================================

export type {
    CodebaseData,
    ExportInfo,
    FileInfo,
    FunctionInfo,
    FunctionParam,
    ImportInfo,
    LinterConfig,
    LinterResult,
    LintResults,
    SchemaInfo,
    SourceLocation,
    StringLiteral,
    TypeField,
    TypeInfo,
    ViolaConfig,
    Violation,
    ViolationSeverity
} from "./src/data/mod.ts";

// =============================================================================
// Utilities
// =============================================================================

export {

    // Freeze
    assertFrozen, BODY_SIMILARITY_THRESHOLDS, classifySimilarity,
    // Similarity
    combinedSimilarity,
    // Hashing
    combineHashes, compareCodeBodies,
    compareIdentifiers, createFingerprint, deepFreeze, djb2Hash, findAllSimilarPairs, findExactDuplicates, findSimilar, fingerprintsMightMatch,
    fnv1aHash, frozenArray,
    frozenCopy,
    frozenMap,
    frozenObject,
    frozenSet, groupByHash,
    groupByStructure,
    hashCodeBody,
    hashContent,
    hashStructure, isDeeplyFrozen, jaccardNGramSimilarity,
    jaccardSimilarity,
    levenshteinDistance,
    levenshteinSimilarity, NAME_SIMILARITY_THRESHOLDS, normalizeCode,
    tokenize,
    tokenSimilarity, type CodeFingerprint, type SimilarityLevel,
    type SimilarityMatch,
    type SimilarityThresholds
} from "./src/utils/mod.ts";

// =============================================================================
// Runtime
// =============================================================================

export { crawlCodebase, DEFAULT_CONFIG } from "./src/runtime/mod.ts";

// =============================================================================
// Linters
// =============================================================================

export {
    // Base class
    BaseLinter, DeprecationCheckLinter,
    deprecationCheckLinter, DuplicateStringsLinter,
    duplicateStringsLinter, isLinter, register, registerBuiltinLinters, registerLinter,
    // Registry
    registry, runLinter,
    runLinters, SimilarFunctionsLinter,
    similarFunctionsLinter, SimilarTypesLinter,
    similarTypesLinter,
    // Built-in linters
    TypeLocationLinter,
    typeLocationLinter, type DeprecationCheckOptions, type DuplicateStringsOptions, type LinterConstructor,
    type LinterDataRequirements,
    type LinterMeta, type RunOptions, type SimilarFunctionsOptions, type SimilarTypesOptions
} from "./src/linters/mod.ts";

// =============================================================================
// High-Level API
// =============================================================================

import type { LintResults, ViolaConfig } from "./src/data/mod.ts";
import { runLinters, type RunOptions } from "./src/linters/mod.ts";
import { crawlCodebase, DEFAULT_CONFIG } from "./src/runtime/mod.ts";

/**
 * Options for running viola.
 */
export interface ViolaOptions extends Partial<ViolaConfig>, Partial<RunOptions> {}

/**
 * Run viola with the given configuration.
 * This is the main entry point for using viola programmatically.
 *
 * @param options - Configuration options
 * @returns Lint results
 */
export async function runViola(options: ViolaOptions): Promise<LintResults> {
  // Build config with defaults
  const config: ViolaConfig = {
    projectRoot: options.projectRoot ?? Deno.cwd(),
    include: options.include ?? ["packages", "app", "src"],
    exclude: options.exclude ?? DEFAULT_CONFIG.exclude ?? [],
    extensions: options.extensions ?? DEFAULT_CONFIG.extensions ?? [],
    linters: options.linters ?? {},
    reportOnly: options.reportOnly ?? false,
    verbose: options.verbose ?? false,
  };

  // Crawl codebase
  if (config.verbose) {
    console.log("Crawling codebase...");
  }

  const data = await crawlCodebase(config);

  if (config.verbose) {
    console.log(`Crawled ${data.files.length} files`);
    console.log(`Found ${data.allFunctions.length} functions`);
    console.log(`Found ${data.allTypes.length} types`);
    console.log(`Found ${data.allStrings.length} strings`);
    console.log();
  }

  // Run linters
  const runOptions: RunOptions = {
    only: options.only,
    skip: options.skip,
    config: options.config,
    parallel: options.parallel ?? false,
    verbose: config.verbose,
  };

  const results = await runLinters(data, runOptions);

  return results;
}

/**
 * Format lint results for console output.
 *
 * @param results - Lint results to format
 * @returns Formatted string
 */
export function formatResults(results: LintResults): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("=".repeat(80));
  lines.push("VIOLA LINT RESULTS");
  lines.push("=".repeat(80));
  lines.push("");
  lines.push(`Files scanned: ${results.filesScanned}`);
  lines.push(`Total time: ${results.totalDurationMs.toFixed(1)}ms`);
  lines.push("");

  if (results.summary.total === 0) {
    lines.push("✅ All clear! No violations found.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    `❌ Found ${results.summary.total} violation(s):` +
      ` ${results.summary.errors} error(s),` +
      ` ${results.summary.warnings} warning(s),` +
      ` ${results.summary.infos} info(s)`
  );
  lines.push("");

  // Group violations by linter
  for (const result of results.results) {
    if (result.violations.length === 0) continue;

    lines.push("-".repeat(80));
    lines.push(`${result.linter} (${result.violations.length} violations)`);
    lines.push("-".repeat(80));
    lines.push("");

    for (const v of result.violations) {
      const icon =
        v.severity === "error" ? "❌" : v.severity === "warning" ? "⚠️" : "ℹ️";

      lines.push(`${icon} ${v.location.file}:${v.location.line}`);
      lines.push(`   ${v.message}`);

      if (v.suggestion) {
        lines.push("");
        for (const line of v.suggestion.split("\n")) {
          lines.push(`   ${line}`);
        }
      }

      if (v.relatedLocations && v.relatedLocations.length > 0) {
        lines.push("");
        lines.push("   Related:");
        for (const loc of v.relatedLocations.slice(0, 3)) {
          lines.push(`     - ${loc.file}:${loc.line}`);
        }
        if (v.relatedLocations.length > 3) {
          lines.push(`     ... and ${v.relatedLocations.length - 3} more`);
        }
      }

      lines.push("");
    }
  }

  lines.push("=".repeat(80));

  if (results.hasErrors) {
    lines.push("BUILD FAILED - Fix the above errors before proceeding.");
  } else {
    lines.push("Warnings found - consider addressing them.");
  }

  lines.push("=".repeat(80));
  lines.push("");

  return lines.join("\n");
}

/**
 * Viola - Convention linter for codebases
 *
 * Checks for convention violations — naming patterns, file organization,
 * code duplication, and project-specific rules. Not a replacement for
 * language linters; those handle correctness. This handles everything else.
 *
 * Crawls the codebase once, extracts structured data (functions, types,
 * imports, strings), and runs multiple checkers against it.
 *
 * ## Usage
 *
 * ```ts
 * import { runViola, formatResults } from "@hiisi/viola";
 *
 * const results = await runViola({
 *   projectRoot: Deno.cwd(),
 *   include: ["packages", "app"],
 * });
 *
 * if (results.hasErrors) {
 *   console.error("Convention check failed");
 *   Deno.exit(1);
 * }
 * ```
 *
 * ## Plugin System
 *
 * Linters are loaded as plugins via the `plugins` config field.
 * There are no "built-in" linters - all must be explicitly imported.
 *
 * ```json
 * {
 *   "viola": {
 *     "plugins": ["@hiisi/viola-linters"]
 *   }
 * }
 * ```
 *
 * ## Custom Checkers
 *
 * ```ts
 * import { BaseLinter, registry } from "@hiisi/viola";
 *
 * class MyChecker extends BaseLinter {
 *   readonly meta = {
 *     id: "my-checker",
 *     name: "My Checker",
 *     description: "Checks naming conventions",
 *     defaultSeverity: "warning",
 *   };
 *
 *   readonly requirements = { functions: true };
 *
 *   lint(data, config) {
 *     return [];
 *   }
 * }
 *
 * registry.register(new MyChecker());
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
    BaseLinter,
    isLinter,
    // Registry
    register,
    registerLinter,
    registry,
    runLinter,
    runLinters,
    // Types
    type LinterConstructor,
    type LinterDataRequirements,
    type LinterMeta,
    type RunOptions
} from "./src/linters/mod.ts";

// =============================================================================
// Plugin Loader
// =============================================================================

export {
    clearLinters,
    getRegisteredLinters,
    loadPlugin,
    loadPlugins,
    type PluginLoadResult,
    type PluginsLoadResult
} from "./src/runtime/plugins.ts";

// =============================================================================
// High-Level API
// =============================================================================

import type { LintResults, ViolaConfig } from "./src/data/mod.ts";
import { runLinters, type RunOptions } from "./src/linters/mod.ts";
import { crawlCodebase, DEFAULT_CONFIG } from "./src/runtime/mod.ts";
import { loadPlugins } from "./src/runtime/plugins.ts";

/**
 * Options for running viola.
 */
export interface ViolaOptions extends Partial<ViolaConfig>, Partial<RunOptions> {
  /** Plugin specifiers to load (JSR, npm, URL, or import map references) */
  plugins?: string[];
}

/**
 * Run viola with the given configuration.
 *
 * @param options - Configuration options
 * @returns Check results
 */
export async function runViola(options: ViolaOptions): Promise<LintResults> {
  const config: ViolaConfig = {
    projectRoot: options.projectRoot ?? Deno.cwd(),
    include: options.include ?? ["packages", "app", "src"],
    exclude: options.exclude ?? DEFAULT_CONFIG.exclude ?? [],
    extensions: options.extensions ?? DEFAULT_CONFIG.extensions ?? [],
    linters: options.linters ?? {},
    reportOnly: options.reportOnly ?? false,
    verbose: options.verbose ?? false,
  };

  // Load plugins if specified
  const plugins = options.plugins ?? [];
  if (plugins.length > 0) {
    if (config.verbose) {
      console.log(`Loading ${plugins.length} plugin(s)...`);
    }
    const pluginResults = await loadPlugins(plugins, { verbose: config.verbose });
    if (!pluginResults.allSucceeded) {
      const failed = pluginResults.results.filter((r) => !r.success);
      console.error(`Failed to load ${failed.length} plugin(s):`);
      for (const f of failed) {
        console.error(`  - ${f.specifier}: ${f.error}`);
      }
    }
    if (config.verbose) {
      console.log(`Registered ${pluginResults.totalLinters} linter(s) from plugins`);
      console.log();
    }
  }

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
 * Format check results for console output.
 *
 * @param results - Check results to format
 * @returns Formatted string
 */
export function formatResults(results: LintResults): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("=".repeat(80));
  lines.push("VIOLA RESULTS");
  lines.push("=".repeat(80));
  lines.push("");
  lines.push(`Files scanned: ${results.filesScanned}`);
  lines.push(`Total time: ${results.totalDurationMs.toFixed(1)}ms`);
  lines.push("");

  if (results.summary.total === 0) {
    lines.push("All clear.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    `Found ${results.summary.total} issue(s):` +
      ` ${results.summary.errors} error(s),` +
      ` ${results.summary.warnings} warning(s),` +
      ` ${results.summary.infos} info(s)`
  );
  lines.push("");

  for (const result of results.results) {
    if (result.violations.length === 0) continue;

    lines.push("-".repeat(80));
    lines.push(`${result.linter} (${result.violations.length} issues)`);
    lines.push("-".repeat(80));
    lines.push("");

    for (const v of result.violations) {
      const icon =
        v.severity === "error" ? "E" : v.severity === "warning" ? "W" : "I";

      lines.push(`[${icon}] ${v.location.file}:${v.location.line}`);
      lines.push(`    ${v.message}`);

      if (v.suggestion) {
        lines.push("");
        for (const line of v.suggestion.split("\n")) {
          lines.push(`    ${line}`);
        }
      }

      if (v.relatedLocations && v.relatedLocations.length > 0) {
        lines.push("");
        lines.push("    Related:");
        for (const loc of v.relatedLocations.slice(0, 3)) {
          lines.push(`      - ${loc.file}:${loc.line}`);
        }
        if (v.relatedLocations.length > 3) {
          lines.push(`      ... and ${v.relatedLocations.length - 3} more`);
        }
      }

      lines.push("");
    }
  }

  lines.push("=".repeat(80));

  if (results.hasErrors) {
    lines.push("Failed. Fix the above errors.");
  } else {
    lines.push("Warnings found.");
  }

  lines.push("=".repeat(80));
  lines.push("");

  return lines.join("\n");
}

// =============================================================================
// Configuration
// =============================================================================

export type {
    ConfigSource,
    IssueCatalog,
    IssueCategory,
    IssueDef,
    IssueImpact,
    ParsedPattern,
    PatternValue,
    ResolvedConfig,
    ResolvedPatternValue,
    ResolvedScope,
    ScopeConfig,
    Severity,
    ViolaConfig as ViolaFileConfig
} from "./src/config/mod.ts";

export {
    compareImpact,
    IMPACT_ORDER,
    impactValue,
    loadConfig,
    matchesFilePattern,
    matchesIssuePattern,
    resolveIssueSeverity
} from "./src/config/mod.ts";

//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Viola - Convention linter for codebases
 *
 * Checks for convention violations: naming patterns, file organization,
 * code duplication, and project-specific rules. Not a replacement for
 * language linters; those handle correctness. This handles everything else.
 *
 * Crawls the codebase once, extracts structured data (functions, types,
 * imports, strings), and runs multiple checkers against it.
 *
 * ## Configuration
 *
 * ```ts
 * // viola.config.ts
 * import { viola, report, when } from "@hiisi/viola";
 * import defaultLints from "@hiisi/viola-default-lints";
 *
 * export default viola()
 *   .use(defaultLints)  // plugin adds linters + default rules
 *   .rule(report.off, when.in("**\/*_test.ts"));  // your overrides (last wins!)
 * ```
 *
 * Rules use "last wins" semantics (like CSS) - later rules override earlier ones.
 *
 * ### Without Plugin Defaults
 *
 * ```ts
 * // Define all rules yourself
 * import { viola, report, when, Impact } from "@hiisi/viola";
 * import { linters } from "@hiisi/viola-default-lints";
 *
 * export default viola()
 *   .add(linters)  // just linters, no default rules
 *   .rule(report.error, when.impact.atLeast(Impact.Major))
 *   .rule(report.warn, when.impact.is(Impact.Minor))
 *   .rule(report.off, when.in("**\/*_test.ts"));
 * ```
 *
 * ## Custom Linters
 *
 * ```ts
 * import { BaseLinter, type Issue } from "@hiisi/viola";
 *
 * class MyLinter extends BaseLinter {
 *   readonly meta = {
 *     id: "my-linter",
 *     name: "My Linter",
 *     description: "Checks naming conventions",
 *   };
 *
 *   readonly catalog = {
 *     "my-linter/bad-name": {
 *       category: "consistency",
 *       impact: "minor",
 *       description: "Name doesn't follow convention",
 *     },
 *   };
 *
 *   readonly requirements = { functions: true };
 *
 *   lint(data, config): Issue[] {
 *     return [];
 *   }
 * }
 * ```
 *
 * ## Rule Evaluation
 *
 * Issues emitted by linters are evaluated against configuration rules to
 * determine their report level (error, warn, info, hint, off, skip).
 * Rules use "last wins" semantics - later rules override earlier ones.
 *
 * @module
 */

// =============================================================================
// Data Types
// =============================================================================

export type {
  CodebaseData,
  CrawlConfig,
  ExportInfo,
  FileInfo,
  FunctionInfo,
  FunctionParam,
  ImportInfo,
  Issue,
  LinterConfig,
  LinterResult,
  LintResults,
  SchemaInfo,
  SourceLocation,
  StringLiteral,
  TypeField,
  TypeInfo,
} from "./src/data/mod.ts";

// =============================================================================
// Utilities
// =============================================================================

export {
  // Freeze
  assertFrozen,
  BODY_SIMILARITY_THRESHOLDS,
  classifySimilarity,
  type CodeFingerprint,
  // Similarity
  combinedSimilarity,
  // Hashing
  combineHashes,
  compareCodeBodies,
  compareIdentifiers,
  createFingerprint,
  deepFreeze,
  djb2Hash,
  findAllSimilarPairs,
  findExactDuplicates,
  findSimilar,
  fingerprintsMightMatch,
  fnv1aHash,
  frozenArray,
  frozenCopy,
  frozenMap,
  frozenObject,
  frozenSet,
  groupByHash,
  groupByStructure,
  hashCodeBody,
  hashContent,
  hashStructure,
  isDeeplyFrozen,
  jaccardNGramSimilarity,
  jaccardSimilarity,
  levenshteinDistance,
  levenshteinSimilarity,
  NAME_SIMILARITY_THRESHOLDS,
  normalizeCode,
  type SimilarityLevel,
  type SimilarityMatch,
  type SimilarityThresholds,
  tokenize,
  tokenSimilarity,
} from "./src/utils/mod.ts";

// =============================================================================
// Runtime
// =============================================================================

export { crawlCodebase, DEFAULT_CONFIG } from "./src/runtime/mod.ts";
export {
  type ProjectRunOptions,
  registerBuilderLinters,
  type ResolvedRun,
  resolveRun,
} from "./src/runtime/mod.ts";

// =============================================================================
// Linters
// =============================================================================

export {
  // Base class
  BaseLinter,
  isLinter,
  // Types
  type LinterConstructor,
  type LinterDataRequirements,
  type LinterMeta,
  // Registry
  register,
  registerLinter,
  registry,
  runLinter,
  runLinters,
  type RunOptions,
} from "./src/linters/mod.ts";

// =============================================================================
// Plugin Loader
// =============================================================================

export {
  clearLinters,
  discoverPlugin,
  discoverPlugins,
  getRegisteredLinters,
  loadPlugin,
  loadPlugins,
  type PluginLoadResult,
  type PluginsLoadResult,
  registerDiscoveredLinters,
  resolveBundle,
  resolvePreset,
} from "./src/runtime/plugins.ts";

// =============================================================================
// Plugin Types
// =============================================================================

export type {
  DiscoveredBundle,
  DiscoveredPreset,
  DiscoveredSchema,
  JSONSchema,
  PluginDiscoveryResult,
  PluginsDiscoveryResult,
  PresetPatternValue,
  PresetScopeConfig,
  ViolaConfigPreset,
  ViolaPlugin as ViolaPluginModule,
} from "./src/types/mod.ts";

export {
  derivePluginName,
  isQualifiedName,
  parseQualifiedName,
  qualifiedName,
} from "./src/types/mod.ts";

// =============================================================================
// High-Level API
// =============================================================================

import type { Frozen } from "@hiisi/flash-freeze";
import {
  countByLevel,
  type EvaluatedIssue,
  evaluateIssues,
  filterReportableIssues,
  formatValidationErrors,
  hasErrors as hasErrorLevel,
  type IssueCatalog,
  mergeLinterConfig,
  type Rule,
  validateLinterConfig,
} from "./src/config/mod.ts";
import { ReportLevel } from "./src/conditions/mod.ts";
import type {
  CrawlConfig,
  Issue,
  LinterConfig,
  LintResults,
} from "./src/data/mod.ts";
import type {
  GrammarRegistry,
  GrammarRelationshipRule,
} from "./src/grammars/mod.ts";
import { registry, runLinters, type RunOptions } from "./src/linters/mod.ts";
import { crawlCodebase, DEFAULT_CONFIG } from "./src/runtime/mod.ts";
import {
  catalogsOf,
  DEFAULT_INCLUDE,
  type ProjectRunOptions,
  resolveRun,
} from "./src/runtime/project.ts";
import type { ViolaOptions } from "./src/runtime/types/run.types.ts";

export type { ViolaOptions } from "./src/runtime/types/run.types.ts";
import {
  discoverPlugins,
  registerDiscoveredLinters,
} from "./src/runtime/plugins.ts";

/**
 * Extended results with evaluated issues.
 */
export interface EvaluatedResults extends LintResults {
  /** Issues with report levels applied */
  evaluatedIssues: EvaluatedIssue[];
  /** Counts by report level */
  levelCounts: Record<ReportLevel, number>;
  /** Whether any issue has error level */
  hasErrorLevel: boolean;
}

/**
 * Run viola with the given configuration.
 *
 * @param options - Configuration options
 * @returns Check results
 */
export async function runViola(options: ViolaOptions): Promise<LintResults> {
  const verbose = options.verbose ?? false;

  const config: CrawlConfig = {
    projectRoot: options.projectRoot ?? Deno.cwd(),
    include: options.include ?? DEFAULT_INCLUDE,
    exclude: options.exclude ?? DEFAULT_CONFIG.exclude ?? [],
    extensions: options.extensions ?? DEFAULT_CONFIG.extensions ?? [],
    linters: options.linters ?? {},
    reportOnly: options.reportOnly ?? false,
    verbose,
  };

  // Load plugins using full discovery
  const plugins = options.plugins ?? [];
  let discovery = null;
  let mergedLinterConfig: Record<string, Record<string, unknown>> = {};

  if (plugins.length > 0) {
    if (verbose) {
      console.log(`Loading ${plugins.length} plugin(s)...`);
    }

    // Use full discovery to get bundles, presets, schemas
    discovery = await discoverPlugins(plugins, { verbose });

    if (!discovery.allSucceeded) {
      const failed = discovery.results.filter((r) => !r.success);
      console.error(`Failed to load ${failed.length} plugin(s):`);
      for (const f of failed) {
        console.error(`  - ${f.specifier}: ${f.error}`);
      }
    }

    // Register all discovered linters
    const registeredIds = registerDiscoveredLinters(discovery);

    if (verbose) {
      console.log(`Registered ${registeredIds.length} linter(s) from plugins`);

      // Report on bundles and presets
      if (discovery.allBundles.size > 0) {
        console.log(`Found ${discovery.allBundles.size} bundle(s)`);
      }
      if (discovery.allPresets.size > 0) {
        console.log(`Found ${discovery.allPresets.size} preset(s)`);
      }
      if (discovery.defaultPresets.length > 0) {
        console.log(
          `Auto-applying ${discovery.defaultPresets.length} default preset(s)`,
        );
      }
      if (discovery.bundleCollisions.length > 0) {
        console.log(
          `Bundle name collisions: ${discovery.bundleCollisions.join(", ")}`,
        );
      }
      if (discovery.presetCollisions.length > 0) {
        console.log(
          `Preset name collisions: ${discovery.presetCollisions.join(", ")}`,
        );
      }
      console.log();
    }

    // Collect linter configs from presets
    // Order: default presets -> inherited presets -> user config
    const presetConfigs: Record<string, Record<string, unknown>>[] = [];

    // 1. Default presets (auto-applied)
    for (const preset of discovery.defaultPresets) {
      // Presets primarily define severity rules, but may also include linter configs
      // For now, we don't have a way to specify linter config in presets
      // This is a placeholder for future expansion
      if (verbose) {
        console.log(
          `Applied default preset: ${preset.pluginName}/${preset.name}`,
        );
      }
    }

    // 2. Explicitly inherited presets
    const inheritedPresetNames = options.inherit ?? [];
    for (const presetName of inheritedPresetNames) {
      const preset = discovery.allPresets.get(presetName) ??
        // Try to find by short name
        Array.from(discovery.allPresets.values()).find((p) =>
          p.name === presetName
        );

      if (preset) {
        if (verbose) {
          console.log(
            `Applied inherited preset: ${preset.pluginName}/${preset.name}`,
          );
        }
      } else if (verbose) {
        console.log(`Warning: Preset "${presetName}" not found`);
      }
    }

    // 3. User's linter config (always wins)
    const userLinterConfig = options.linterConfig ?? {};
    mergedLinterConfig = mergeLinterConfig(presetConfigs, userLinterConfig);

    if (verbose && Object.keys(mergedLinterConfig).length > 0) {
      console.log(
        `Merged linter config for: ${
          Object.keys(mergedLinterConfig).join(", ")
        }`,
      );
      console.log();
    }

    // Validate linter config against schemas
    if (Object.keys(mergedLinterConfig).length > 0) {
      const registeredIds = new Set(registry.getIds());
      const validation = validateLinterConfig(
        mergedLinterConfig,
        discovery,
        registeredIds,
      );

      if (validation.warnings.length > 0) {
        for (const warn of validation.warnings) {
          console.warn(`Warning: ${warn}`);
        }
      }

      if (!validation.valid) {
        console.error(formatValidationErrors(validation));
        // Continue anyway - validation errors are warnings, not fatal
      }
    }
  } else {
    // No plugins, just use user config directly
    mergedLinterConfig = options.linterConfig ?? {};
  }

  if (config.verbose) {
    console.log("Crawling codebase...");
  }

  const data = await crawlCodebase(
    config,
    options.grammarRegistry,
    options.grammarRules ?? [],
    { env: options.env, projectRoot: config.projectRoot },
  );

  if (config.verbose) {
    console.log(`Crawled ${data.files.length} files`);
    console.log(`Found ${data.allFunctions.length} functions`);
    console.log(`Found ${data.allTypes.length} types`);
    console.log(`Found ${data.allStrings.length} strings`);
    console.log();
  }

  // Build per-linter config by merging:
  // 1. User's basic linter config (enabled/severity from options.config)
  // 2. Merged linter options from presets + user linterConfig
  const linterConfigs: Record<string, LinterConfig> = {};

  // Start with basic config from options.config (enabled/severity)
  if (options.config) {
    for (const [id, cfg] of Object.entries(options.config)) {
      linterConfigs[id] = { ...cfg };
    }
  }

  // Merge in linter-specific options from mergedLinterConfig
  for (const [id, opts] of Object.entries(mergedLinterConfig)) {
    if (linterConfigs[id]) {
      // Merge options into existing config
      linterConfigs[id] = {
        ...linterConfigs[id],
        options: { ...linterConfigs[id].options, ...opts },
      };
    } else {
      // Create new config with just options
      linterConfigs[id] = {
        enabled: true,
        options: opts,
      };
    }
  }

  const runOptions: RunOptions = {
    only: options.only,
    skip: options.skip,
    config: Object.keys(linterConfigs).length > 0
      ? linterConfigs
      : options.config,
    parallel: options.parallel ?? false,
    verbose,
  };

  const results = await runLinters(data, runOptions);

  // If rules are provided, evaluate issues against them
  if (options.rules && options.rules.length > 0) {
    const catalogs = options.catalogs ?? buildCatalogsFromRegistry();
    const allIssues: Issue[] = [];

    for (const result of results.results) {
      allIssues.push(...result.issues);
    }

    const evaluatedIssues = evaluateIssues(
      allIssues,
      options.rules,
      catalogs,
      ReportLevel.Warn,
    );

    const reportable = filterReportableIssues(evaluatedIssues);
    const levelCounts = countByLevel(evaluatedIssues);
    const hasErr = hasErrorLevel(reportable);

    return {
      ...results,
      evaluatedIssues,
      levelCounts,
      hasErrorLevel: hasErr,
      // Override hasErrors based on evaluated issues
      hasErrors: hasErr || results.hasErrors,
    } as EvaluatedResults;
  }

  return results;
}

/**
 * Build catalogs map from registered linters.
 */
function buildCatalogsFromRegistry(): Map<string, IssueCatalog> {
  return catalogsOf(registry.getAll());
}

/**
 * Check if results have evaluated issues.
 */
function isEvaluatedResults(results: LintResults): results is EvaluatedResults {
  return "evaluatedIssues" in results;
}

/**
 * Get display prefix for a report level.
 */
function levelPrefix(level: ReportLevel): string {
  switch (level) {
    case ReportLevel.Error:
      return "ERROR";
    case ReportLevel.Warn:
      return "WARN";
    case ReportLevel.Info:
      return "INFO";
    case ReportLevel.Hint:
      return "HINT";
    default:
      return "";
  }
}


/**
 * Run viola over a project and report, the way a front end does.
 *
 * Reads the project's config, registers what it declares, runs, prints, and
 * answers with the exit status a caller should use. That whole sequence lived
 * in the cli, so nothing but the cli could perform it: viola's own gate had to
 * shell out to a published copy of itself, which is how a fix on disk stayed
 * invisible to the gate meant to catch it.
 *
 * The cli still owns argument parsing and the subprocess that bridges a
 * foreign project's import map. Neither is needed by a project running viola
 * on itself, since its own manifest is already in effect.
 *
 * @param options - Where the project is and how to run it
 * @returns 0 when the run is clean or only reporting, 1 when it found errors
 */
export async function runProject(
  options: ProjectRunOptions = {},
): Promise<number> {
  const { options: runOptions } = await resolveRun(options);

  // No linters is not a clean project either. A config that registered none,
  // or none this cli could load, checks nothing and would otherwise report
  // "All clear" for the same reason a zero-file run does.
  const configured = (runOptions.rules?.length ?? 0) > 0 ||
    (runOptions.catalogs?.size ?? 0) > 0 ||
    (runOptions.plugins?.length ?? 0) > 0;
  if (!configured && options.allowEmpty !== true) {
    console.error(
      "Refusing to pass: no plugins configured, so nothing would be checked.\n" +
        "\n" +
        "  Create a viola.config.ts naming what to run:\n" +
        "\n" +
        '    import defaultLints from "@hiisi/viola-default-lints";\n' +
        '    import typescript from "@hiisi/viola-grammar-ts";\n' +
        '    import { report, viola, when } from "@hiisi/viola";\n' +
        "\n" +
        "    export default viola()\n" +
        "      .use(defaultLints)\n" +
        "      .add(typescript)\n" +
        "      .rule(report.error, when.confidence.atLeast(1));\n" +
        "\n" +
        "  A grammar is not optional: without one viola reads nothing and\n" +
        "  reports nothing, which looks exactly like a clean project.\n" +
        "\n" +
        "  Pass `allowEmpty` if a project really has nothing to check yet.",
    );
    return 1;
  }
  if (!configured) {
    // `allowEmpty` got us past the refusal, and there is now genuinely nothing
    // to do. Calling on would reach the crawler's own no-grammar guard and
    // throw, which made the documented escape hatch crash instead of pass.
    console.log("Nothing configured to check.");
    return 0;
  }

  const results = await runViola(runOptions);
  console.log(formatResults(results));

  // A run that read nothing is not a clean run. It is a project whose include
  // list points somewhere empty, or whose grammar never matched a file, or
  // whose config registered a grammar into a different copy of viola than the
  // one crawling. Every one of those prints "All clear", which is the worst
  // possible thing to say about a package nobody checked.
  if (results.filesScanned === 0 && options.allowEmpty !== true) {
    console.error(
      "\nRefusing to pass: no files were read.\n" +
        "  A run that scanned nothing cannot say a package is clean.\n" +
        "  Check that the include list points at files that exist, that a\n" +
        "  grammar claims their extensions, and that the config imports the\n" +
        "  same viola that is running. Pass `allowEmpty` if a project really\n" +
        "  has nothing to lint yet.",
    );
    return 1;
  }

  return results.hasErrors && options.reportOnly !== true ? 1 : 0;
}

/** The heading above a finding's other locations, in both formatters. */
const RELATED_HEADING = "    Related:";

/**
 * The words a run ends with.
 *
 * Both formatters print one of these, and both used to spell them out. That is
 * not a style point: a caller deciding whether a run was clean reads the
 * verdict, and two independent spellings of it are two things that can drift.
 * A publish gate in this workspace searched the output for "All clear" and
 * passed a package with 222 findings, because the phrase also appears in this
 * file's own source and the linter quotes source in its findings.
 */
const VERDICT = {
  clean: "All clear.",
  dirty: "Issues found. Review and address as needed.",
  blocked: "Errors found. Fix before continuing.",
} as const;

/**
 * Format check results for console output.
 *
 * Results carrying evaluated issues are formatted with their report levels;
 * anything else is formatted as raw issues.
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

  // Check if we have evaluated issues
  if (isEvaluatedResults(results)) {
    return formatEvaluatedResults(results, lines);
  }

  // Fall back to raw issue formatting
  return formatRawResults(results, lines);
}

/**
 * Format results with evaluated issues and report levels.
 */
function formatEvaluatedResults(
  results: EvaluatedResults,
  lines: string[],
): string {
  const reportable = filterReportableIssues(results.evaluatedIssues);

  if (reportable.length === 0) {
    lines.push(VERDICT.clean);
    lines.push("");
    return lines.join("\n");
  }

  // Show summary by level
  const counts = results.levelCounts;
  const summaryParts: string[] = [];
  if (counts[ReportLevel.Error] > 0) {
    summaryParts.push(`${counts[ReportLevel.Error]} error(s)`);
  }
  if (counts[ReportLevel.Warn] > 0) {
    summaryParts.push(`${counts[ReportLevel.Warn]} warning(s)`);
  }
  if (counts[ReportLevel.Info] > 0) {
    summaryParts.push(`${counts[ReportLevel.Info]} info`);
  }
  if (counts[ReportLevel.Hint] > 0) {
    summaryParts.push(`${counts[ReportLevel.Hint]} hint(s)`);
  }

  lines.push(`Found ${reportable.length} issue(s): ${summaryParts.join(", ")}`);
  lines.push("");

  // Group by level, then by linter
  const byLevel = new Map<ReportLevel, EvaluatedIssue[]>();
  for (const issue of reportable) {
    const group = byLevel.get(issue.level) ?? [];
    group.push(issue);
    byLevel.set(issue.level, group);
  }

  // Output in severity order
  const levelOrder = [
    ReportLevel.Error,
    ReportLevel.Warn,
    ReportLevel.Info,
    ReportLevel.Hint,
  ];

  for (const level of levelOrder) {
    const issues = byLevel.get(level);
    if (!issues || issues.length === 0) continue;

    lines.push("-".repeat(80));
    lines.push(`${levelPrefix(level)} (${issues.length})`);
    lines.push("-".repeat(80));
    lines.push("");

    for (const evaluated of issues) {
      const issue = evaluated.issue;
      lines.push(
        `[${issue.kind}] ${issue.location.file}:${issue.location.line}`,
      );
      lines.push(`    ${issue.message}`);
      lines.push(`    (confidence: ${issue.confidence}%)`);

      if (issue.suggestion) {
        lines.push("");
        for (const line of issue.suggestion.split("\n")) {
          lines.push(`    ${line}`);
        }
      }

      if (issue.relatedLocations && issue.relatedLocations.length > 0) {
        lines.push("");
        lines.push(RELATED_HEADING);
        for (const loc of issue.relatedLocations.slice(0, 3)) {
          lines.push(`      - ${loc.file}:${loc.line}`);
        }
        if (issue.relatedLocations.length > 3) {
          lines.push(`      ... and ${issue.relatedLocations.length - 3} more`);
        }
      }

      lines.push("");
    }
  }

  lines.push("=".repeat(80));

  if (results.hasErrorLevel) {
    lines.push(VERDICT.blocked);
  } else if (reportable.length > 0) {
    lines.push(VERDICT.dirty);
  }

  lines.push("=".repeat(80));
  lines.push("");

  return lines.join("\n");
}

/**
 * Format results with raw issues (no rule evaluation).
 */
function formatRawResults(results: LintResults, lines: string[]): string {
  if (results.totalIssues === 0) {
    lines.push(VERDICT.clean);
    lines.push("");
    return lines.join("\n");
  }

  lines.push(`Found ${results.totalIssues} issue(s)`);
  lines.push("");

  for (const result of results.results) {
    if (result.issues.length === 0) continue;

    lines.push("-".repeat(80));
    lines.push(`${result.linter} (${result.issues.length} issues)`);
    lines.push("-".repeat(80));
    lines.push("");

    for (const issue of result.issues) {
      lines.push(
        `[${issue.kind}] ${issue.location.file}:${issue.location.line}`,
      );
      lines.push(`    ${issue.message}`);
      lines.push(`    (confidence: ${issue.confidence}%)`);

      if (issue.suggestion) {
        lines.push("");
        for (const line of issue.suggestion.split("\n")) {
          lines.push(`    ${line}`);
        }
      }

      if (issue.relatedLocations && issue.relatedLocations.length > 0) {
        lines.push("");
        lines.push(RELATED_HEADING);
        for (const loc of issue.relatedLocations.slice(0, 3)) {
          lines.push(`      - ${loc.file}:${loc.line}`);
        }
        if (issue.relatedLocations.length > 3) {
          lines.push(`      ... and ${issue.relatedLocations.length - 3} more`);
        }
      }

      lines.push("");
    }
  }

  lines.push("=".repeat(80));

  if (results.hasErrors) {
    lines.push("Some linters failed to run.");
  } else if (results.totalIssues > 0) {
    lines.push(VERDICT.dirty);
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
  IssueDef,
  ParsedPattern,
  PatternValue,
  ResolvedConfig,
  ResolvedPatternValue,
  ResolvedScope,
  ScopeConfig,
  ViolaConfig,
} from "./src/config/mod.ts";

export {
  formatValidationErrors,
  grammar,
  isGrammarRelationship,
  isGrammarRelationshipAction,
  isReportAction,
  loadConfig,
  matchesIssuePattern,
  plugin,
  report,
  resolveIssueSeverity,
  validateLinterConfig,
  viola,
  ViolaBuilder,
} from "./src/config/mod.ts";

export type {
  AddInput,
  AddResult,
  EvaluatedIssue,
  GrammarRelationshipAction,
  GrammarRelationshipBuilder,
  LinterInput,
  LinterSetting,
  PluginInput,
  ReportAction,
  Rule,
  RuleAction,
  RunContext,
  ValidationError,
  ValidationResult,
  ViolaBuilderConfig,
  ViolaBuilderConfigExtended,
  ViolaPlugin,
  ViolaPluginFn,
} from "./src/config/mod.ts";

export {
  // Rule evaluation
  countByLevel,
  createEvaluationContext,
  evaluateIssue,
  evaluateIssues,
  filterReportableIssues,
  groupByLevel,
  hasErrors as hasErrorLevelIssues,
} from "./src/config/mod.ts";

// =============================================================================
// Conditions
// =============================================================================
//
// One vocabulary, one comparison, one `when`, one evaluator. These used to be
// exported twice under aliases (`whenCondition`, `ConditionImpact`,
// `alwaysMatch`) because there were two of each and neither could be given the
// plain name.

export type {
  CategoryCondition,
  Comparison,
  ComparisonData,
  CompoundCondition,
  Condition,
  ConfidenceCondition,
  ConstantCondition,
  EnvCondition,
  EnvConditions,
  EvaluationContext,
  FileCondition,
  FileContext,
  GrammarCondition,
  ImpactCondition,
  IssueContext,
  KindCondition,
  LinterCondition,
  NotCondition,
  Ordered,
  WhenBuilder,
} from "./src/conditions/mod.ts";

export {
  always,
  atLeast,
  atMost,
  between,
  Category,
  compareImpact,
  ConditionExpr,
  contains,
  describe,
  endsWith,
  equals,
  evaluateComparison,
  evaluateCondition,
  glob,
  Impact,
  IMPACT_ORDER,
  impactValue,
  lessThan,
  matches,
  moreThan,
  never,
  noneOf,
  notEquals,
  oneOf,
  ReportLevel,
  startsWith,
  when,
} from "./src/conditions/mod.ts";

// =============================================================================
// Grammars
// =============================================================================

export type {
  ExtractionQueries,
  GrammarDefinition,
  GrammarEntry,
  GrammarMeta,
  GrammarRelationship,
  GrammarRelationshipRule,
  GrammarResolution,
  GrammarRole,
  GrammarSource,
  GrammarTransforms,
  QueryCaptures,
  RegisteredGrammar,
  ResolvedGrammar,
  SyntaxNode,
} from "./src/grammars/mod.ts";

export {
  clearCache as clearGrammarCache,
  createGrammarRegistry,
  createGrammarResolver,
  createParser,
  extractCompleteFileInfo,
  extractFileData,
  getParser,
  GrammarRegistry,
  GrammarResolver,
  initTreeSitter,
  isInitialized as isTreeSitterInitialized,
  loadGrammar,
  mergeExtractionResults,
  queryAll,
  queryCount,
  queryFirst,
  queryHasMatch,
  reset as resetTreeSitter,
  runQuery,
} from "./src/grammars/mod.ts";

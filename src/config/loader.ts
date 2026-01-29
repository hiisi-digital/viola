/**
 * Configuration loader.
 *
 * Loads viola configuration from deno.json and parses patterns.
 */

import { resolve } from "@std/path";
import {
    IMPACT_ORDER,
    type ConfigSource,
    type IssueCategory,
    type IssueImpact,
    type ParsedPattern,
    type PatternValue,
    type ResolvedConfig,
    type ResolvedPatternValue,
    type ResolvedScope,
    type ScopeConfig,
    type Severity,
    type ViolaConfig,
} from "./types.ts";

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_EXCLUDE = ["node_modules", ".git", "dist", "build", "coverage"];
const CATEGORIES: IssueCategory[] = ["correctness", "maintainability", "consistency", "performance", "style"];

/**
 * Load configuration from deno.json.
 */
export async function loadConfig(
  dir: string,
  options: { verbose?: boolean } = {}
): Promise<{ config: ResolvedConfig; sources: ConfigSource[] }> {
  const sources: ConfigSource[] = [];
  
  const denoPath = resolve(dir, "deno.json");
  const violaConfig = await loadDenoConfig(denoPath);
  
  if (violaConfig) {
    sources.push({ path: denoPath, type: "deno.json" });
  }

  if (options.verbose && sources.length > 0) {
    console.log("Config sources:");
    for (const source of sources) {
      console.log(`  - ${source.path} (${source.type})`);
    }
  }

  const resolved = resolveConfig(violaConfig ?? {});
  return { config: resolved, sources };
}

/**
 * Load viola config from deno.json.
 */
async function loadDenoConfig(path: string): Promise<ViolaConfig | null> {
  try {
    const text = await Deno.readTextFile(path);
    const deno = JSON.parse(text) as { viola?: ViolaConfig };
    return deno.viola ?? null;
  } catch {
    return null;
  }
}

/** Known non-scope fields in viola config */
const RESERVED_CONFIG_FIELDS = ["plugins", "inherit", "config", "include", "exclude"];

/**
 * Resolve raw config into parsed patterns.
 */
function resolveConfig(config: ViolaConfig): ResolvedConfig {
  const scopes: ResolvedScope[] = [];
  const plugins: string[] = config.plugins ?? [];
  const inherit: string[] = config.inherit ?? [];
  const linterConfig: Record<string, Record<string, unknown>> = config.config ?? {};

  for (const [key, value] of Object.entries(config)) {
    // Skip known non-scope fields
    if (RESERVED_CONFIG_FIELDS.includes(key)) {
      continue;
    }

    // Skip non-object entries (shouldn't happen with proper config)
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }

    // Check if this looks like a scope config (has pattern-like keys)
    // vs a linter config object (which would have been in the config field)
    const scopeConfig = value as ScopeConfig;
    const patterns: ResolvedScope["patterns"] = [];

    for (const [patternStr, patternValue] of Object.entries(scopeConfig)) {
      const pattern = parsePattern(patternStr);
      if (!pattern) continue;

      const resolvedValue = resolvePatternValue(patternValue);
      patterns.push({ pattern, value: resolvedValue });
    }

    scopes.push({ filePattern: key, patterns });
  }

  return {
    plugins,
    inherit,
    linterConfig,
    scopes,
    include: [],
    exclude: [...DEFAULT_EXCLUDE],
    extensions: [...DEFAULT_EXTENSIONS],
  };
}

/**
 * Parse a pattern string into components.
 * 
 * Formats:
 * - `linter/issue` - exact match
 * - `linter/*` - all issues from linter
 * - `*::category` - category filter
 * - `*>=impact` - impact comparison
 * - `linter/*::category>=impact` - combined
 */
function parsePattern(pattern: string): ParsedPattern | null {
  let remaining = pattern;
  let linter = "*";
  let issue = "*";
  let category: IssueCategory | undefined;
  let impact: ParsedPattern["impact"];

  // Extract category filter (::category)
  const categoryMatch = remaining.match(/::(\w+)/);
  if (categoryMatch) {
    const cat = categoryMatch[1] as IssueCategory;
    if (CATEGORIES.includes(cat)) {
      category = cat;
    }
    remaining = remaining.replace(categoryMatch[0], "");
  }

  // Extract impact comparison (>=major, =minor, !=trivial, etc.)
  const impactMatch = remaining.match(/(>=|<=|>|<|!=|=)(critical|major|minor|trivial)/);
  if (impactMatch) {
    const operator = impactMatch[1] as ParsedPattern["impact"] extends undefined ? never : NonNullable<ParsedPattern["impact"]>["operator"];
    const value = impactMatch[2] as IssueImpact;
    if (IMPACT_ORDER.includes(value)) {
      impact = { operator, value };
    }
    remaining = remaining.replace(impactMatch[0], "");
  }

  // Parse linter/issue
  remaining = remaining.trim();
  if (remaining) {
    const slashIdx = remaining.indexOf("/");
    if (slashIdx !== -1) {
      linter = remaining.slice(0, slashIdx) || "*";
      issue = remaining.slice(slashIdx + 1) || "*";
    } else {
      // Just a linter name or "*"
      linter = remaining;
      issue = "*";
    }
  }

  return {
    raw: pattern,
    linter,
    issue,
    category,
    impact,
  };
}

/**
 * Resolve a pattern value to normalized form.
 */
function resolvePatternValue(value: PatternValue): ResolvedPatternValue {
  if (typeof value === "string") {
    return { severity: value, minConfidence: 0 };
  }
  return {
    severity: value.severity,
    minConfidence: value.minConfidence ?? 0,
  };
}

/**
 * Check if a file matches a glob pattern.
 */
export function matchesFilePattern(filePath: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, "{{DOUBLESTAR}}")
        .replace(/\*/g, "[^/]*")
        .replace(/{{DOUBLESTAR}}/g, ".*") +
      "$"
  );
  return regex.test(filePath);
}

/**
 * Check if an issue matches a parsed pattern.
 */
export function matchesIssuePattern(
  issueKind: string,
  issueCategory: IssueCategory,
  issueImpact: IssueImpact,
  pattern: ParsedPattern
): boolean {
  // Parse issue kind (linter/issue format)
  const slashIdx = issueKind.indexOf("/");
  const linterId = slashIdx !== -1 ? issueKind.slice(0, slashIdx) : issueKind;
  const issueName = slashIdx !== -1 ? issueKind.slice(slashIdx + 1) : "*";

  // Check linter match
  if (pattern.linter !== "*" && !matchesGlob(linterId, pattern.linter)) {
    return false;
  }

  // Check issue match
  if (pattern.issue !== "*" && !matchesGlob(issueName, pattern.issue)) {
    return false;
  }

  // Check category
  if (pattern.category && pattern.category !== issueCategory) {
    return false;
  }

  // Check impact
  if (pattern.impact) {
    const issueIdx = IMPACT_ORDER.indexOf(issueImpact);
    const patternIdx = IMPACT_ORDER.indexOf(pattern.impact.value);

    switch (pattern.impact.operator) {
      case "=":
        if (issueIdx !== patternIdx) return false;
        break;
      case "!=":
        if (issueIdx === patternIdx) return false;
        break;
      case ">=":
        // Higher impact = lower index
        if (issueIdx > patternIdx) return false;
        break;
      case "<=":
        if (issueIdx < patternIdx) return false;
        break;
      case ">":
        if (issueIdx >= patternIdx) return false;
        break;
      case "<":
        if (issueIdx <= patternIdx) return false;
        break;
    }
  }

  return true;
}

/**
 * Simple glob matching for linter/issue names.
 */
function matchesGlob(value: string, pattern: string): boolean {
  if (pattern === "*") return true;
  
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$"
  );
  return regex.test(value);
}

/**
 * Resolve the severity for an issue given a config and file path.
 */
export function resolveIssueSeverity(
  config: ResolvedConfig,
  filePath: string,
  issueKind: string,
  issueCategory: IssueCategory,
  issueImpact: IssueImpact,
  confidence: number
): Severity | null {
  let result: ResolvedPatternValue | null = null;

  // Find matching scopes
  for (const scope of config.scopes) {
    if (!matchesFilePattern(filePath, scope.filePattern)) {
      continue;
    }

    // Find last matching pattern (last wins)
    for (const { pattern, value } of scope.patterns) {
      if (matchesIssuePattern(issueKind, issueCategory, issueImpact, pattern)) {
        result = value;
      }
    }
  }

  // No match - default to warn
  if (!result) {
    return "warn";
  }

  // Check confidence threshold
  if (confidence < result.minConfidence) {
    return null; // Filter out
  }

  return result.severity === "off" ? null : result.severity;
}

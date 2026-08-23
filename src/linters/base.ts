//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

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

import type { IssueCatalog, IssueDef } from "../config/types.ts";
import type { CategoryName, ImpactName } from "../conditions/vocabulary.ts";
import type {
  CodebaseData,
  Issue,
  LinterConfig,
  LinterResult,
  SourceLocation,
} from "../data/types.ts";
import type { LinterDataRequirements, LinterMeta } from "./types/base.types.ts";

// Re-export types for convenience
export type {
  LinterConstructor,
  LinterDataRequirements,
  LinterMeta,
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
  /**
   * Find the issues.
   *
   * May be synchronous or not. A linter that only reads the codebase model returns an
   * array and costs nothing extra; one that has to reach outside it, to a subprocess, a
   * manifest on disk or a registry, returns a promise. The doctest linter is the case that
   * forced the choice: checking that an example still works means running it, and running
   * it means spawning `deno test --doc` or `node --test`, which no synchronous signature
   * can express.
   */
  abstract lint(
    data: CodebaseData,
    config: LinterConfig,
  ): Issue[] | Promise<Issue[]>;

  /**
   * Run the linter with timing and error handling.
   *
   * @param data - Frozen codebase data
   * @param config - Linter configuration
   * @returns Linter result with issues and timing
   */
  async run(data: CodebaseData, config: LinterConfig): Promise<LinterResult> {
    const startTime = performance.now();

    try {
      // `await` on a plain array is a microtask and nothing more, so a synchronous linter
      // pays a tick rather than a scheduler.
      const issues = dedupe(await this.lint(data, config));
      const durationMs = performance.now() - startTime;

      return {
        linter: this.meta.id,
        issues,
        durationMs,
        success: true,
      };
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);

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
  getCategory(kind: string): CategoryName {
    return this.catalog[kind]?.category ?? "consistency";
  }

  /**
   * Get impact for an issue kind.
   */
  getImpact(kind: string): ImpactName {
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
    } = {},
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

/**
 * Drop findings that repeat one already reported.
 *
 * A linter that walks pairs, or reads the same export through several
 * re-export paths, can raise the identical finding many times over: same kind,
 * same line, same words. `orphaned-code` reported one export three times, and
 * `similar-functions` put one line in a report eight times.
 *
 * Nobody can act on the second copy, and a count made of repeats stops telling
 * anybody how much is wrong. Deduping here rather than in each linter means a
 * plugin cannot reintroduce it.
 */
function dedupe(issues: readonly Issue[]): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const issue of issues) {
    const key =
      `${issue.kind}\u0000${issue.location.file}\u0000${issue.location.line}` +
      `\u0000${issue.location.column ?? ""}\u0000${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

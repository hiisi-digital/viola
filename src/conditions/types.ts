/**
 * Condition Types
 *
 * Core types for the condition evaluation system.
 * Conditions are evaluated at runtime against an EvaluationContext
 * to determine whether rules should apply.
 *
 * @module
 */

import type { Comparison } from "./comparisons.ts";

/**
 * Impact levels for issues.
 * Ordered from lowest to highest severity.
 */
export enum Impact {
  Trivial = 0,
  Minor = 1,
  Moderate = 2,
  Major = 3,
  Critical = 4,
}

/**
 * Categories for issues.
 */
export enum Category {
  /** Code correctness issues */
  Correctness = "correctness",
  /** Security vulnerabilities */
  Security = "security",
  /** Performance issues */
  Performance = "performance",
  /** Code maintainability */
  Maintainability = "maintainability",
  /** Code style/formatting */
  Style = "style",
  /** Documentation issues */
  Documentation = "documentation",
  /** Deprecated code usage */
  Deprecation = "deprecation",
}

/**
 * Information about the current file being analyzed.
 */
export interface FileContext {
  /** File path relative to project root */
  readonly path: string;
  /** File extension (e.g., ".ts", ".sh") */
  readonly extension: string;
  /** Grammar ID that parsed this file */
  readonly grammarId: string;
}

/**
 * Information about an issue being evaluated.
 */
export interface IssueContext {
  /** ID of the linter/grammar that reported this issue */
  readonly by: string;
  /** Issue kind (e.g., "duplicate", "missing-docs") */
  readonly kind: string;
  /** Impact level */
  readonly impact: Impact;
  /** Confidence score (0-100) */
  readonly confidence: number;
  /** Issue category */
  readonly category: Category;
  /** Line number where issue was found */
  readonly line: number;
  /** Column number where issue was found */
  readonly column?: number;
}

/**
 * Context available when evaluating conditions.
 * This is populated at runtime based on what's being evaluated.
 */
export interface EvaluationContext {
  /** Current file context (when evaluating file-level conditions) */
  readonly file?: FileContext;
  /** Current issue context (when evaluating issue-level conditions) */
  readonly issue?: IssueContext;
  /** Environment variables */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Project root directory */
  readonly projectRoot: string;
}

/**
 * A condition that can be evaluated against a context.
 * Conditions are composable with .and().
 */
export interface Condition {
  /**
   * Evaluate this condition against a context.
   */
  evaluate(context: EvaluationContext): boolean;

  /**
   * Create a new condition that requires both this AND the other to pass.
   *
   * @example
   * when.in("src/**").and(when.issue.impact(atLeast(Impact.Major)))
   */
  and(other: Condition): Condition;

  /**
   * Create a new condition that requires either this OR the other to pass.
   *
   * @example
   * when.in("src/**").or(when.in("lib/**"))
   */
  or(other: Condition): Condition;

  /**
   * Negate this condition.
   *
   * @example
   * when.in("**\/tests/**").not()
   */
  not(): Condition;
}

/**
 * Builder for environment variable conditions.
 */
export interface EnvConditionBuilder {
  /**
   * Check if the environment variable exists (is set).
   *
   * @example
   * when.env("CI").exists()
   */
  exists(): Condition;

  /**
   * Check the environment variable's value using a comparison.
   *
   * @example
   * when.env("NODE_ENV").is(equals("production"))
   * when.env("TIMEOUT").is(atLeast(30))
   */
  is(comparison: Comparison<string | number>): Condition;
}

/**
 * Namespace for issue-related conditions.
 */
export interface IssueConditions {
  /**
   * Match issues by their source (linter or grammar ID).
   *
   * @example
   * when.issue.by(similarFunctions)
   * when.issue.by("similar-functions")
   */
  by(source: { meta: { id: string } } | { id: string } | string): Condition;

  /**
   * Match issues by kind.
   *
   * @example
   * when.issue.kind("duplicate")
   */
  kind(issueKind: string): Condition;

  /**
   * Match issues by impact level.
   *
   * @example
   * when.issue.impact(atLeast(Impact.Major))
   */
  impact(comparison: Comparison<Impact>): Condition;

  /**
   * Match issues by confidence level (0-100).
   *
   * @example
   * when.issue.confidence(atLeast(80))
   */
  confidence(comparison: Comparison<number>): Condition;

  /**
   * Match issues by category.
   *
   * @example
   * when.issue.category(equals(Category.Security))
   */
  category(comparison: Comparison<Category>): Condition;
}

/**
 * The `when` condition builder interface.
 */
export interface WhenBuilder {
  /**
   * Match files by glob patterns.
   *
   * @example
   * when.in("*.ts", "*.tsx")
   * when.in("**\/tests/**")
   */
  in(...patterns: string[]): Condition;

  /**
   * Issue-related conditions.
   */
  readonly issue: IssueConditions;

  /**
   * Environment variable conditions.
   *
   * @example
   * when.env("CI").exists()
   * when.env("NODE_ENV").is(equals("production"))
   */
  env(varName: string): EnvConditionBuilder;
}

/**
 * When Condition API
 *
 * Implementation of the `when` condition builder for defining
 * when rules should apply.
 *
 * @example
 * ```ts
 * // Path matching
 * when.in("*.ts", "*.tsx")
 * when.in("**\/tests/**")
 *
 * // Issue properties
 * when.issue.by(similarFunctions)
 * when.issue.impact(atLeast(Impact.Major))
 * when.issue.confidence(atLeast(80))
 *
 * // Environment
 * when.env("CI").exists()
 * when.env("NODE_ENV").is(equals("production"))
 *
 * // Composition
 * when.in("src/**").and(when.issue.impact(atLeast(Impact.Major)))
 * when.env("CI").exists().and(when.issue.confidence(atLeast(90)))
 * ```
 *
 * @module
 */

import type { Comparison } from "./comparisons.ts";
import type {
    Category,
    Condition,
    EnvConditionBuilder,
    EvaluationContext,
    Impact,
    IssueConditions,
    WhenBuilder,
} from "./types.ts";

/**
 * Minimatch-like glob matching.
 * For now, a simple implementation. Can be replaced with a proper glob library.
 */
function matchGlob(pattern: string, path: string): boolean {
  // Convert glob pattern to regex
  // We need to be careful about the order of replacements
  
  // First, escape special regex characters (except * and ?)
  let regexPattern = "";
  let i = 0;
  
  while (i < pattern.length) {
    const char = pattern[i] as string;
    const nextChar = pattern[i + 1] as string | undefined;
    
    if (char === "*" && nextChar === "*") {
      // Handle **
      const afterStars = pattern[i + 2] as string | undefined;
      if (i === 0 && afterStars === "/") {
        // **/ at start - matches any prefix including empty
        regexPattern += "(?:.*/)?";
        i += 3;
      } else if (afterStars === "/" || afterStars === undefined) {
        // **/ in middle or ** at end - matches any path segments
        if (afterStars === "/") {
          regexPattern += "(?:.*/)?";
          i += 3;
        } else {
          // ** at end
          regexPattern += ".*";
          i += 2;
        }
      } else {
        // ** followed by something else - treat as .*
        regexPattern += ".*";
        i += 2;
      }
    } else if (char === "*") {
      // Single * - matches anything except /
      regexPattern += "[^/]*";
      i++;
    } else if (char === "?") {
      // ? matches single character except /
      regexPattern += "[^/]";
      i++;
    } else if (".+^${}()|[]\\".includes(char)) {
      // Escape special regex characters
      regexPattern += "\\" + char;
      i++;
    } else {
      regexPattern += char;
      i++;
    }
  }

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(path);
}

/**
 * Base implementation of Condition interface.
 */
class BaseCondition implements Condition {
  constructor(
    private readonly predicate: (ctx: EvaluationContext) => boolean,
    private readonly description?: string
  ) {}

  evaluate(context: EvaluationContext): boolean {
    return this.predicate(context);
  }

  and(other: Condition): Condition {
    return new BaseCondition(
      (ctx) => this.evaluate(ctx) && other.evaluate(ctx),
      `(${this.description} AND ${other.toString()})`
    );
  }

  or(other: Condition): Condition {
    return new BaseCondition(
      (ctx) => this.evaluate(ctx) || other.evaluate(ctx),
      `(${this.description} OR ${other.toString()})`
    );
  }

  not(): Condition {
    return new BaseCondition(
      (ctx) => !this.evaluate(ctx),
      `NOT(${this.description})`
    );
  }

  toString(): string {
    return this.description ?? "Condition";
  }
}

/**
 * Create a condition that always evaluates to true.
 */
function alwaysCondition(): Condition {
  return new BaseCondition(() => true, "always");
}

/**
 * Create a condition that always evaluates to false.
 */
function neverCondition(): Condition {
  return new BaseCondition(() => false, "never");
}

/**
 * Path pattern matching condition.
 *
 * @example
 * when.in("*.ts", "*.tsx")
 * when.in("**\/tests/**")
 */
function inPatterns(...patterns: string[]): Condition {
  return new BaseCondition((ctx) => {
    if (!ctx.file) return false;
    return patterns.some((p) => matchGlob(p, ctx.file!.path));
  }, `in(${patterns.join(", ")})`);
}

/**
 * Extract ID from various source types.
 */
function extractId(
  source: { meta: { id: string } } | { id: string } | string
): string {
  if (typeof source === "string") return source;
  if ("meta" in source) return source.meta.id;
  return source.id;
}

/**
 * Issue conditions namespace implementation.
 */
const issueConditions: IssueConditions = {
  by(source: { meta: { id: string } } | { id: string } | string): Condition {
    const id = extractId(source);
    return new BaseCondition(
      (ctx) => ctx.issue?.by === id,
      `issue.by(${id})`
    );
  },

  kind(issueKind: string): Condition {
    return new BaseCondition(
      (ctx) => ctx.issue?.kind === issueKind,
      `issue.kind(${issueKind})`
    );
  },

  impact(comparison: Comparison<Impact>): Condition {
    return new BaseCondition((ctx) => {
      if (ctx.issue?.impact === undefined) return false;
      return comparison.evaluate(ctx.issue.impact);
    }, `issue.impact(${comparison.toString()})`);
  },

  confidence(comparison: Comparison<number>): Condition {
    return new BaseCondition((ctx) => {
      if (ctx.issue?.confidence === undefined) return false;
      return comparison.evaluate(ctx.issue.confidence);
    }, `issue.confidence(${comparison.toString()})`);
  },

  category(comparison: Comparison<Category>): Condition {
    return new BaseCondition((ctx) => {
      if (ctx.issue?.category === undefined) return false;
      return comparison.evaluate(ctx.issue.category);
    }, `issue.category(${comparison.toString()})`);
  },
};

/**
 * Environment variable condition builder.
 *
 * @example
 * when.env("CI").exists()
 * when.env("NODE_ENV").is(equals("production"))
 */
function envCondition(varName: string): EnvConditionBuilder {
  return {
    exists(): Condition {
      return new BaseCondition(
        (ctx) => ctx.env[varName] !== undefined && ctx.env[varName] !== "",
        `env(${varName}).exists()`
      );
    },

    is(comparison: Comparison<string | number>): Condition {
      return new BaseCondition((ctx) => {
        const value = ctx.env[varName];
        if (value === undefined) return false;

        // Try numeric comparison first
        const numValue = Number(value);
        if (!isNaN(numValue)) {
          return (comparison as Comparison<number>).evaluate(numValue);
        }

        // Fall back to string comparison
        return (comparison as Comparison<string>).evaluate(value);
      }, `env(${varName}).is(${comparison.toString()})`);
    },
  };
}

/**
 * The `when` condition builder.
 *
 * Provides a fluent API for building conditions that determine
 * when rules should apply.
 *
 * @example
 * ```ts
 * // Path matching
 * when.in("*.ts", "*.tsx")
 * when.in("**\/tests/**")
 *
 * // Issue properties
 * when.issue.by(similarFunctions)
 * when.issue.impact(atLeast(Impact.Major))
 * when.issue.confidence(atLeast(80))
 *
 * // Environment
 * when.env("CI").exists()
 * when.env("NODE_ENV").is(equals("production"))
 *
 * // Composition
 * when.in("src/**").and(when.issue.impact(atLeast(Impact.Major)))
 * ```
 */
export const when: WhenBuilder = {
  in: inPatterns,
  issue: issueConditions,
  env: envCondition,
};

// Re-export for convenience
export { alwaysCondition as always, neverCondition as never };
export type { Condition, EvaluationContext };


/**
 * Fluent builder API for viola configuration.
 *
 * @example
 * ```ts
 * import { viola, report, when, Impact, Category } from "@hiisi/viola";
 * import { defaultLints } from "@hiisi/viola-default-lints";
 *
 * export default viola()
 *   .use(defaultLints)
 *   .rule(report.error, when.impact.atLeast(Impact.Major))
 *   .rule(report.warn, when.impact.is(Impact.Minor))
 *   .rule(report.off, when.in("**\/*_test.ts"));
 * ```
 *
 * @module
 */

import { deepFreeze, type Frozen } from "@hiisi/flash-freeze";
import type { BaseLinter } from "../linters/base.ts";
import type { RuleAction } from "./actions.ts";
import type { Condition, ConditionExpr } from "./conditions.ts";

// =============================================================================
// Types
// =============================================================================

/**
 * A linter plugin - can be a single linter, array of linters, or a plugin object.
 */
export type LinterPlugin =
  | BaseLinter
  | BaseLinter[]
  | { linters?: BaseLinter[]; default?: BaseLinter | BaseLinter[] };

/**
 * A linter setting (configuration option).
 */
export interface LinterSetting {
  readonly linter: string;
  readonly key: string;
  readonly value: unknown;
}

/**
 * A rule: action + condition.
 */
export interface Rule {
  readonly action: Frozen<RuleAction>;
  readonly condition: Frozen<Condition>;
}

/**
 * The resolved configuration from the builder.
 */
export interface ViolaBuilderConfig {
  readonly plugins: readonly LinterPlugin[];
  readonly settings: readonly Frozen<LinterSetting>[];
  readonly rules: readonly Frozen<Rule>[];
}

// =============================================================================
// Main Builder
// =============================================================================

/**
 * Main viola configuration builder.
 */
export class ViolaBuilder {
  private _plugins: LinterPlugin[] = [];
  private _settings: Frozen<LinterSetting>[] = [];
  private _rules: Frozen<Rule>[] = [];

  /**
   * Add a linter plugin.
   *
   * @example
   * ```ts
   * viola()
   *   .use(defaultLints)
   *   .use(myCustomLinter)
   * ```
   */
  use(plugin: LinterPlugin): this {
    this._plugins.push(plugin);
    return this;
  }

  /**
   * Configure a linter setting.
   *
   * @example
   * ```ts
   * viola()
   *   .set("similar-functions.threshold", 0.85)
   *   .set("duplicate-strings", { minLength: 12 })
   * ```
   */
  set(key: string, value: unknown): this {
    const dotIndex = key.indexOf(".");
    if (dotIndex === -1) {
      // key is linter id, value is full config object
      if (typeof value === "object" && value !== null) {
        for (const [k, v] of Object.entries(value)) {
          this._settings.push(deepFreeze({ linter: key, key: k, value: v }));
        }
      }
    } else {
      // dot notation: "linter.option"
      const linter = key.slice(0, dotIndex);
      const option = key.slice(dotIndex + 1);
      this._settings.push(deepFreeze({ linter, key: option, value }));
    }
    return this;
  }

  /**
   * Add a classification rule.
   *
   * @example
   * ```ts
   * viola()
   *   .rule(report.error, when.impact.atLeast(Impact.Major))
   *   .rule(report.off, when.in("**\/*_test.ts"))
   *   .rule(report.error, when.in("src/**").and(when.category.is(Category.Correctness)))
   * ```
   */
  rule(action: Frozen<RuleAction>, condition: ConditionExpr): this {
    this._rules.push(deepFreeze({
      action,
      condition: condition.condition,
    }));
    return this;
  }

  /**
   * Build the final configuration.
   * 
   * Note: plugins are NOT frozen because they're class instances with methods.
   * Only settings and rules (pure data) are frozen.
   */
  build(): ViolaBuilderConfig {
    return {
      plugins: this._plugins,
      settings: this._settings,
      rules: this._rules,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new viola configuration builder.
 *
 * @example
 * ```ts
 * import { viola, report, when, Impact } from "@hiisi/viola";
 *
 * export default viola()
 *   .use(myLinters)
 *   .rule(report.error, when.impact.atLeast(Impact.Major))
 *   .rule(report.off, when.in("**\/*_test.ts"));
 * ```
 */
export function viola(): ViolaBuilder {
  return new ViolaBuilder();
}

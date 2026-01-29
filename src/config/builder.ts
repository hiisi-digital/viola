/**
 * Fluent builder API for viola configuration.
 *
 * @example
 * ```ts
 * import { viola } from "@hiisi/viola";
 * import defaultLints from "@hiisi/viola-default-lints";
 *
 * export default viola()
 *   .use(defaultLints)  // plugin adds linters + default rules
 *   .rule(report.off, when.in("**\/*_test.ts"));  // user overrides
 * ```
 *
 * Rules are evaluated with "first match wins" semantics. User rules are
 * always checked before plugin rules, regardless of the order in code.
 * This lets users write the natural "base then overrides" order while
 * still having their overrides take precedence.
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
 * A viola plugin that configures the builder.
 *
 * Plugins add linters, rules, and settings by calling methods on the builder.
 * This is similar to Bevy's plugin system - plugins directly modify the app/builder.
 *
 * @example
 * ```ts
 * const myPlugin: ViolaPlugin = {
 *   build(viola) {
 *     viola
 *       .add(myLinter)
 *       .rule(report.error, when.impact.atLeast(Impact.Critical))
 *       .set("my-linter.threshold", 0.9);
 *   }
 * };
 * ```
 */
export interface ViolaPlugin {
  /** Configure the builder with this plugin's linters, rules, and settings. */
  build(viola: ViolaBuilder): void;
}

/**
 * Function form of a plugin.
 */
export type ViolaPluginFn = (viola: ViolaBuilder) => void;

/**
 * Something that can be passed to .use() - a plugin object or function.
 */
export type PluginInput = ViolaPlugin | ViolaPluginFn;

/**
 * Something that can be passed to .add() - a single linter or array.
 */
export type LinterInput = BaseLinter | BaseLinter[];

/**
 * The resolved configuration from the builder.
 */
export interface ViolaBuilderConfig {
  readonly linters: readonly BaseLinter[];
  readonly settings: readonly Frozen<LinterSetting>[];
  readonly rules: readonly Frozen<Rule>[];
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a value is a ViolaPlugin object (has build method).
 */
function isPluginObject(value: unknown): value is ViolaPlugin {
  return (
    value !== null &&
    typeof value === "object" &&
    "build" in value &&
    typeof (value as ViolaPlugin).build === "function"
  );
}

/**
 * Check if a value is a plugin function.
 */
function isPluginFn(value: unknown): value is ViolaPluginFn {
  return typeof value === "function";
}

/**
 * Check if a value is a BaseLinter.
 */
function isLinter(value: unknown): value is BaseLinter {
  return (
    value !== null &&
    typeof value === "object" &&
    "meta" in value &&
    "catalog" in value &&
    "lint" in value &&
    typeof (value as BaseLinter).lint === "function"
  );
}

// =============================================================================
// Builder
// =============================================================================

/**
 * Main viola configuration builder.
 *
 * Collects linters, rules, and settings from plugins and user configuration.
 * Rules are ordered so user rules are checked before plugin rules (first match wins).
 */
export class ViolaBuilder {
  private _linters: BaseLinter[] = [];
  private _userRules: Frozen<Rule>[] = [];
  private _pluginRules: Frozen<Rule>[] = [];
  private _userSettings: Frozen<LinterSetting>[] = [];
  private _pluginSettings: Frozen<LinterSetting>[] = [];
  private _inPlugin = false;

  /**
   * Add a plugin that configures this builder.
   *
   * Plugins can add linters, rules, and settings. Plugin rules are evaluated
   * AFTER user rules, so user overrides always take precedence.
   *
   * @example
   * ```ts
   * viola()
   *   .use(defaultLints)  // plugin's rules become fallbacks
   *   .rule(report.off, when.in("**\/*_test.ts"));  // user override (checked first)
   * ```
   */
  use(plugin: PluginInput): this {
    const wasInPlugin = this._inPlugin;
    this._inPlugin = true;

    try {
      if (isPluginObject(plugin)) {
        plugin.build(this);
      } else if (isPluginFn(plugin)) {
        plugin(this);
      } else {
        throw new Error(
          "Invalid plugin: expected an object with build() method or a function"
        );
      }
    } finally {
      this._inPlugin = wasInPlugin;
    }

    return this;
  }

  /**
   * Add a linter or array of linters.
   *
   * @example
   * ```ts
   * viola()
   *   .add(myLinter)
   *   .add([linterA, linterB])
   * ```
   */
  add(input: LinterInput): this {
    if (Array.isArray(input)) {
      for (const linter of input) {
        if (isLinter(linter)) {
          this._linters.push(linter);
        }
      }
    } else if (isLinter(input)) {
      this._linters.push(input);
    }
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
    const settings = this._inPlugin ? this._pluginSettings : this._userSettings;

    const dotIndex = key.indexOf(".");
    if (dotIndex === -1) {
      // key is linter id, value is full config object
      if (typeof value === "object" && value !== null) {
        for (const [k, v] of Object.entries(value)) {
          settings.push(deepFreeze({ linter: key, key: k, value: v }));
        }
      }
    } else {
      // dot notation: "linter.option"
      const linter = key.slice(0, dotIndex);
      const option = key.slice(dotIndex + 1);
      settings.push(deepFreeze({ linter, key: option, value }));
    }
    return this;
  }

  /**
   * Add a classification rule.
   *
   * User rules are checked before plugin rules (first match wins).
   *
   * @example
   * ```ts
   * viola()
   *   .use(defaultLints)  // plugin rules (fallback)
   *   .rule(report.off, when.in("**\/*_test.ts"))  // user rule (checked first)
   * ```
   */
  rule(action: Frozen<RuleAction>, condition: ConditionExpr): this {
    const rule = deepFreeze({
      action,
      condition: condition.condition,
    });

    if (this._inPlugin) {
      this._pluginRules.push(rule);
    } else {
      this._userRules.push(rule);
    }

    return this;
  }

  /**
   * Build the final configuration.
   *
   * Rules are ordered: user rules first, then plugin rules.
   * Settings are merged: plugin settings first, then user settings (user wins).
   */
  build(): ViolaBuilderConfig {
    return {
      linters: this._linters,
      // User rules first (checked first with first-match-wins)
      rules: [...this._userRules, ...this._pluginRules],
      // Plugin settings first, user settings override
      settings: [...this._pluginSettings, ...this._userSettings],
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
 * import { viola } from "@hiisi/viola";
 * import defaultLints from "@hiisi/viola-default-lints";
 *
 * export default viola()
 *   .use(defaultLints)
 *   .rule(report.off, when.in("**\/*_test.ts"));
 * ```
 */
export function viola(): ViolaBuilder {
  return new ViolaBuilder();
}

/**
 * Create a plugin from a configure function.
 *
 * @example
 * ```ts
 * const myPlugin = plugin((viola) => {
 *   viola
 *     .add(myLinter)
 *     .rule(report.error, when.impact.atLeast(Impact.Critical));
 * });
 * ```
 */
export function plugin(fn: ViolaPluginFn): ViolaPlugin {
  return { build: fn };
}

/**
 * Fluent builder API for viola configuration.
 *
 * @example
 * ```ts
 * import { viola, grammar, when, report } from "@hiisi/viola";
 * import defaultLints from "@hiisi/viola-default-lints";
 * import typescript from "@hiisi/viola-grammar-ts";
 * import javascript from "@hiisi/viola-grammar-js";
 *
 * export default viola()
 *   .use(defaultLints)  // plugin adds linters + default rules
 *   .add(typescript).as("ts")  // register grammar with alias
 *   .add(javascript).as("js")
 *   .rule(grammar("ts").overrides("js"), when.in("*.ts", "*.tsx"))
 *   .rule(report.off, when.in("**\/*_test.ts"));  // your overrides
 * ```
 *
 * Rules are evaluated with "last wins" semantics (like CSS). Rules defined
 * later override earlier ones. This matches the intuitive mental model:
 * - Base rules first (from plugins)
 * - Overrides later (your rules)
 *
 * @module
 */

import { deepFreeze, type Frozen } from "@hiisi/flash-freeze";
import { GrammarRegistry } from "../grammars/registry.ts";
import type { GrammarDefinition } from "../grammars/types.ts";
import type { BaseLinter } from "../linters/base.ts";
import type { ConditionExpr } from "./conditions.ts";
import type {
    GrammarRelationshipAction,
    RuleAction,
} from "./types/actions.types.ts";
import type {
    LinterSetting,
    PluginInput,
    Rule,
    ViolaBuilderConfig,
    ViolaPlugin,
    ViolaPluginFn
} from "./types/builder.types.ts";

// Re-export types for convenience
export type {
    LinterInput,
    LinterSetting,
    PluginInput,
    Rule,
    ViolaBuilderConfig,
    ViolaPlugin,
    ViolaPluginFn
} from "./types/builder.types.ts";

// =============================================================================
// Types
// =============================================================================

/**
 * Input that can be passed to .add() - a linter, grammar, or array of linters.
 */
export type AddInput = BaseLinter | BaseLinter[] | GrammarDefinition;

/**
 * Extended builder config that includes grammars.
 */
export interface ViolaBuilderConfigExtended extends ViolaBuilderConfig {
  /** Grammar registry with all registered grammars */
  readonly grammarRegistry: GrammarRegistry;
  /** Grammar relationship rules */
  readonly grammarRules: readonly Frozen<{
    action: Frozen<GrammarRelationshipAction>;
    condition: Frozen<Condition>;
  }>[];
}

// Import Condition type
import type { Condition } from "./types/conditions.types.ts";

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

/**
 * Check if a value is a GrammarDefinition.
 */
function isGrammarDefinition(value: unknown): value is GrammarDefinition {
  return (
    value !== null &&
    typeof value === "object" &&
    "meta" in value &&
    "grammar" in value &&
    "queries" in value &&
    typeof (value as GrammarDefinition).meta === "object" &&
    "id" in (value as GrammarDefinition).meta
  );
}

/**
 * Check if an action is a grammar relationship action.
 */
function isGrammarRelationshipAction(
  action: RuleAction
): action is GrammarRelationshipAction {
  return action.type === "grammar-relationship";
}

// =============================================================================
// Builder
// =============================================================================

/**
 * Main viola configuration builder.
 *
 * Collects linters, grammars, rules, and settings from plugins and user configuration.
 * Rules use "last wins" semantics - later rules override earlier ones.
 */
export class ViolaBuilder {
  private _linters: BaseLinter[] = [];
  private _linterAliases = new Map<string, string>(); // alias -> linter id
  private _grammarRegistry = new GrammarRegistry();
  private _rules: Frozen<Rule>[] = [];
  private _grammarRules: Frozen<{
    action: Frozen<GrammarRelationshipAction>;
    condition: Frozen<Condition>;
  }>[] = [];
  private _settings: Frozen<LinterSetting>[] = [];

  /** Track the last added item for .as() chaining */
  private _lastAddedType: "linter" | "grammar" | null = null;
  private _lastAddedId: string | null = null;

  /**
   * Add a plugin that configures this builder.
   *
   * Plugins add linters, grammars, rules, and settings. Rules defined later
   * (including your rules after .use()) take precedence over earlier ones.
   *
   * @example
   * ```ts
   * viola()
   *   .use(defaultLints)  // plugin's rules (base)
   *   .rule(report.off, when.in("**\/*_test.ts"));  // your override (wins)
   * ```
   */
  use(plugin: PluginInput): this {
    if (isPluginObject(plugin)) {
      plugin.build(this);
    } else if (isPluginFn(plugin)) {
      plugin(this);
    } else {
      throw new Error(
        "Invalid plugin: expected an object with build() method or a function"
      );
    }

    return this;
  }

  /**
   * Add a linter, grammar, or array of linters.
   *
   * Chain with `.as(alias)` to give an alias to the last added item.
   *
   * @example
   * ```ts
   * viola()
   *   .add(myLinter)
   *   .add([linterA, linterB])
   *   .add(typescript).as("ts")  // grammar with alias
   *   .add(bash)  // no alias needed, continues chaining
   * ```
   */
  add(input: AddInput): this {
    // Reset last added tracking
    this._lastAddedType = null;
    this._lastAddedId = null;

    if (Array.isArray(input)) {
      // Array of linters
      for (const linter of input) {
        if (isLinter(linter)) {
          this._linters.push(linter);
          // Track last for potential .as() on array (uses last item)
          this._lastAddedType = "linter";
          this._lastAddedId = linter.meta.id;
        }
      }
    } else if (isGrammarDefinition(input)) {
      // Grammar definition
      this._grammarRegistry.add(input);
      this._lastAddedType = "grammar";
      this._lastAddedId = input.meta.id;
    } else if (isLinter(input)) {
      // Single linter
      this._linters.push(input);
      this._lastAddedType = "linter";
      this._lastAddedId = input.meta.id;
    } else {
      throw new Error(
        "Invalid input: expected a linter, grammar, or array of linters"
      );
    }

    return this;
  }

  /**
   * Set an alias for the last added item (grammar or linter).
   *
   * For grammars, the alias is used in `grammar()` references.
   * For linters, the alias provides an alternate name for settings.
   *
   * @param alias - The alias name
   * @returns The builder for chaining
   *
   * @example
   * ```ts
   * viola()
   *   .add(typescript).as("ts")
   *   .add(javascript).as("js")
   *   .rule(grammar("ts").overrides("js"), when.in("*.ts"));
   * ```
   */
  as(alias: string): this {
    if (this._lastAddedType === null || this._lastAddedId === null) {
      throw new Error("No item to alias. Call .add() before .as()");
    }

    if (this._lastAddedType === "grammar") {
      // Grammar alias is handled by the registry's internal .as()
      const entry = this._grammarRegistry.get(this._lastAddedId);
      if (entry) {
        this._grammarRegistry.add(entry.definition).as(alias);
      }
    } else if (this._lastAddedType === "linter") {
      // Store linter alias mapping
      this._linterAliases.set(alias, this._lastAddedId);
    }

    // Clear tracking
    this._lastAddedType = null;
    this._lastAddedId = null;

    return this;
  }

  /**
   * Configure a linter setting.
   *
   * Later settings override earlier ones for the same key.
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
   * Add a rule (classification rule or grammar relationship).
   *
   * Rules use "last wins" semantics - later rules override earlier ones.
   *
   * @example
   * ```ts
   * viola()
   *   .use(defaultLints)  // plugin rules (base)
   *   .rule(report.off, when.in("**\/*_test.ts"))  // report rule
   *   .rule(grammar("ts").overrides("js"), when.in("*.ts"))  // grammar rule
   * ```
   */
  rule(action: Frozen<RuleAction>, condition: ConditionExpr): this {
    if (isGrammarRelationshipAction(action)) {
      // Grammar relationship rule
      this._grammarRules.push(
        deepFreeze({
          action: action as Frozen<GrammarRelationshipAction>,
          condition: condition.condition,
        })
      );
    } else {
      // Regular report rule
      const rule = deepFreeze({
        action,
        condition: condition.condition,
      });
      this._rules.push(rule);
    }

    return this;
  }

  /**
   * Get the grammar registry.
   * Useful for plugins that need to inspect or add grammars.
   */
  get grammars(): GrammarRegistry {
    return this._grammarRegistry;
  }

  /**
   * Build the final configuration.
   *
   * Rules are stored in definition order. The evaluator processes them
   * in reverse (last to first) so later rules take precedence.
   */
  build(): ViolaBuilderConfigExtended {
    return {
      linters: this._linters,
      rules: this._rules,
      settings: this._settings,
      grammarRegistry: this._grammarRegistry,
      grammarRules: this._grammarRules,
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
 * import { viola, grammar, when, report } from "@hiisi/viola";
 * import defaultLints from "@hiisi/viola-default-lints";
 * import typescript from "@hiisi/viola-grammar-ts";
 *
 * export default viola()
 *   .use(defaultLints)
 *   .add(typescript).as("ts")
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

/**
 * Builder types for viola configuration.
 *
 * Types for the fluent builder API and plugins.
 *
 * @module
 */

import type { Frozen } from "@hiisi/flash-freeze";
import type { GrammarRegistry } from "../../grammars/registry.ts";
import type { GrammarDefinition } from "../../grammars/types.ts";
import type { BaseLinter } from "../../linters/base.ts";
import type { GrammarRelationshipAction, RuleAction } from "./actions.types.ts";
import type { Condition } from "./conditions.types.ts";

// =============================================================================
// Builder Types
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
 * A grammar relationship rule.
 */
export interface GrammarRule {
  readonly action: Frozen<GrammarRelationshipAction>;
  readonly condition: Frozen<Condition>;
}

/**
 * The resolved configuration from the builder.
 */
export interface ViolaBuilderConfig {
  readonly linters: readonly BaseLinter[];
  readonly settings: readonly Frozen<LinterSetting>[];
  readonly rules: readonly Frozen<Rule>[];
}

/**
 * Extended builder config that includes grammars.
 */
export interface ViolaBuilderConfigExtended extends ViolaBuilderConfig {
  /** Grammar registry with all registered grammars */
  readonly grammarRegistry: GrammarRegistry;
  /** Grammar relationship rules */
  readonly grammarRules: readonly Frozen<GrammarRule>[];
}

// =============================================================================
// Add Input Type
// =============================================================================

/**
 * Input that can be passed to .add() - a linter, grammar, or array of linters.
 */
export type AddInput = BaseLinter | BaseLinter[] | GrammarDefinition;

/**
 * @deprecated Use AddInput instead. AddResult is no longer needed since .as() is on the builder.
 */
export type AddResult<TBuilder> = TBuilder;

// =============================================================================
// Plugin Types
// =============================================================================

/**
 * Forward declaration for ViolaBuilder to avoid circular imports.
 * The actual ViolaBuilder class is in builder.ts.
 */
export interface ViolaBuilderInterface {
  use(plugin: PluginInput): ViolaBuilderInterface;
  add(input: AddInput): ViolaBuilderInterface;
  /**
   * Set an alias for the last added item (grammar or linter).
   */
  as(alias: string): ViolaBuilderInterface;
  set(key: string, value: unknown): ViolaBuilderInterface;
  rule(action: Frozen<RuleAction>, condition: ConditionExprInterface): ViolaBuilderInterface;
  readonly grammars: GrammarRegistry;
  build(): ViolaBuilderConfigExtended;
}

/**
 * Forward declaration for ConditionExpr to avoid circular imports.
 */
export interface ConditionExprInterface {
  readonly condition: Frozen<Condition>;
  and(other: ConditionExprInterface | Frozen<Condition>): ConditionExprInterface;
  or(other: ConditionExprInterface | Frozen<Condition>): ConditionExprInterface;
  not(): ConditionExprInterface;
}

/**
 * A viola plugin that configures the builder.
 *
 * Plugins add linters, grammars, rules, and settings by calling methods on the builder.
 * This is similar to Bevy's plugin system - plugins directly modify the app/builder.
 *
 * @example
 * ```ts
 * const myPlugin: ViolaPlugin = {
 *   build(viola) {
 *     viola
 *       .add(myLinter)
 *       .add(myGrammar).as("my")
 *       .rule(report.error, when.impact.atLeast(Impact.Critical))
 *       .set("my-linter.threshold", 0.9);
 *   }
 * };
 * ```
 */
export interface ViolaPlugin {
  /** Configure the builder with this plugin's linters, grammars, rules, and settings. */
  build(viola: ViolaBuilderInterface): void;
}

/**
 * Function form of a plugin.
 */
export type ViolaPluginFn = (viola: ViolaBuilderInterface) => void;

/**
 * Something that can be passed to .use() - a plugin object or function.
 */
export type PluginInput = ViolaPlugin | ViolaPluginFn;

/**
 * @deprecated Use AddInput instead
 * Something that can be passed to .add() - a single linter or array.
 */
export type LinterInput = BaseLinter | BaseLinter[];

/**
 * Condition types for viola configuration.
 *
 * These types define the structure of conditions used in rules.
 *
 * @module
 */

import type { Category, Impact } from "../enums.ts";

// =============================================================================
// Condition Types
// =============================================================================

/**
 * Operators for combining conditions.
 */
export type ConditionOperator = "and" | "or" | "not";

/**
 * Base condition interface.
 */
export interface BaseCondition {
  readonly type: string;
}

/**
 * Impact comparison condition.
 */
export interface ImpactCondition extends BaseCondition {
  readonly type: "impact";
  readonly operator: "=" | "!=" | ">=" | "<=" | ">" | "<";
  readonly value: Impact;
}

/**
 * Category filter condition.
 */
export interface CategoryCondition extends BaseCondition {
  readonly type: "category";
  readonly include?: readonly Category[];
  readonly exclude?: readonly Category[];
}

/**
 * File pattern condition.
 */
export interface FileCondition extends BaseCondition {
  readonly type: "file";
  readonly patterns: readonly string[];
}

/**
 * Linter filter condition.
 */
export interface LinterCondition extends BaseCondition {
  readonly type: "linter";
  readonly patterns: readonly string[];
}

/**
 * Confidence filter condition.
 */
export interface ConfidenceCondition extends BaseCondition {
  readonly type: "confidence";
  readonly min?: number;
  readonly max?: number;
}

/**
 * Compound condition (AND, OR).
 */
export interface CompoundCondition extends BaseCondition {
  readonly type: "compound";
  readonly operator: "and" | "or";
  readonly conditions: readonly Condition[];
}

/**
 * Negation condition (NOT).
 */
export interface NotCondition extends BaseCondition {
  readonly type: "not";
  readonly condition: Condition;
}

/**
 * Union of all condition types.
 */
export type Condition =
  | ImpactCondition
  | CategoryCondition
  | FileCondition
  | LinterCondition
  | ConfidenceCondition
  | CompoundCondition
  | NotCondition;

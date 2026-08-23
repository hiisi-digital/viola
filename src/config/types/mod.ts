/**
 * Types module for viola configuration.
 *
 * Re-exports all configuration types from their respective files.
 *
 * @module
 */

// Condition types
export type {
  BaseCondition,
  CategoryCondition,
  CompoundCondition,
  Condition,
  ConditionOperator,
  ConfidenceCondition,
  FileCondition,
  ImpactCondition,
  LinterCondition,
  NotCondition,
} from "./conditions.types.ts";

// Action types
export type { ReportAction, RuleAction } from "./actions.types.ts";

// Evaluator types
export type { EvaluatedIssue, EvaluationContext } from "./evaluator.types.ts";

// Builder types
export type {
  ConditionExprInterface,
  LinterInput,
  LinterSetting,
  PluginInput,
  Rule,
  ViolaBuilderConfig,
  ViolaBuilderInterface,
  ViolaPlugin,
  ViolaPluginFn,
} from "./builder.types.ts";

// Merge types
export type { MergeOptions, MergeResult } from "./merge.types.ts";

// Validate types
export type { ValidationError, ValidationResult } from "./validate.types.ts";

//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Configuration module.
 *
 * @module
 */

// The shapes a config resolves into, which every linter and the runtime both
// read. These were labelled legacy and are not: `IssueCatalog` is on every
// linter and `ResolvedConfig` is what the builder produces.
export type {
  ConfigSource,
  IssueCatalog,
  IssueDef,
  ParsedPattern,
  PatternValue,
  ResolvedConfig,
  ResolvedPatternValue,
  ResolvedScope,
  ScopeConfig,
  ViolaConfig,
} from "./types.ts";

export {
  loadConfig,
  matchesIssuePattern,
  resolveBuilderConfig,
  resolveIssueSeverity,
} from "./loader.ts";

export type { MergeOptions, MergeResult } from "./merge.ts";

export {
  collectDefaultPresets,
  mergeConfigWithPresets,
  mergeLinterConfig,
  resolvePresets,
} from "./merge.ts";

export type { ValidationError, ValidationResult } from "./validate.ts";

export { formatValidationErrors, validateLinterConfig } from "./validate.ts";

// =============================================================================
// New Builder API
// =============================================================================

// The vocabulary and the conditions live in `src/conditions/`. Config does not
// re-export them: one owner, one import path, and a consumer that wants a
// condition asks the module that defines one.

// Actions
export type {
  GrammarRelationshipAction,
  ReportAction,
  RuleAction,
} from "./actions.ts";

export {
  isGrammarRelationshipAction,
  isReportAction,
  report,
} from "./actions.ts";

// Builder
export type {
  LinterInput,
  LinterSetting,
  PluginInput,
  Rule,
  ViolaBuilderConfig,
  ViolaBuilderConfigExtended,
  ViolaPlugin,
  ViolaPluginFn,
} from "./builder.ts";

// Re-export AddInput and AddResult from builder.types for backwards compatibility
export type { AddInput, AddResult } from "./types/builder.types.ts";

export { plugin, viola, ViolaBuilder } from "./builder.ts";

// Grammar Reference
export type { GrammarRelationshipBuilder } from "./grammar-ref.ts";

export { grammar, isGrammarRelationship } from "./grammar-ref.ts";

// Evaluator
export type { EvaluatedIssue, RunContext } from "./evaluator.ts";

export {
  countByLevel,
  createEvaluationContext,
  evaluateIssue,
  evaluateIssues,
  filterReportableIssues,
  groupByLevel,
  hasErrors,
} from "./evaluator.ts";

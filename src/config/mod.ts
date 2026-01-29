/**
 * Configuration module.
 *
 * @module
 */

// Legacy types (to be deprecated)
export type {
    ConfigSource,
    IssueCatalog,
    IssueCategory,
    IssueDef,
    IssueImpact,
    ParsedPattern,
    PatternValue,
    ResolvedConfig,
    ResolvedPatternValue,
    ResolvedScope,
    ScopeConfig,
    Severity,
    ViolaConfig
} from "./types.ts";

export {
    loadConfig,
    matchesFilePattern,
    matchesIssuePattern,
    resolveBuilderConfig,
    resolveIssueSeverity
} from "./loader.ts";

export type {
    MergeOptions,
    MergeResult
} from "./merge.ts";

export {
    collectDefaultPresets,
    mergeConfigWithPresets,
    mergeLinterConfig,
    resolvePresets
} from "./merge.ts";

export type {
    ValidationError,
    ValidationResult
} from "./validate.ts";

export {
    formatValidationErrors,
    validateLinterConfig
} from "./validate.ts";

// =============================================================================
// New Builder API
// =============================================================================

// Enums
export {
    Category,
    compareImpact,
    Impact,
    IMPACT_ORDER,
    impactValue,
    ReportLevel
} from "./enums.ts";

// Actions
export type {
    ReportAction,
    RuleAction
} from "./actions.ts";

export {
    isReportAction,
    report
} from "./actions.ts";

// Conditions
export type {
    CategoryCondition,
    CompoundCondition,
    Condition,
    ConditionOperator,
    ConfidenceCondition,
    FileCondition,
    ImpactCondition,
    LinterCondition,
    NotCondition
} from "./conditions.ts";

export {
    ConditionExpr,
    isCategoryCondition,
    isCompoundCondition,
    isConfidenceCondition,
    isFileCondition,
    isImpactCondition,
    isLinterCondition,
    isNotCondition,
    when
} from "./conditions.ts";

// Builder
export type {
    LinterPlugin,
    LinterSetting,
    Rule,
    ViolaBuilderConfig
} from "./builder.ts";

export {
    viola,
    ViolaBuilder
} from "./builder.ts";

// Evaluator
export type {
    EvaluatedIssue,
    EvaluationContext
} from "./evaluator.ts";

export {
    countByLevel,
    createEvaluationContext,
    evaluateCondition,
    evaluateIssue,
    evaluateIssues,
    filterReportableIssues,
    groupByLevel,
    hasErrors
} from "./evaluator.ts";

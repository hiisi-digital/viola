/**
 * Configuration module.
 *
 * @module
 */

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
    compareImpact,
    IMPACT_ORDER,
    impactValue
} from "./types.ts";

export {
    loadConfig,
    matchesFilePattern,
    matchesIssuePattern,
    resolveIssueSeverity
} from "./loader.ts";


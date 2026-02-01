/**
 * Grammars Module
 *
 * Provides the grammar system for language-agnostic code extraction.
 * Grammars define how to parse and extract structured data from source
 * files using tree-sitter queries.
 *
 * @example
 * ```ts
 * import {
 *   initTreeSitter,
 *   loadGrammar,
 *   createParser,
 *   extractFileData,
 *   runQuery,
 *   GrammarRegistry,
 *   GrammarResolver,
 * } from "@hiisi/viola/grammars";
 * import type { GrammarDefinition } from "@hiisi/viola/grammars";
 *
 * // Initialize tree-sitter (once at startup)
 * await initTreeSitter();
 *
 * // Load a grammar and create a parser
 * const language = await loadGrammar(myGrammar.grammar);
 * const parser = createParser(myGrammar.grammar, language);
 *
 * // Parse a file
 * const tree = parser.parse(sourceCode);
 *
 * // Extract structured data
 * const data = extractFileData(tree, language, myGrammar, "file.ts", sourceCode);
 *
 * // Use the registry and resolver
 * const registry = new GrammarRegistry();
 * registry.add(typescript).as("ts");
 * registry.add(javascript).as("js");
 *
 * const resolver = new GrammarResolver(registry, grammarRules);
 * const resolution = resolver.resolve("app.ts", context);
 * ```
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

export type {
    ExtractionQueries,
    GrammarDefinition,
    GrammarMeta,
    GrammarRelationship,
    GrammarSource,
    GrammarTransforms,
    QueryCaptures,
    RegisteredGrammar,
    SyntaxNode
} from "./types.ts";

// =============================================================================
// Loader
// =============================================================================

export type {
    Language,
    Parser,
    Query,
    QueryCapture,
    QueryMatch,
    Tree,
    TreeCursor
} from "./loader.ts";

export {
    clearCache,
    createParser,
    getParser,
    initTreeSitter,
    isInitialized,
    loadGrammar,
    reset
} from "./loader.ts";

// =============================================================================
// Query Execution
// =============================================================================

export {
    queryAll,
    queryCount,
    queryFirst,
    queryHasMatch,
    runQuery
} from "./query.ts";

// =============================================================================
// Extraction
// =============================================================================

export { extractCompleteFileInfo, extractFileData } from "./extractor.ts";

// =============================================================================
// Registry
// =============================================================================

export type { GrammarAddResult, GrammarEntry } from "./registry.ts";

export { createGrammarRegistry, GrammarRegistry } from "./registry.ts";

// =============================================================================
// Resolver
// =============================================================================

export type {
    GrammarRelationshipRule,
    GrammarResolution,
    GrammarRole,
    ResolvedGrammar
} from "./resolver.ts";

export {
    createGrammarResolver,
    GrammarResolver,
    mergeExtractionResults
} from "./resolver.ts";

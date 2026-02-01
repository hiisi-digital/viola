/**
 * Grammar Definition Types
 *
 * Core types for defining language grammars. A grammar definition provides
 * everything needed to parse and extract structured data from files of a
 * particular language using tree-sitter.
 *
 * @module
 */

import type {
    ExportInfo,
    FunctionParam,
    ImportInfo,
    TypeField,
} from "../data/types.ts";

// =============================================================================
// Tree-sitter Types
// =============================================================================

/**
 * A tree-sitter syntax node (simplified interface).
 * This mirrors the tree-sitter Node type but is defined here to avoid
 * direct dependency on web-tree-sitter in type definitions.
 */
export interface SyntaxNode {
  /** Node type (e.g., "function_definition", "string") */
  readonly type: string;
  /** Full text of this node */
  readonly text: string;
  /** Start position in the source */
  readonly startPosition: { row: number; column: number };
  /** End position in the source */
  readonly endPosition: { row: number; column: number };
  /** Start byte offset */
  readonly startIndex: number;
  /** End byte offset */
  readonly endIndex: number;
  /** Parent node, if any */
  readonly parent: SyntaxNode | null;
  /** All child nodes */
  readonly children: readonly SyntaxNode[];
  /** Named child nodes only */
  readonly namedChildren: readonly SyntaxNode[];
  /** Get child by field name */
  childForFieldName(name: string): SyntaxNode | null;
  /** Check if node has errors */
  readonly hasError: boolean;
  /** Check if node is missing (error recovery) */
  readonly isMissing: boolean;
}

/**
 * Query captures from a tree-sitter query match.
 * Provides convenient access to captured nodes by name.
 */
export interface QueryCaptures {
  /**
   * Get a capture by name.
   *
   * @example
   * const name = captures.get("function.name");
   * if (name) {
   *   console.log(name.text);
   * }
   */
  get(name: string): { node: SyntaxNode; text: string } | undefined;

  /**
   * Check if a capture exists.
   *
   * @example
   * if (captures.has("function.async")) {
   *   // function is async
   * }
   */
  has(name: string): boolean;

  /**
   * Get all captures as a map.
   */
  all(): ReadonlyMap<string, { node: SyntaxNode; text: string }>;
}

// =============================================================================
// Grammar Metadata
// =============================================================================

/**
 * Metadata about a grammar.
 */
export interface GrammarMeta {
  /** Unique identifier (e.g., "typescript", "bash", "python") */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /**
   * File extensions this grammar handles (with leading dot).
   * @example [".ts", ".tsx", ".mts"]
   */
  readonly extensions: readonly string[];
  /**
   * Additional glob patterns for files without standard extensions.
   * @example [".bashrc", ".bash_profile", "Makefile"]
   */
  readonly globs?: readonly string[];
  /** Optional description */
  readonly description?: string;
}

// =============================================================================
// Grammar Source
// =============================================================================

/**
 * Reference to a tree-sitter grammar WASM file.
 */
export interface GrammarSource {
  /** How to load the grammar */
  readonly source: "npm" | "url" | "bundled";
  /**
   * npm package name (if source is "npm").
   * @example "tree-sitter-typescript"
   */
  readonly package?: string;
  /**
   * Path to .wasm within the package.
   * @example "tree-sitter-typescript.wasm"
   */
  readonly wasm?: string;
  /**
   * Direct URL to .wasm (if source is "url").
   */
  readonly url?: string;
}

// =============================================================================
// Extraction Queries
// =============================================================================

/**
 * Tree-sitter queries for extracting code elements.
 *
 * Each query is an S-expression string that produces captures
 * following the standard capture naming convention:
 *
 * - `@function.name`, `@function.params`, `@function.body`, `@function.return`
 * - `@string.value`, `@string.raw`, `@string.template`
 * - `@import.name`, `@import.from`, `@import.type_only`
 * - `@export.name`, `@export.kind`, `@export.from`
 * - `@type.name`, `@type.body`, `@type.kind`
 * - `@doc.content`
 */
export interface ExtractionQueries {
  /**
   * Query for function/method definitions.
   * Expected captures: `@function.name`, `@function.params`, `@function.body`
   * Optional captures: `@function.return`, `@function.async`, `@function`
   */
  readonly functions: string;

  /**
   * Query for string literals.
   * Expected captures: `@string.value`
   * Optional captures: `@string.raw`, `@string.template`
   */
  readonly strings?: string;

  /**
   * Query for import statements.
   * Expected captures: `@import.name`, `@import.from`
   * Optional captures: `@import.type_only`, `@import.namespace`
   */
  readonly imports?: string;

  /**
   * Query for export statements.
   * Expected captures: `@export.name`
   * Optional captures: `@export.kind`, `@export.from`, `@export.type_only`
   */
  readonly exports?: string;

  /**
   * Query for type/interface definitions.
   * Expected captures: `@type.name`, `@type.body`
   * Optional captures: `@type.kind`, `@type`
   */
  readonly types?: string;

  /**
   * Query for documentation comments.
   * Expected captures: `@doc.content`
   */
  readonly docComments?: string;
}

// =============================================================================
// Grammar Transforms
// =============================================================================

/**
 * Optional transform callbacks for language-specific extraction logic.
 *
 * These are only needed when tree-sitter queries alone can't capture
 * the semantics. Most extraction can be done with queries; transforms
 * handle complex edge cases.
 */
export interface GrammarTransforms {
  /**
   * Parse function parameters from the captured params node.
   * Needed for languages with complex parameter syntax.
   *
   * @example TypeScript: destructuring, defaults, rest params, type annotations
   * @example Bash: extract $1, $2, $@ usage from function body
   */
  parseParams?: (
    paramsNode: SyntaxNode | undefined,
    source: string
  ) => FunctionParam[];

  /**
   * Extract the return type from captures or node analysis.
   * Needed when return type syntax varies significantly.
   */
  extractReturnType?: (
    node: SyntaxNode,
    captures: QueryCaptures
  ) => string | undefined;

  /**
   * Normalize function body for similarity comparison.
   * Default: strip whitespace and comments.
   *
   * @example Bash: normalize here-docs, handle different quoting styles
   */
  normalizeBody?: (body: string, languageId: string) => string;

  /**
   * Determine if a function is async from context.
   * Needed when async-ness can't be captured via query predicates.
   */
  isAsync?: (node: SyntaxNode, captures: QueryCaptures) => boolean;

  /**
   * Determine if a function is a generator.
   */
  isGenerator?: (node: SyntaxNode, captures: QueryCaptures) => boolean;

  /**
   * Determine if something is exported.
   * Needed for languages with complex export semantics.
   */
  isExported?: (node: SyntaxNode, captures: QueryCaptures) => boolean;

  /**
   * Determine if something is a default export.
   */
  isDefaultExport?: (node: SyntaxNode, captures: QueryCaptures) => boolean;

  /**
   * Parse import details from captured nodes.
   * Needed for languages with complex import syntax.
   *
   * @example TypeScript: named imports, default imports, namespace imports
   */
  parseImport?: (
    node: SyntaxNode,
    captures: QueryCaptures,
    source: string
  ) => ImportInfo | ImportInfo[];

  /**
   * Parse export details from captured nodes.
   */
  parseExport?: (
    node: SyntaxNode,
    captures: QueryCaptures,
    source: string
  ) => ExportInfo | ExportInfo[];

  /**
   * Parse type/interface fields from body.
   * Needed for extracting field information from type bodies.
   */
  parseTypeFields?: (
    bodyNode: SyntaxNode | undefined,
    source: string
  ) => TypeField[];

  /**
   * Extract doc comment content and clean it up.
   *
   * @example TypeScript: strip JSDoc markers, parse @param/@returns tags
   * @example Bash: strip # prefix from comments
   */
  parseDocComment?: (node: SyntaxNode, source: string) => string;

  /**
   * Determine string quote style from node.
   */
  getQuoteStyle?: (
    node: SyntaxNode
  ) => "single" | "double" | "backtick" | "raw";
}

// =============================================================================
// Grammar Definition
// =============================================================================

/**
 * A grammar definition provides everything needed to extract
 * structured data from files of a particular language.
 *
 * Grammars are primarily data (tree-sitter queries) with optional
 * callbacks (transforms) for complex edge cases.
 *
 * @example
 * ```ts
 * export const typescript: GrammarDefinition = {
 *   meta: {
 *     id: "typescript",
 *     name: "TypeScript",
 *     extensions: [".ts", ".tsx"],
 *   },
 *   grammar: {
 *     source: "npm",
 *     package: "tree-sitter-typescript",
 *     wasm: "tree-sitter-typescript.wasm",
 *   },
 *   queries: {
 *     functions: `
 *       (function_declaration
 *         name: (identifier) @function.name
 *         body: (statement_block) @function.body)
 *     `,
 *   },
 *   transforms: {
 *     parseParams: parseTypeScriptParams,
 *   },
 * };
 * ```
 */
export interface GrammarDefinition {
  /** Grammar metadata */
  readonly meta: GrammarMeta;
  /** Reference to the tree-sitter grammar WASM */
  readonly grammar: GrammarSource;
  /** Extraction queries using standard capture names */
  readonly queries: ExtractionQueries;
  /** Optional transforms for complex extraction logic */
  readonly transforms?: GrammarTransforms;
}

// =============================================================================
// Grammar Registration
// =============================================================================

/**
 * A registered grammar with optional alias and pattern overrides.
 */
export interface RegisteredGrammar {
  /** The grammar definition */
  readonly definition: GrammarDefinition;
  /** Optional alias for referencing in rules */
  readonly alias?: string;
  /** Pattern overrides (if specified via builder) */
  readonly matchOverrides?: {
    /** Patterns to add to defaults */
    readonly add?: readonly string[];
    /** Patterns to remove from defaults */
    readonly remove?: readonly string[];
    /** Patterns to replace defaults entirely */
    readonly only?: readonly string[];
  };
}

/**
 * Grammar relationship types for resolution.
 */
export type GrammarRelationship =
  | { type: "overrides"; primary: string; secondary: string }
  | { type: "supplements"; primary: string; secondary: string };

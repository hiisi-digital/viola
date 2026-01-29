/**
 * Viola Data Types
 *
 * Core data structures for code analysis. All data extracted from the codebase
 * is represented using these types. All structures are designed to be frozen
 * (immutable) after creation.
 *
 * @module
 */

// =============================================================================
// Location Types
// =============================================================================

/**
 * A location in the source code.
 */
export interface SourceLocation {
  /** File path relative to project root */
  readonly file: string;
  /** Line number (1-based) */
  readonly line: number;
  /** Column number (1-based, optional) */
  readonly column?: number;
  /** End line number (for multi-line spans) */
  readonly endLine?: number;
  /** End column number */
  readonly endColumn?: number;
}

// =============================================================================
// Function Types
// =============================================================================

/**
 * A function parameter.
 */
export interface FunctionParam {
  /** Parameter name */
  readonly name: string;
  /** Type annotation (if present) */
  readonly type?: string;
  /** Whether parameter is optional */
  readonly optional: boolean;
  /** Whether parameter is rest (...args) */
  readonly rest: boolean;
  /** Default value expression (if present) */
  readonly defaultValue?: string;
}

/**
 * Information about a function declaration.
 */
export interface FunctionInfo {
  /** Function name (empty for anonymous) */
  readonly name: string;
  /** Location in source */
  readonly location: SourceLocation;
  /** Function parameters */
  readonly params: readonly FunctionParam[];
  /** Return type annotation (if present) */
  readonly returnType?: string;
  /** Whether function is async */
  readonly isAsync: boolean;
  /** Whether function is a generator */
  readonly isGenerator: boolean;
  /** Whether function is exported */
  readonly isExported: boolean;
  /** Whether it's a default export */
  readonly isDefaultExport: boolean;
  /** Function body (raw text) */
  readonly body: string;
  /** Normalized body (whitespace-normalized for comparison) */
  readonly normalizedBody: string;
  /** Hash of normalized body */
  readonly bodyHash: string;
  /** JSDoc comment (if present) */
  readonly jsDoc?: string;
  /** Kind: function, method, arrow, or constructor */
  readonly kind: "function" | "method" | "arrow" | "constructor";
  /** Parent class/object name (for methods) */
  readonly parent?: string;
}

// =============================================================================
// Type/Interface Types
// =============================================================================

/**
 * A field in a type or interface.
 */
export interface TypeField {
  /** Field name */
  readonly name: string;
  /** Type annotation */
  readonly type: string;
  /** Whether field is optional */
  readonly optional: boolean;
  /** Whether field is readonly */
  readonly readonly: boolean;
  /** JSDoc comment (if present) */
  readonly jsDoc?: string;
}

/**
 * Information about a type alias or interface declaration.
 */
export interface TypeInfo {
  /** Type name */
  readonly name: string;
  /** Location in source */
  readonly location: SourceLocation;
  /** Kind: type alias or interface */
  readonly kind: "type" | "interface";
  /** Whether type is exported */
  readonly isExported: boolean;
  /** Whether it's a default export */
  readonly isDefaultExport: boolean;
  /** Fields (for object types/interfaces) */
  readonly fields: readonly TypeField[];
  /** Type parameters (generics) */
  readonly typeParams?: readonly string[];
  /** Extended types (for interfaces) */
  readonly extends?: readonly string[];
  /** Full type body (raw text) */
  readonly body: string;
  /** Normalized body for comparison */
  readonly normalizedBody: string;
  /** Hash of normalized body */
  readonly bodyHash: string;
  /** JSDoc comment (if present) */
  readonly jsDoc?: string;
}

// =============================================================================
// String Literal Types
// =============================================================================

/**
 * A string literal in the source code.
 */
export interface StringLiteral {
  /** The string value */
  readonly value: string;
  /** Location in source */
  readonly location: SourceLocation;
  /** Quote style used */
  readonly quoteStyle: "single" | "double" | "backtick";
  /** Whether it's a template literal with expressions */
  readonly isTemplate: boolean;
  /** Context hint (variable name, function arg, etc.) */
  readonly context?: string;
}

// =============================================================================
// Schema Types
// =============================================================================

/**
 * Information about a JSON Schema.
 */
export interface SchemaInfo {
  /** Schema file path */
  readonly file: string;
  /** Schema ID or name derived from filename */
  readonly name: string;
  /** Schema title (from $title or title field) */
  readonly title?: string;
  /** Schema description */
  readonly description?: string;
  /** Root type (object, array, string, etc.) */
  readonly rootType?: string;
  /** Top-level property names (for object schemas) */
  readonly properties: readonly string[];
  /** Required property names */
  readonly required: readonly string[];
}

// =============================================================================
// Export/Import Types
// =============================================================================

/**
 * An export from a module.
 */
export interface ExportInfo {
  /** Exported name (or "default" for default exports) */
  readonly name: string;
  /** Local name if different (export { foo as bar }) */
  readonly localName?: string;
  /** Location in source */
  readonly location: SourceLocation;
  /** Kind of export */
  readonly kind: "function" | "type" | "interface" | "class" | "const" | "let" | "var" | "enum" | "namespace" | "re-export" | "unknown";
  /** Whether it's a type-only export */
  readonly isTypeOnly: boolean;
  /** Source module (for re-exports) */
  readonly from?: string;
}

/**
 * An import into a module.
 */
export interface ImportInfo {
  /** Imported name (or "default" for default imports) */
  readonly name: string;
  /** Local name if different (import { foo as bar }) */
  readonly localName?: string;
  /** Location in source */
  readonly location: SourceLocation;
  /** Source module */
  readonly from: string;
  /** Whether it's a type-only import */
  readonly isTypeOnly: boolean;
  /** Whether it's a namespace import (import * as X) */
  readonly isNamespace: boolean;
}

// =============================================================================
// File Types
// =============================================================================

/**
 * Information about a source file.
 */
export interface FileInfo {
  /** File path relative to project root */
  readonly path: string;
  /** File extension */
  readonly extension: string;
  /** Line count */
  readonly lineCount: number;
  /** All functions in the file */
  readonly functions: readonly FunctionInfo[];
  /** All types/interfaces in the file */
  readonly types: readonly TypeInfo[];
  /** All string literals in the file */
  readonly strings: readonly StringLiteral[];
  /** All exports from the file */
  readonly exports: readonly ExportInfo[];
  /** All imports into the file */
  readonly imports: readonly ImportInfo[];
  /** Whether file has any @deprecated annotations */
  readonly hasDeprecations: boolean;
  /** Deprecation locations (if any) */
  readonly deprecations: readonly SourceLocation[];
}

// =============================================================================
// Codebase Types
// =============================================================================

/**
 * Complete codebase data extracted by the crawler.
 * This is frozen and passed to all linters.
 */
export interface CodebaseData {
  /** Project root directory */
  readonly projectRoot: string;
  /** All source files analyzed */
  readonly files: readonly FileInfo[];
  /** All JSON schemas found */
  readonly schemas: readonly SchemaInfo[];
  /** Timestamp of when data was extracted */
  readonly extractedAt: number;

  // Aggregated views for convenience (computed from files)
  /** All functions across all files */
  readonly allFunctions: readonly FunctionInfo[];
  /** All types/interfaces across all files */
  readonly allTypes: readonly TypeInfo[];
  /** All string literals across all files */
  readonly allStrings: readonly StringLiteral[];
  /** All exports across all files */
  readonly allExports: readonly ExportInfo[];
  /** All imports across all files */
  readonly allImports: readonly ImportInfo[];
}

// =============================================================================
// Violation Types
// =============================================================================

/**
 * Severity level for a violation.
 */
export type ViolationSeverity = "error" | "warning" | "info";

/**
 * A violation found by a linter.
 */
export interface Violation {
  /** Linter that found the violation */
  readonly linter: string;
  /** Violation code (e.g., "similar-function-name") */
  readonly code: string;
  /** Severity level */
  readonly severity: ViolationSeverity;
  /** Primary location */
  readonly location: SourceLocation;
  /** Related locations (e.g., the other similar function) */
  readonly relatedLocations?: readonly SourceLocation[];
  /** Human-readable message */
  readonly message: string;
  /** Suggestion for fixing */
  readonly suggestion?: string;
  /** Additional context data */
  readonly context?: Record<string, unknown>;
}

/**
 * Result from running a linter.
 */
export interface LinterResult {
  /** Linter name */
  readonly linter: string;
  /** Violations found */
  readonly violations: readonly Violation[];
  /** Time taken in milliseconds */
  readonly durationMs: number;
  /** Whether the linter completed successfully */
  readonly success: boolean;
  /** Error message if linter failed */
  readonly error?: string;
}

/**
 * Aggregated results from all linters.
 */
export interface LintResults {
  /** Individual linter results */
  readonly results: readonly LinterResult[];
  /** Total violations by severity */
  readonly summary: {
    readonly errors: number;
    readonly warnings: number;
    readonly infos: number;
    readonly total: number;
  };
  /** Total time taken in milliseconds */
  readonly totalDurationMs: number;
  /** Whether any linter failed */
  readonly hasErrors: boolean;
  /** Files scanned */
  readonly filesScanned: number;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for a single linter.
 */
export interface LinterConfig {
  /** Whether linter is enabled */
  readonly enabled: boolean;
  /** Severity override (default depends on linter) */
  readonly severity?: ViolationSeverity;
  /** Linter-specific options */
  readonly options?: Record<string, unknown>;
}

/**
 * Viola configuration.
 */
export interface ViolaConfig {
  /** Project root directory */
  readonly projectRoot: string;
  /** Directories to scan */
  readonly include: readonly string[];
  /** Patterns to exclude */
  readonly exclude: readonly RegExp[];
  /** File extensions to scan */
  readonly extensions: readonly string[];
  /** Per-linter configuration */
  readonly linters: Record<string, LinterConfig>;
  /** Report-only mode (don't fail on errors) */
  readonly reportOnly: boolean;
  /** Verbose output */
  readonly verbose: boolean;
}

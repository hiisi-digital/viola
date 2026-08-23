/**
 * Viola Data Module
 *
 * Exports all data types and structures used by the viola lint runtime.
 * All exported types are designed to be frozen (immutable) after creation.
 *
 * @module
 */

// Re-export all types
export type {
  // Codebase
  CodebaseData,
  CrawlConfig,
  // Exports/Imports
  ExportInfo,
  // Files
  FileInfo,
  // Functions
  FunctionInfo,
  FunctionParam,
  // Imports
  ImportInfo,
  // Issues
  Issue,
  // Configuration
  LinterConfig,
  LinterResult,
  LintResults,
  // Schemas
  SchemaInfo,
  // Location
  SourceLocation,
  // Strings
  StringLiteral,
  // Types/Interfaces
  TypeField,
  TypeInfo,
} from "./types.ts";

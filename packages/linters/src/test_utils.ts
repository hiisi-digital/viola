/**
 * Shared test utilities for viola linters.
 *
 * Provides factory functions for creating mock codebase data,
 * and assertion helpers for testing linters.
 *
 * @module
 */

import type {
    BaseLinter,
    CodebaseData,
    ExportInfo,
    FunctionInfo,
    FunctionParam,
    ImportInfo,
    LinterConfig,
    SchemaInfo,
    SourceLocation,
    StringLiteral,
    TypeField,
    TypeInfo,
} from "@hiisi/viola";

// =============================================================================
// Location Builders
// =============================================================================

/**
 * Create a source location.
 */
export function loc(file: string, line: number, column?: number): SourceLocation {
  return { file, line, column };
}

/**
 * Get the first element of an array, asserting it exists.
 * Useful for tests with noUncheckedIndexedAccess enabled.
 */
export function first<T>(arr: readonly T[]): T {
  assert(arr.length > 0, "Expected array to have at least one element");
  return arr[0] as T;
}

// =============================================================================
// Function Builders
// =============================================================================

/**
 * Options for creating a mock function.
 */
export interface MockFunctionOptions {
  name?: string;
  file?: string;
  line?: number;
  params?: FunctionParam[];
  returnType?: string;
  isAsync?: boolean;
  isGenerator?: boolean;
  isExported?: boolean;
  isDefaultExport?: boolean;
  body?: string;
  normalizedBody?: string;
  bodyHash?: string;
  jsDoc?: string;
  kind?: "function" | "method" | "arrow" | "constructor";
  parent?: string;
}

/**
 * Create a mock function info.
 */
export function mockFunction(opts: MockFunctionOptions = {}): FunctionInfo {
  const name = opts.name ?? "testFunction";
  // Default to multi-line body to meet minFunctionLines requirement (default: 3)
  const body = opts.body ?? `{
  const result = ${name}Impl();
  console.log("Executing ${name}");
  return result;
}`;
  const normalizedBody = opts.normalizedBody ?? body.replace(/\s+/g, " ").trim();

  return {
    name,
    location: loc(opts.file ?? "test.ts", opts.line ?? 1),
    params: opts.params ?? [],
    returnType: opts.returnType,
    isAsync: opts.isAsync ?? false,
    isGenerator: opts.isGenerator ?? false,
    isExported: opts.isExported ?? false,
    isDefaultExport: opts.isDefaultExport ?? false,
    body,
    normalizedBody,
    bodyHash: opts.bodyHash ?? hashString(normalizedBody),
    jsDoc: opts.jsDoc,
    kind: opts.kind ?? "function",
    parent: opts.parent,
  };
}

/**
 * Create a mock function parameter.
 */
export function mockParam(
  name: string,
  type?: string,
  optional = false,
  rest = false,
  defaultValue?: string
): FunctionParam {
  return { name, type, optional, rest, defaultValue };
}

// =============================================================================
// Type Builders
// =============================================================================

/**
 * Options for creating a mock type.
 */
export interface MockTypeOptions {
  name?: string;
  file?: string;
  line?: number;
  kind?: "type" | "interface";
  isExported?: boolean;
  isDefaultExport?: boolean;
  fields?: TypeField[];
  typeParams?: string[];
  extends?: string[];
  body?: string;
  normalizedBody?: string;
  bodyHash?: string;
  jsDoc?: string;
}

/**
 * Create a mock type info.
 */
export function mockType(opts: MockTypeOptions = {}): TypeInfo {
  const name = opts.name ?? "TestType";
  const body = opts.body ?? `{ value: string }`;
  const normalizedBody = opts.normalizedBody ?? body.replace(/\s+/g, " ").trim();

  return {
    name,
    location: loc(opts.file ?? "test.ts", opts.line ?? 1),
    kind: opts.kind ?? "interface",
    isExported: opts.isExported ?? false,
    isDefaultExport: opts.isDefaultExport ?? false,
    fields: opts.fields ?? [],
    typeParams: opts.typeParams,
    extends: opts.extends,
    body,
    normalizedBody,
    bodyHash: opts.bodyHash ?? hashString(normalizedBody),
    jsDoc: opts.jsDoc,
  };
}

/**
 * Create a mock type field.
 */
export function mockField(
  name: string,
  type: string,
  optional = false,
  readonly = false,
  jsDoc?: string
): TypeField {
  return { name, type, optional, readonly, jsDoc };
}

// =============================================================================
// String Literal Builders
// =============================================================================

/**
 * Options for creating a mock string literal.
 */
export interface MockStringOptions {
  value?: string;
  file?: string;
  line?: number;
  quoteStyle?: "single" | "double" | "backtick";
  isTemplate?: boolean;
  context?: string;
}

/**
 * Create a mock string literal.
 */
export function mockString(opts: MockStringOptions = {}): StringLiteral {
  return {
    value: opts.value ?? "test string",
    location: loc(opts.file ?? "test.ts", opts.line ?? 1),
    quoteStyle: opts.quoteStyle ?? "double",
    isTemplate: opts.isTemplate ?? false,
    context: opts.context,
  };
}

// =============================================================================
// Export/Import Builders
// =============================================================================

/**
 * Options for creating a mock export.
 */
export interface MockExportOptions {
  name?: string;
  localName?: string;
  file?: string;
  line?: number;
  kind?: ExportInfo["kind"];
  isTypeOnly?: boolean;
  from?: string;
}

/**
 * Create a mock export info.
 */
export function mockExport(opts: MockExportOptions = {}): ExportInfo {
  return {
    name: opts.name ?? "testExport",
    localName: opts.localName,
    location: loc(opts.file ?? "test.ts", opts.line ?? 1),
    kind: opts.kind ?? "function",
    isTypeOnly: opts.isTypeOnly ?? false,
    from: opts.from,
  };
}

/**
 * Options for creating a mock import.
 */
export interface MockImportOptions {
  name?: string;
  localName?: string;
  file?: string;
  line?: number;
  from?: string;
  isTypeOnly?: boolean;
  isNamespace?: boolean;
}

/**
 * Create a mock import info.
 */
export function mockImport(opts: MockImportOptions = {}): ImportInfo {
  return {
    name: opts.name ?? "testImport",
    localName: opts.localName,
    location: loc(opts.file ?? "test.ts", opts.line ?? 1),
    from: opts.from ?? "./other.ts",
    isTypeOnly: opts.isTypeOnly ?? false,
    isNamespace: opts.isNamespace ?? false,
  };
}

// =============================================================================
// Schema Builders
// =============================================================================

/**
 * Options for creating a mock schema.
 */
export interface MockSchemaOptions {
  name?: string;
  file?: string;
  title?: string;
  description?: string;
  rootType?: string;
  properties?: string[];
  required?: string[];
}

/**
 * Create a mock schema info.
 */
export function mockSchema(opts: MockSchemaOptions = {}): SchemaInfo {
  return {
    name: opts.name ?? "TestSchema",
    file: opts.file ?? "schemas/test.schema.json",
    title: opts.title,
    description: opts.description,
    rootType: opts.rootType ?? "object",
    properties: opts.properties ?? [],
    required: opts.required ?? [],
  };
}

// =============================================================================
// File Builders
// =============================================================================

/**
 * Options for creating a mock file.
 */
export interface MockFileOptions {
  path?: string;
  extension?: string;
  lineCount?: number;
  functions?: FunctionInfo[];
  types?: TypeInfo[];
  strings?: StringLiteral[];
  exports?: ExportInfo[];
  imports?: ImportInfo[];
  content?: string;
}

/**
 * Create a mock file info.
 */
export function mockFile(opts: MockFileOptions = {}): FileInfo {
  return {
    path: opts.path ?? "test.ts",
    extension: opts.extension ?? ".ts",
    lineCount: opts.lineCount ?? 100,
    functions: opts.functions ?? [],
    types: opts.types ?? [],
    strings: opts.strings ?? [],
    exports: opts.exports ?? [],
    imports: opts.imports ?? [],
    content: opts.content,
  };
}

// =============================================================================
// Codebase Builders
// =============================================================================

/**
 * Options for creating mock codebase data.
 */
export interface MockCodebaseOptions {
  projectRoot?: string;
  files?: FileInfo[];
  schemas?: SchemaInfo[];
  extractedAt?: number;
}

/**
 * Create mock codebase data.
 */
export function mockCodebase(opts: MockCodebaseOptions = {}): CodebaseData {
  const files = opts.files ?? [];

  // Aggregate all data from files
  const allFunctions = files.flatMap((f) => f.functions);
  const allTypes = files.flatMap((f) => f.types);
  const allStrings = files.flatMap((f) => f.strings);
  const allExports = files.flatMap((f) => f.exports);
  const allImports = files.flatMap((f) => f.imports);

  return {
    projectRoot: opts.projectRoot ?? "/test/project",
    files,
    schemas: opts.schemas ?? [],
    extractedAt: opts.extractedAt ?? Date.now(),
    allFunctions,
    allTypes,
    allStrings,
    allExports,
    allImports,
  };
}

// =============================================================================
// Linter Test Helpers
// =============================================================================

/**
 * Default linter config for testing.
 */
export const defaultConfig: LinterConfig = {
  enabled: true,
  severity: undefined,
  options: {},
};

/**
 * Run a linter and return violations.
 */
export function runLinter(
  linter: BaseLinter,
  data: CodebaseData,
  config: LinterConfig = defaultConfig
) {
  return linter.lint(data, config);
}

/**
 * Assert that violations contain expected codes.
 */
export function expectCodes(
  violations: { code: string }[],
  expectedCodes: string[]
): void {
  const actualCodes = violations.map((v) => v.code).sort();
  const expected = [...expectedCodes].sort();

  if (actualCodes.length !== expected.length) {
    throw new Error(
      `Expected ${expected.length} violations, got ${actualCodes.length}.\n` +
        `Expected: ${expected.join(", ")}\n` +
        `Actual: ${actualCodes.join(", ")}`
    );
  }

  for (let i = 0; i < expected.length; i++) {
    if (actualCodes[i] !== expected[i]) {
      throw new Error(
        `Violation code mismatch at index ${i}.\n` +
          `Expected: ${expected[i]}\n` +
          `Actual: ${actualCodes[i]}`
      );
    }
  }
}

/**
 * Assert that no violations were found.
 */
export function expectNoViolations(violations: unknown[]): void {
  if (violations.length > 0) {
    throw new Error(
      `Expected no violations, got ${violations.length}:\n` +
        JSON.stringify(violations, null, 2)
    );
  }
}

/**
 * Assert that at least one violation was found.
 */
export function expectViolations(
  violations: unknown[],
  minCount = 1
): void {
  if (violations.length < minCount) {
    throw new Error(
      `Expected at least ${minCount} violation(s), got ${violations.length}`
    );
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Simple hash function for test data.
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

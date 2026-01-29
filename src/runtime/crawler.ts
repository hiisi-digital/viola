/**
 * Viola Crawler
 *
 * Single-pass code analyzer that extracts all relevant data from the codebase.
 * This is the heart of viola - it crawls once and provides immutable data to all linters.
 *
 * @module
 */

import { deepFreeze } from "@hiisi/flash-freeze";
import { walk } from "@std/fs/walk";
import { basename, extname, join, relative } from "@std/path";
import type {
    CodebaseData,
    ExportInfo,
    FileInfo,
    FunctionInfo,
    FunctionParam,
    ImportInfo,
    SchemaInfo,
    SourceLocation,
    StringLiteral,
    TypeField,
    TypeInfo,
    ViolaConfig,
} from "../data/types.ts";
import { hashCodeBody } from "../utils/hash.ts";
import { normalizeCode } from "../utils/similarity.ts";

// =============================================================================
// Regex Patterns
// =============================================================================

/**
 * Pattern to match function declarations.
 * Captures: async?, name, params, return type?, body
 */
const FUNCTION_PATTERN =
  /(?:^|\n)\s*(export\s+)?(default\s+)?(async\s+)?function\s*(\*?)\s*(\w+)?\s*(<[^>]+>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/gm;

/**
 * Pattern to match arrow function assignments.
 * Captures: export?, const/let, name, type params?, params, return type?
 */
const ARROW_FUNCTION_PATTERN =
  /(?:^|\n)\s*(export\s+)?(const|let)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?(?:<[^>]+>)?\s*\(([^)]*)\)\s*(?::\s*([^=]+))?\s*=>/gm;

/**
 * Pattern to match interface declarations.
 */
const INTERFACE_PATTERN =
  /(?:^|\n)\s*(export\s+)?(default\s+)?interface\s+(\w+)\s*(<[^>]+>)?(?:\s+extends\s+([^{]+))?\s*\{/gm;

/**
 * Pattern to match type alias declarations.
 */
const TYPE_ALIAS_PATTERN =
  /(?:^|\n)\s*(export\s+)?type\s+(\w+)\s*(<[^>]+>)?\s*=/gm;

/**
 * Pattern to match string literals.
 */
const STRING_LITERAL_PATTERN =
  /(?<!\/\/[^\n]*)(["'`])(?:(?!\1|\\).|\\.)*?\1/g;

/**
 * Pattern to match template literals with expressions.
 */
const TEMPLATE_LITERAL_PATTERN = /`(?:[^`\\$]|\\.|\$(?!\{)|\$\{[^}]*\})*`/g;

/**
 * Pattern to match export statements.
 */
const EXPORT_PATTERN =
  /(?:^|\n)\s*export\s+(?:(type|interface|function|class|const|let|var|enum|namespace|default)\s+)?(?:\{([^}]+)\}\s*from\s*["']([^"']+)["']|(\w+))/gm;

/**
 * Pattern to match import statements.
 */
const IMPORT_PATTERN =
  /(?:^|\n)\s*import\s+(?:(type)\s+)?(?:(\*\s+as\s+\w+)|(\w+)|(?:\{([^}]+)\}))\s+from\s*["']([^"']+)["']/gm;

/**
 * Pattern to match deprecation annotations.
 * Only match actual deprecation markers, not mentions in comments about deprecation detection.
 * - @deprecated JSDoc annotation
 * - DEPRECATED in all caps (marker)
 * - "is deprecated" or "are deprecated" (actual deprecation statement)
 * - "marked as deprecated"
 */
const DEPRECATION_PATTERNS = [
  /@deprecated/i,                    // JSDoc annotation
  /\bDEPRECATED\b/,                  // All caps marker (exact case)
  /\bis\s+deprecated\b/i,            // "is deprecated"
  /\bare\s+deprecated\b/i,           // "are deprecated"
  /\bmarked\s+(?:as\s+)?deprecated\b/i, // "marked deprecated" or "marked as deprecated"
];

/**
 * Patterns that indicate false positives (talking ABOUT deprecation, not actual deprecation).
 */
const DEPRECATION_FALSE_POSITIVES = [
  /has\s+any\s+@?deprecated/i,       // "has any @deprecated" - describing a field
  /check.*deprecat/i,                // "check for deprecation"
  /detect.*deprecat/i,               // "detect deprecation"
  /find.*deprecat/i,                 // "find deprecation"
  /deprecation.?pattern/i,           // "deprecation pattern"
  /deprecation.?check/i,             // "deprecation check"
  /deprecation.?linter/i,            // "deprecation linter"
];

/**
 * Pattern to match JSDoc comments.
 */
const JSDOC_PATTERN = /\/\*\*[\s\S]*?\*\//g;

/**
 * Pattern to match class declarations.
 */
const CLASS_PATTERN =
  /(?:^|\n)\s*(export\s+)?(default\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/gm;

// =============================================================================
// Extraction Helpers
// =============================================================================

/**
 * Find the matching closing brace for an opening brace.
 */
function findMatchingBrace(content: string, startIndex: number): number {
  let depth = 1;
  let i = startIndex;

  // Skip to after the opening brace
  while (i < content.length && content[i] !== "{") i++;
  i++; // Move past opening brace

  while (i < content.length && depth > 0) {
    const char = content[i];

    // Skip string literals
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      i++;
      while (i < content.length) {
        if (content[i] === "\\") {
          i += 2;
          continue;
        }
        if (content[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Skip comments
    if (char === "/" && content[i + 1] === "/") {
      while (i < content.length && content[i] !== "\n") i++;
      continue;
    }
    if (char === "/" && content[i + 1] === "*") {
      i += 2;
      while (i < content.length - 1) {
        if (content[i] === "*" && content[i + 1] === "/") {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    if (char === "{") depth++;
    if (char === "}") depth--;
    i++;
  }

  return i;
}

/**
 * Get line number for a character index.
 */
function getLineNumber(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/**
 * Extract function parameters from a parameter string.
 */
function parseParams(paramStr: string): FunctionParam[] {
  if (!paramStr.trim()) return [];

  const params: FunctionParam[] = [];
  let depth = 0;
  let current = "";

  for (const char of paramStr) {
    if (char === "(" || char === "<" || char === "[" || char === "{") depth++;
    if (char === ")" || char === ">" || char === "]" || char === "}") depth--;

    if (char === "," && depth === 0) {
      const param = parseParam(current.trim());
      if (param) params.push(param);
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    const param = parseParam(current.trim());
    if (param) params.push(param);
  }

  return params;
}

/**
 * Parse a single parameter.
 */
function parseParam(param: string): FunctionParam | null {
  if (!param) return null;

  const rest = param.startsWith("...");
  if (rest) param = param.slice(3);

  // Split by = for default value
  const _splitParts = param.split("=").map((s) => s.trim()); const mainPart = _splitParts[0] ?? ""; const defaultValue = _splitParts[1];

  // Split by : for type
  const colonIndex = mainPart.indexOf(":");
  let name: string;
  let type: string | undefined;

  if (colonIndex !== -1) {
    name = mainPart.slice(0, colonIndex).trim();
    type = mainPart.slice(colonIndex + 1).trim();
  } else {
    name = mainPart;
  }

  // Check for optional (?)
  const optional = name.endsWith("?");
  if (optional) name = name.slice(0, -1);

  return {
    name,
    type,
    optional,
    rest,
    defaultValue,
  };
}

/**
 * Extract JSDoc comment preceding an index.
 */
function extractPrecedingJsDoc(
  content: string,
  index: number
): string | undefined {
  // Look backwards for JSDoc
  const beforeContent = content.slice(0, index);
  const lastJsDoc = beforeContent.lastIndexOf("/**");

  if (lastJsDoc === -1) return undefined;

  const jsDocEnd = beforeContent.indexOf("*/", lastJsDoc);
  if (jsDocEnd === -1) return undefined;

  // Check if there's only whitespace between JSDoc and the target
  const between = beforeContent.slice(jsDocEnd + 2).trim();
  if (between.length > 0) return undefined;

  return beforeContent.slice(lastJsDoc, jsDocEnd + 2);
}

/**
 * Extract interface/type fields from a body.
 */
function parseTypeFields(body: string): TypeField[] {
  const fields: TypeField[] = [];
  const lines = body.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "{" || trimmed === "}") continue;

    // Skip methods
    if (trimmed.includes("(") && !trimmed.includes(":")) continue;

    // Match field pattern: name?: type;
    const match = trimmed.match(
      /^(readonly\s+)?(\w+)(\?)?:\s*([^;]+);?\s*(?:\/\/.*)?$/
    );
    if (match) {
      fields.push({
        name: match[2]!,
        type: match[4]!.trim(),
        optional: !!match[3],
        readonly: !!match[1],
      });
    }
  }

  return fields;
}

// =============================================================================
// File Extraction
// =============================================================================

/**
 * Extract all relevant data from a single file.
 */
function extractFileData(
  content: string,
  filePath: string,
  projectRoot: string
): FileInfo {
  const relativePath = relative(projectRoot, filePath);
  const lines = content.split("\n");

  const functions: FunctionInfo[] = [];
  const types: TypeInfo[] = [];
  const strings: StringLiteral[] = [];
  const exports: ExportInfo[] = [];
  const imports: ImportInfo[] = [];
  const deprecations: SourceLocation[] = [];

  // Extract functions
  extractFunctions(content, relativePath, functions);

  // Extract arrow functions
  extractArrowFunctions(content, relativePath, functions);

  // Extract interfaces
  extractInterfaces(content, relativePath, types);

  // Extract type aliases
  extractTypeAliases(content, relativePath, types);

  // Extract string literals
  extractStrings(content, relativePath, strings);

  // Extract exports
  extractExports(content, relativePath, exports);

  // Extract imports
  extractImports(content, relativePath, imports);

  // Extract deprecations
  extractDeprecations(content, relativePath, deprecations);

  return {
    path: relativePath,
    extension: extname(filePath),
    lineCount: lines.length,
    functions,
    types,
    strings,
    exports,
    imports,
    hasDeprecations: deprecations.length > 0,
    deprecations,
  };
}

/**
 * Extract function declarations.
 */
function extractFunctions(
  content: string,
  filePath: string,
  functions: FunctionInfo[]
): void {
  let match;
  FUNCTION_PATTERN.lastIndex = 0;

  while ((match = FUNCTION_PATTERN.exec(content)) !== null) {
    const [
      fullMatch,
      exportKw,
      defaultKw,
      asyncKw,
      generator,
      name,
      _typeParams,
      params,
      returnType,
    ] = match;

    const startIndex = match.index;
    const line = getLineNumber(content, startIndex);

    // Find body
    const bodyStart = content.indexOf("{", startIndex);
    const bodyEnd = findMatchingBrace(content, bodyStart);
    const body = content.slice(bodyStart, bodyEnd);

    const normalizedBody = normalizeCode(body);
    const jsDoc = extractPrecedingJsDoc(content, startIndex);

    functions.push({
      name: name || "",
      location: { file: filePath, line },
      params: parseParams(params || ""),
      returnType: returnType?.trim(),
      isAsync: !!asyncKw,
      isGenerator: !!generator,
      isExported: !!exportKw,
      isDefaultExport: !!defaultKw,
      body,
      normalizedBody,
      bodyHash: hashCodeBody(body),
      jsDoc,
      kind: generator ? "function" : "function",
    });
  }
}

/**
 * Extract arrow function declarations.
 */
function extractArrowFunctions(
  content: string,
  filePath: string,
  functions: FunctionInfo[]
): void {
  let match;
  ARROW_FUNCTION_PATTERN.lastIndex = 0;

  while ((match = ARROW_FUNCTION_PATTERN.exec(content)) !== null) {
    const [fullMatch, exportKw, _varKw, name, asyncKw, params, returnType] =
      match;

    const startIndex = match.index;
    const line = getLineNumber(content, startIndex);

    // Find body - could be expression or block
    const arrowIndex = content.indexOf("=>", startIndex + fullMatch.length - 2);
    let bodyStart = arrowIndex + 2;

    // Skip whitespace
    while (bodyStart < content.length && /\s/.test(content[bodyStart]!)) {
      bodyStart++;
    }

    let body: string;
    let bodyEnd: number;

    if (content[bodyStart] === "{") {
      // Block body
      bodyEnd = findMatchingBrace(content, bodyStart);
      body = content.slice(bodyStart, bodyEnd);
    } else {
      // Expression body - find end (semicolon or newline with lower indent)
      bodyEnd = bodyStart;
      let parenDepth = 0;
      while (bodyEnd < content.length) {
        const char = content[bodyEnd];
        if (char === "(" || char === "[" || char === "{") parenDepth++;
        if (char === ")" || char === "]" || char === "}") parenDepth--;
        if (parenDepth === 0 && (char === ";" || char === "\n")) break;
        bodyEnd++;
      }
      body = content.slice(bodyStart, bodyEnd);
    }

    const normalizedBody = normalizeCode(body);
    const jsDoc = extractPrecedingJsDoc(content, startIndex);
    if (!name) continue;

    functions.push({
      name,
      location: { file: filePath, line },
      params: parseParams(params || ""),
      returnType: returnType?.trim(),
      isAsync: !!asyncKw,
      isGenerator: false,
      isExported: !!exportKw,
      isDefaultExport: false,
      body,
      normalizedBody,
      bodyHash: hashCodeBody(body),
      jsDoc,
      kind: "arrow",
    });
  }
}

/**
 * Extract interface declarations.
 */
function extractInterfaces(
  content: string,
  filePath: string,
  types: TypeInfo[]
): void {
  let match;
  INTERFACE_PATTERN.lastIndex = 0;

  while ((match = INTERFACE_PATTERN.exec(content)) !== null) {
    const [fullMatch, exportKw, defaultKw, name, typeParams, extendsClause] =
      match;

    const startIndex = match.index;
    const line = getLineNumber(content, startIndex);

    // Find body
    const bodyStart = content.indexOf("{", startIndex);
    const bodyEnd = findMatchingBrace(content, bodyStart);
    const body = content.slice(bodyStart, bodyEnd);

    const normalizedBody = normalizeCode(body);
    const jsDoc = extractPrecedingJsDoc(content, startIndex);
    if (!name) continue;

    types.push({
      name,
      location: { file: filePath, line },
      kind: "interface",
      isExported: !!exportKw,
      isDefaultExport: !!defaultKw,
      fields: parseTypeFields(body),
      typeParams: typeParams
        ? typeParams
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim())
        : undefined,
      extends: extendsClause
        ? extendsClause.split(",").map((s) => s.trim())
        : undefined,
      body,
      normalizedBody,
      bodyHash: hashCodeBody(body),
      jsDoc,
    });
  }
}

/**
 * Extract type alias declarations.
 */
function extractTypeAliases(
  content: string,
  filePath: string,
  types: TypeInfo[]
): void {
  let match;
  TYPE_ALIAS_PATTERN.lastIndex = 0;

  while ((match = TYPE_ALIAS_PATTERN.exec(content)) !== null) {
    const [fullMatch, exportKw, name, typeParams] = match;

    const startIndex = match.index;
    const line = getLineNumber(content, startIndex);

    // Find the end of the type (semicolon or end of statement)
    let endIndex = content.indexOf(";", startIndex + fullMatch.length);
    if (endIndex === -1) {
      // No semicolon, try to find end by brace matching or newline
      const afterEquals = startIndex + fullMatch.length;
      if (content[afterEquals]?.trim() === "{") {
        endIndex = findMatchingBrace(content, afterEquals);
      } else {
        // Find next statement
        endIndex = content.indexOf("\n\n", afterEquals);
        if (endIndex === -1) endIndex = content.length;
      }
    }

    const body = content.slice(startIndex + fullMatch.length, endIndex).trim();
    const normalizedBody = normalizeCode(body);
    const jsDoc = extractPrecedingJsDoc(content, startIndex);

    // Try to parse fields if it's an object type
    let fields: TypeField[] = [];
    if (body.startsWith("{")) {
      fields = parseTypeFields(body);
    }
    if (!name) continue;

    types.push({
      name,
      location: { file: filePath, line },
      kind: "type",
      isExported: !!exportKw,
      isDefaultExport: false,
      fields,
      typeParams: typeParams
        ? typeParams
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim())
        : undefined,
      body,
      normalizedBody,
      bodyHash: hashCodeBody(body),
      jsDoc,
    });
  }
}

/**
 * Extract string literals.
 */
function extractStrings(
  content: string,
  filePath: string,
  strings: StringLiteral[]
): void {
  // Track which parts of content are in comments to skip them
  const inComment = new Set<number>();

  // Mark single-line comments
  let singleLineMatch;
  const singleLinePattern = /\/\/[^\n]*/g;
  while ((singleLineMatch = singleLinePattern.exec(content)) !== null) {
    for (
      let i = singleLineMatch.index;
      i < singleLineMatch.index + singleLineMatch[0].length;
      i++
    ) {
      inComment.add(i);
    }
  }

  // Mark multi-line comments
  let multiLineMatch;
  const multiLinePattern = /\/\*[\s\S]*?\*\//g;
  while ((multiLineMatch = multiLinePattern.exec(content)) !== null) {
    for (
      let i = multiLineMatch.index;
      i < multiLineMatch.index + multiLineMatch[0].length;
      i++
    ) {
      inComment.add(i);
    }
  }

  // Extract string literals
  let match;
  STRING_LITERAL_PATTERN.lastIndex = 0;

  while ((match = STRING_LITERAL_PATTERN.exec(content)) !== null) {
    if (inComment.has(match.index)) continue;

    const quote = match[0][0];
    const value = match[0].slice(1, -1);
    const line = getLineNumber(content, match.index);

    // Skip very short strings (likely punctuation/operators)
    if (value.length < 2) continue;

    // Skip import/require paths
    const beforeMatch = content.slice(Math.max(0, match.index - 20), match.index);
    if (/import\s+.*from\s*$|require\s*\(\s*$|from\s+$/.test(beforeMatch)) continue;

    strings.push({
      value,
      location: { file: filePath, line },
      quoteStyle: quote === '"' ? "double" : quote === "'" ? "single" : "backtick",
      isTemplate: quote === "`",
    });
  }
}

/**
 * Extract export statements.
 */
function extractExports(
  content: string,
  filePath: string,
  exports: ExportInfo[]
): void {
  let match;
  EXPORT_PATTERN.lastIndex = 0;

  while ((match = EXPORT_PATTERN.exec(content)) !== null) {
    const [fullMatch, kind, namedExports, fromModule, singleExport] = match;
    const line = getLineNumber(content, match.index);

    if (namedExports && fromModule) {
      // Re-export: export { x, y } from "module"
      const names = namedExports.split(",").map((s) => s.trim());
      for (const name of names) {
        const isTypeOnly = name.startsWith("type ");
        const cleanName = name.replace(/^type\s+/, "").replace(/\s+as\s+\w+$/, "");
        exports.push({
          name: cleanName,
          location: { file: filePath, line },
          kind: "re-export",
          isTypeOnly,
          from: fromModule,
        });
      }
    } else if (singleExport) {
      // Single export: export const x, export function x, etc.
      exports.push({
        name: singleExport,
        location: { file: filePath, line },
        kind: (kind as ExportInfo["kind"]) || "unknown",
        isTypeOnly: kind === "type" || kind === "interface",
      });
    }
  }
}

/**
 * Extract import statements.
 */
function extractImports(
  content: string,
  filePath: string,
  imports: ImportInfo[]
): void {
  let match;
  IMPORT_PATTERN.lastIndex = 0;

  while ((match = IMPORT_PATTERN.exec(content)) !== null) {
    const [
      fullMatch,
      typeOnly,
      namespaceImport,
      defaultImport,
      namedImports,
      fromModule,
    ] = match;
    const line = getLineNumber(content, match.index);
    if (!fromModule) continue;

    if (namespaceImport) {
      // import * as X from "module"
      const name = namespaceImport.replace(/\*\s+as\s+/, "");
      imports.push({
        name,
        location: { file: filePath, line },
        from: fromModule,
        isTypeOnly: !!typeOnly,
        isNamespace: true,
      });
    } else if (defaultImport) {
      // import X from "module"
      imports.push({
        name: "default",
        localName: defaultImport,
        location: { file: filePath, line },
        from: fromModule,
        isTypeOnly: !!typeOnly,
        isNamespace: false,
      });
    } else if (namedImports) {
      // import { x, y } from "module"
      const names = namedImports.split(",").map((s) => s.trim());
      for (const name of names) {
        const isTypeOnlyImport = name.startsWith("type ");
        const cleanName = name
          .replace(/^type\s+/, "")
          .replace(/\s+as\s+\w+$/, "");
        const asMatch = name.match(/\s+as\s+(\w+)$/);
        imports.push({
          name: cleanName,
          localName: asMatch ? asMatch[1] : undefined,
          location: { file: filePath, line },
          from: fromModule,
          isTypeOnly: !!typeOnly || isTypeOnlyImport,
          isNamespace: false,
        });
      }
    }
  }
}

/**
 * Extract deprecation annotations.
 */
function extractDeprecations(
  content: string,
  filePath: string,
  deprecations: SourceLocation[]
): void {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const lineNum = i + 1;

    // Check if line matches any deprecation pattern
    const matchesDeprecation = DEPRECATION_PATTERNS.some((pattern) =>
      pattern.test(line)
    );

    if (!matchesDeprecation) continue;

    // Check for false positives
    const isFalsePositive = DEPRECATION_FALSE_POSITIVES.some((pattern) =>
      pattern.test(line)
    );

    if (isFalsePositive) continue;

    deprecations.push({
      file: filePath,
      line: lineNum,
    });
  }
}

// =============================================================================
// Schema Extraction
// =============================================================================

/**
 * Extract schema information from a JSON schema file.
 */
async function extractSchemaData(filePath: string): Promise<SchemaInfo | null> {
  try {
    const content = await Deno.readTextFile(filePath);
    const schema = JSON.parse(content);

    // Check if it's actually a JSON Schema
    if (!schema.$schema && !schema.type && !schema.properties) {
      return null;
    }

    const name = basename(filePath, ".schema.json").replace(".json", "");

    return {
      file: filePath,
      name,
      title: schema.$title || schema.title,
      description: schema.description,
      rootType: schema.type,
      properties: schema.properties ? Object.keys(schema.properties) : [],
      required: schema.required || [],
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Main Crawler
// =============================================================================

/**
 * Default configuration for the crawler.
 */
export const DEFAULT_CONFIG: Partial<ViolaConfig> = {
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"],
  exclude: [
    /node_modules/,
    /\.git/,
    /_fresh/,
    /target/,
    /dist/,
    /build/,
    /coverage/,
    /\.d\.ts$/,
  ],
};

/**
 * Crawl the codebase and extract all relevant data.
 *
 * @param config - Crawler configuration
 * @returns Frozen codebase data
 */
export async function crawlCodebase(
  config: ViolaConfig
): Promise<Readonly<CodebaseData>> {
  const startTime = Date.now();

  const extensions = config.extensions.length > 0 ? config.extensions : DEFAULT_CONFIG.extensions!;
  const excludePatterns = [...(config.exclude || []), ...(DEFAULT_CONFIG.exclude || [])];

  const files: FileInfo[] = [];
  const schemas: SchemaInfo[] = [];

  // Crawl source files
  for (const includeDir of config.include) {
    const fullPath = join(config.projectRoot, includeDir);

    try {
      for await (const entry of walk(fullPath, {
        exts: extensions.map((e) => e.replace(/^\./, "")),
        skip: excludePatterns,
      })) {
        if (!entry.isFile) continue;

        // Additional exclusion check
        const relativePath = relative(config.projectRoot, entry.path);
        if (excludePatterns.some((p) => p.test(relativePath))) continue;

        try {
          const content = await Deno.readTextFile(entry.path);
          const fileData = extractFileData(content, entry.path, config.projectRoot);
          files.push(fileData);
        } catch (err) {
          if (config.verbose) {
            console.error(`Error reading ${entry.path}:`, err);
          }
        }
      }
    } catch (err) {
      if (config.verbose) {
        console.error(`Error walking ${fullPath}:`, err);
      }
    }
  }

  // Crawl JSON schemas
  for (const includeDir of config.include) {
    const fullPath = join(config.projectRoot, includeDir);

    try {
      for await (const entry of walk(fullPath, {
        exts: ["json"],
        skip: excludePatterns,
        match: [/\.schema\.json$/, /schemas?\//],
      })) {
        if (!entry.isFile) continue;

        const schemaData = await extractSchemaData(entry.path);
        if (schemaData) {
          schemas.push(schemaData);
        }
      }
    } catch {
      // Ignore errors for schema crawling
    }
  }

  // Aggregate views
  const allFunctions = files.flatMap((f) => f.functions);
  const allTypes = files.flatMap((f) => f.types);
  const allStrings = files.flatMap((f) => f.strings);
  const allExports = files.flatMap((f) => f.exports);
  const allImports = files.flatMap((f) => f.imports);

  const data: CodebaseData = {
    projectRoot: config.projectRoot,
    files,
    schemas,
    extractedAt: Date.now(),
    allFunctions,
    allTypes,
    allStrings,
    allExports,
    allImports,
  };

  // Freeze everything before returning
  return deepFreeze(data);
}

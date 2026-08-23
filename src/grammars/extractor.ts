/**
 * Generic Extraction Engine
 *
 * Extracts structured data from parsed syntax trees using tree-sitter queries.
 * This is the core of the grammar-based extraction system - it transforms
 * query captures into the unified FileInfo data structures.
 *
 * @module
 */

import type {
    ExportInfo,
    FileInfo,
    FunctionInfo,
    FunctionParam,
    ImportInfo,
    SourceLocation,
    StringLiteral,
    TypeField,
    TypeInfo,
} from "../data/types.ts";
import type { Language, Tree } from "./loader.ts";
import { runQuery } from "./query.ts";
import type { GrammarDefinition } from "./types.ts";
import { hashCodeBody } from "../utils/hash.ts";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert a tree-sitter node position to a SourceLocation.
 */
function nodeToLocation(node: { startPosition: { row: number; column: number }; endPosition: { row: number; column: number } }, file: string): SourceLocation {
  return {
    file,
    line: node.startPosition.row + 1, // tree-sitter is 0-indexed
    column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
  };
}

/**
 * Default parameter parsing - simple comma-split.
 * Grammars with complex parameter syntax should provide a transform.
 */
function defaultParseParams(paramsText: string | undefined): FunctionParam[] {
  if (!paramsText) return [];

  // Strip outer parentheses if present
  const inner = paramsText.replace(/^\(|\)$/g, "").trim();
  if (!inner) return [];

  // Simple split by comma (doesn't handle nested commas in types)
  const parts = inner.split(",");

  return parts.map((p) => {
    const trimmed = p.trim();
    // Extract name (first identifier before : or = or whitespace)
    const nameMatch = trimmed.match(/^\.{0,3}(\w+)/);
    const name = nameMatch ? nameMatch[1] : trimmed;

    return {
      name: name ?? "",
      optional: trimmed.includes("?"),
      rest: trimmed.startsWith("..."),
    };
  });
}

/**
 * Infer quote style from string text.
 */
function inferQuoteStyle(text: string): "single" | "double" | "backtick" {
  if (text.startsWith("`")) return "backtick";
  if (text.startsWith("'")) return "single";
  return "double";
}

/**
 * Strip quotes from a string literal.
 */
function stripQuotes(text: string): string {
  // Handle various quote styles
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith("`") && text.endsWith("`"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Default body normalization - strip whitespace.
 */
function defaultNormalizeBody(body: string): string {
  return body
    .replace(/\/\/.*$/gm, "") // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

// Hash function uses hashCodeBody() from utils/hash.ts (imported above)
// to ensure consistent hashing between regex and grammar extraction paths.

// =============================================================================
// Extraction Functions
// =============================================================================

/**
 * Extract function information from query captures.
 */
/**
 * The doc comment attached to a declaration, if it has one.
 *
 * Nothing populated `jsDoc` anywhere in this package. The field was declared on
 * three interfaces, read by the missing-docs lint, and set by hand in that
 * lint's fixtures, so its 218 tests passed while the extractor never wrote it
 * once. Against real source the lint could only ever report every exported
 * symbol as undocumented, which is what it did.
 *
 * A doc comment is the comment immediately above the declaration. `export`
 * wraps the declaration in a statement, so the comment is a sibling of the
 * wrapper rather than of the function, and both are checked. Anything that is
 * not a `/** ... *\/` block is not documentation: a `//` note above a function
 * is a remark to the next reader, not an api description.
 */
function docCommentFor(
  node: SyntaxNode | undefined,
  grammar: GrammarDefinition,
  sourceCode: string,
): string | undefined {
  let at: SyntaxNode | null | undefined = node;
  for (let hop = 0; at && hop < 3; hop++) {
    const prev = at.previousNamedSibling;
    if (prev?.type === "comment" && prev.text.startsWith("/**")) {
      return grammar.transforms?.parseDocComment
        ? grammar.transforms.parseDocComment(prev, sourceCode)
        : prev.text;
    }
    // an exported declaration sits inside an export statement, and the comment
    // is above that, so climb before giving up.
    at = at.parent;
  }
  return undefined;
}

function extractFunctions(
  tree: Tree,
  language: Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string
): FunctionInfo[] {
  const functions: FunctionInfo[] = [];
  const transforms = grammar.transforms;

  for (const captures of runQuery(
    tree,
    language,
    grammar.queries.functions,
    sourceCode
  )) {
    const nameCapture = captures.get("function.name");
    const bodyCapture = captures.get("function.body");
    const paramsCapture = captures.get("function.params");
    const returnCapture = captures.get("function.return");
    const functionCapture = captures.get("function");

    const name = nameCapture?.text ?? "";
    const body = bodyCapture?.text ?? "";
    const node =
      functionCapture?.node ?? nameCapture?.node ?? bodyCapture?.node;

    if (!node) continue;

    // Use transform or default for params
    const params = transforms?.parseParams
      ? transforms.parseParams(paramsCapture?.node, sourceCode)
      : defaultParseParams(paramsCapture?.text);

    // Use transform or capture for return type
    const returnType = transforms?.extractReturnType
      ? transforms.extractReturnType(node, captures)
      : returnCapture?.text;

    // Normalize body
    const normalizedBody = transforms?.normalizeBody
      ? transforms.normalizeBody(body, grammar.meta.id)
      : defaultNormalizeBody(body);

    functions.push({
      name,
      location: nodeToLocation(node, filePath),
      params,
      returnType,
      body,
      normalizedBody,
      bodyHash: hashCodeBody(normalizedBody),
      isAsync: transforms?.isAsync?.(node, captures) ?? captures.has("function.async"),
      isGenerator: transforms?.isGenerator?.(node, captures) ?? captures.has("function.generator"),
      isExported: transforms?.isExported?.(node, captures) ?? captures.has("function.export"),
      isDefaultExport: transforms?.isDefaultExport?.(node, captures) ?? captures.has("function.default"),
      jsDoc: docCommentFor(node, grammar, sourceCode),
      kind: "function" as const,
    });
  }

  return functions;
}

/**
 * Extract string literals from query captures.
 */
function extractStrings(
  tree: Tree,
  language: Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string
): StringLiteral[] {
  if (!grammar.queries.strings) return [];

  const strings: StringLiteral[] = [];
  const transforms = grammar.transforms;

  for (const captures of runQuery(
    tree,
    language,
    grammar.queries.strings,
    sourceCode
  )) {
    const valueCapture = captures.get("string.value");
    if (!valueCapture) continue;

    const isTemplate = captures.has("string.template");
    const isRaw = captures.has("string.raw");

    const quoteStyle = transforms?.getQuoteStyle
      ? transforms.getQuoteStyle(valueCapture.node)
      : isRaw
        ? "raw" as const
        : inferQuoteStyle(valueCapture.text);

    strings.push({
      value: stripQuotes(valueCapture.text),
      location: nodeToLocation(valueCapture.node, filePath),
      quoteStyle: quoteStyle === "raw" ? "single" : quoteStyle,
      isTemplate,
    });
  }

  return strings;
}

/**
 * Extract import information from query captures.
 */
function extractImports(
  tree: Tree,
  language: Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string
): ImportInfo[] {
  if (!grammar.queries.imports) return [];

  const imports: ImportInfo[] = [];
  const transforms = grammar.transforms;

  for (const captures of runQuery(
    tree,
    language,
    grammar.queries.imports,
    sourceCode
  )) {
    if (transforms?.parseImport) {
      const firstCapture = captures.all().values().next().value;
      const node = captures.get("import")?.node ?? firstCapture?.node;
      if (!node) continue;

      const result = transforms.parseImport(node, captures, sourceCode);
      if (Array.isArray(result)) {
        // Add file path to locations
        imports.push(
          ...result.map((imp) => ({
            ...imp,
            location: { ...imp.location, file: filePath },
          }))
        );
      } else {
        imports.push({
          ...result,
          location: { ...result.location, file: filePath },
        });
      }
    } else {
      const nameCapture = captures.get("import.name");
      const fromCapture = captures.get("import.from");

      if (nameCapture && fromCapture) {
        imports.push({
          name: nameCapture.text,
          location: nodeToLocation(nameCapture.node, filePath),
          from: stripQuotes(fromCapture.text),
          isTypeOnly: captures.has("import.type_only"),
          isNamespace: captures.has("import.namespace"),
        });
      }
    }
  }

  return imports;
}

/**
 * Extract export information from query captures.
 */
function extractExports(
  tree: Tree,
  language: Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string
): ExportInfo[] {
  if (!grammar.queries.exports) return [];

  const exports: ExportInfo[] = [];
  const transforms = grammar.transforms;

  for (const captures of runQuery(
    tree,
    language,
    grammar.queries.exports,
    sourceCode
  )) {
    if (transforms?.parseExport) {
      const firstCapture = captures.all().values().next().value;
      const node = captures.get("export")?.node ?? firstCapture?.node;
      if (!node) continue;

      const result = transforms.parseExport(node, captures, sourceCode);
      if (Array.isArray(result)) {
        exports.push(
          ...result.map((exp) => ({
            ...exp,
            location: { ...exp.location, file: filePath },
          }))
        );
      } else {
        exports.push({
          ...result,
          location: { ...result.location, file: filePath },
        });
      }
    } else {
      const nameCapture = captures.get("export.name");

      if (nameCapture) {
        const kindCapture = captures.get("export.kind");
        const fromCapture = captures.get("export.from");

        exports.push({
          name: nameCapture.text,
          location: nodeToLocation(nameCapture.node, filePath),
          kind: (kindCapture?.text as ExportInfo["kind"]) ?? "unknown",
          isTypeOnly: captures.has("export.type_only"),
          from: fromCapture ? stripQuotes(fromCapture.text) : undefined,
        });
      }
    }
  }

  return exports;
}

/**
 * Extract type/interface information from query captures.
 */
function extractTypes(
  tree: Tree,
  language: Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string
): TypeInfo[] {
  if (!grammar.queries.types) return [];

  const types: TypeInfo[] = [];
  const transforms = grammar.transforms;

  for (const captures of runQuery(
    tree,
    language,
    grammar.queries.types,
    sourceCode
  )) {
    const nameCapture = captures.get("type.name");
    const bodyCapture = captures.get("type.body");
    const typeCapture = captures.get("type");

    if (!nameCapture) continue;

    const body = bodyCapture?.text ?? "";
    const node = typeCapture?.node ?? nameCapture.node;

    const fields: TypeField[] = transforms?.parseTypeFields
      ? transforms.parseTypeFields(bodyCapture?.node, sourceCode)
      : [];

    const normalizedBody = transforms?.normalizeBody
      ? transforms.normalizeBody(body, grammar.meta.id)
      : defaultNormalizeBody(body);

    const kindCapture = captures.get("type.kind");
    const kind = (kindCapture?.text as "type" | "interface") ?? "type";

    types.push({
      name: nameCapture.text,
      location: nodeToLocation(node, filePath),
      kind,
      isExported:
        transforms?.isExported?.(node, captures) ??
        captures.has("type.export"),
      isDefaultExport:
        transforms?.isDefaultExport?.(node, captures) ??
        captures.has("type.default"),
      fields,
      body,
      normalizedBody,
      bodyHash: hashCodeBody(normalizedBody),
    });
  }

  return types;
}

// =============================================================================
// Main Extraction Function
// =============================================================================

/**
 * Extract all data from a parsed file using the grammar's queries.
 *
 * This is the main entry point for extraction. It runs all configured
 * queries and transforms the captures into structured FileInfo data.
 *
 * @param tree - The parsed syntax tree
 * @param language - The tree-sitter language
 * @param grammar - The grammar definition with queries and transforms
 * @param filePath - Path to the file (for location info)
 * @param sourceCode - The original source code
 * @returns Extracted data (functions, strings, imports, exports, types)
 *
 * @example
 * ```ts
 * const language = await loadGrammar(bash.grammar);
 * const parser = createParser(bash.grammar, language);
 * const tree = parser.parse(sourceCode);
 *
 * const data = extractFileData(tree, language, bash, "script.sh", sourceCode);
 * console.log(`Found ${data.functions.length} functions`);
 * ```
 */
export function extractFileData(
  tree: Tree,
  language: Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string
): Omit<FileInfo, "path" | "extension" | "lineCount" | "content"> {
  // Each extraction is wrapped in try-catch so a bad query in one category
  // (e.g., types) doesn't prevent extraction of others (e.g., exports).
  let functions: FunctionInfo[] = [];
  let strings: StringLiteral[] = [];
  let imports: ImportInfo[] = [];
  let exports: ExportInfo[] = [];
  let types: TypeInfo[] = [];

  try {
    functions = extractFunctions(tree, language, grammar, filePath, sourceCode);
  } catch { /* query compilation failed for functions */ }

  try {
    strings = extractStrings(tree, language, grammar, filePath, sourceCode);
  } catch { /* query compilation failed for strings */ }

  try {
    imports = extractImports(tree, language, grammar, filePath, sourceCode);
  } catch { /* query compilation failed for imports */ }

  try {
    exports = extractExports(tree, language, grammar, filePath, sourceCode);
  } catch { /* query compilation failed for exports */ }

  try {
    types = extractTypes(tree, language, grammar, filePath, sourceCode);
  } catch { /* query compilation failed for types */ }

  return {
    functions,
    types,
    strings,
    exports,
    imports,
  };
}

/**
 * Extract data and build a complete FileInfo object.
 *
 * @param tree - The parsed syntax tree
 * @param language - The tree-sitter language
 * @param grammar - The grammar definition
 * @param filePath - Path to the file
 * @param extension - File extension
 * @param sourceCode - The original source code
 * @returns Complete FileInfo object
 */
export function extractCompleteFileInfo(
  tree: Tree,
  language: Language,
  grammar: GrammarDefinition,
  filePath: string,
  extension: string,
  sourceCode: string
): FileInfo {
  const extracted = extractFileData(
    tree,
    language,
    grammar,
    filePath,
    sourceCode
  );

  return {
    path: filePath,
    extension,
    lineCount: sourceCode.split("\n").length,
    content: sourceCode,
    ...extracted,
  };
}

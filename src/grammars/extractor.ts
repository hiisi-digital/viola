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
import type { Language, SyntaxNode, Tree } from "./loader.ts";
import { runQuery } from "./query.ts";
import type { GrammarDefinition } from "./types.ts";
import { hashCodeBody } from "../utils/hash.ts";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert a tree-sitter node position to a SourceLocation.
 */
function nodeToLocation(
  node: {
    startPosition: { row: number; column: number };
    endPosition: { row: number; column: number };
  },
  file: string,
): SourceLocation {
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
/** The node type a doc comment arrives as. */
const COMMENT_NODE = "comment";

function docCommentFor(
  node: SyntaxNode | undefined,
  grammar: GrammarDefinition,
  sourceCode: string,
  name?: string,
): string | undefined {
  let at: SyntaxNode | null | undefined = node;
  for (let hop = 0; at && hop < 3; hop++) {
    let prev = at.previousNamedSibling;

    // An overloaded function is documented once, above the first signature,
    // and only the implementation is extracted. Stepping back over the
    // signatures that belong to it is what finds that comment: without this
    // every overloaded function in a codebase reads as undocumented, however
    // carefully it was documented.
    while (prev !== null && isOverloadOf(prev, name)) {
      prev = prev.previousNamedSibling;
    }

    if (prev?.type === COMMENT_NODE && prev.text.startsWith("/**")) {
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

/**
 * Whether a node is another signature of the same function.
 *
 * Two things together, and both are needed. It has no body, which is what
 * separates a signature from the implementation. And it declares the same
 * name, which is what separates it from whatever else happens to sit above.
 *
 * Without the name an `export const other = 1;` above the set qualifies, since
 * it also ends in a semicolon with no brace, and the comment documenting *it*
 * is handed to the function below.
 */
function isOverloadOf(node: SyntaxNode, name: string | undefined): boolean {
  if (node.type === COMMENT_NODE || name === undefined) return false;
  const text = node.text.trimEnd();
  if (!text.endsWith(";") || text.includes("{")) return false;
  return new RegExp(`\\bfunction\\s+${escapeForPattern(name)}\\b`).test(text);
}

/** A name, made safe to put inside a pattern. */
function escapeForPattern(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractFunctions(
  tree: Tree,
  language: Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string,
): FunctionInfo[] {
  const functions: FunctionInfo[] = [];
  const transforms = grammar.transforms;

  for (
    const captures of runQuery(
      tree,
      language,
      grammar.queries.functions,
      sourceCode,
    )
  ) {
    const nameCapture = captures.get("function.name");
    const bodyCapture = captures.get("function.body");
    const paramsCapture = captures.get("function.params");
    const returnCapture = captures.get("function.return");
    const functionCapture = captures.get("function");

    const name = nameCapture?.text ?? "";
    const body = bodyCapture?.text ?? "";
    const node = functionCapture?.node ?? nameCapture?.node ??
      bodyCapture?.node;

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

    const parentCapture = captures.get("function.parent");
    functions.push({
      name,
      location: nodeToLocation(node, filePath),
      params,
      returnType,
      body,
      normalizedBody,
      bodyHash: hashCodeBody(normalizedBody),
      isAsync: transforms?.isAsync?.(node, captures) ??
        captures.has("function.async"),
      isGenerator: transforms?.isGenerator?.(node, captures) ??
        captures.has("function.generator"),
      isExported: transforms?.isExported?.(node, captures) ??
        captures.has("function.export"),
      isDefaultExport: transforms?.isDefaultExport?.(node, captures) ??
        captures.has("function.default"),
      jsDoc: docCommentFor(node, grammar, sourceCode, name),
      // A method is named for what it does to its own type, so `get` on a
      // registry is not `get` on a cache. Without this every class with a
      // `build` looked like a duplicate of every other one: the field existed
      // on `FunctionInfo` all along and nothing ever set it.
      kind: captures.has("function.method")
        ? "method" as const
        : "function" as const,
      ...(parentCapture === undefined
        ? {}
        : { parent: parentCapture.text }),
    });
  }

  return foldFunctions(functions);
}

/**
 * One declaration is one function, however many patterns matched it.
 *
 * A method inside a named class matches both the pattern that reaches it
 * through the class and the one that matches a method anywhere, so it arrived
 * twice: once knowing its owner and once not. Keyed on position, and the
 * record that knows the owner wins, since the other one is the same method
 * seen with less context.
 */
function foldFunctions(functions: readonly FunctionInfo[]): FunctionInfo[] {
  const byKey = new Map<string, FunctionInfo>();

  for (const next of functions) {
    const key = `${next.location.line}\u0000${next.location.column ?? ""}` +
      `\u0000${next.name}`;
    const seen = byKey.get(key);
    if (seen === undefined) {
      byKey.set(key, next);
      continue;
    }
    byKey.set(key, {
      ...seen,
      kind: seen.kind === "function" ? next.kind : seen.kind,
      ...(seen.parent ?? next.parent) === undefined
        ? {}
        : { parent: seen.parent ?? next.parent },
    });
  }

  return [...byKey.values()];
}

/**
 * Extract string literals from query captures.
 */
function extractStrings(
  tree: Tree,
  language: Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string,
): StringLiteral[] {
  if (!grammar.queries.strings) return [];

  const strings: StringLiteral[] = [];
  const transforms = grammar.transforms;

  for (
    const captures of runQuery(
      tree,
      language,
      grammar.queries.strings,
      sourceCode,
    )
  ) {
    const valueCapture = captures.get("string.value");
    if (!valueCapture) continue;

    const isTemplate = captures.has("string.template");
    const isRaw = captures.has("string.raw");

    const quoteStyle = transforms?.getQuoteStyle
      ? transforms.getQuoteStyle(valueCapture.node)
      : isRaw
      ? "raw" as const
      : inferQuoteStyle(valueCapture.text);

    if (inTypePosition(valueCapture.node)) continue;

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
  sourceCode: string,
): ImportInfo[] {
  if (!grammar.queries.imports) return [];

  const imports: ImportInfo[] = [];
  const transforms = grammar.transforms;

  for (
    const captures of runQuery(
      tree,
      language,
      grammar.queries.imports,
      sourceCode,
    )
  ) {
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
          })),
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

  return foldImports(imports);
}

/**
 * Extract export information from query captures.
 */
function extractExports(
  tree: Tree,
  language: Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string,
): ExportInfo[] {
  if (!grammar.queries.exports) return [];

  const exports: ExportInfo[] = [];
  const transforms = grammar.transforms;

  for (
    const captures of runQuery(
      tree,
      language,
      grammar.queries.exports,
      sourceCode,
    )
  ) {
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
          })),
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
        const aliasCapture = captures.get("export.alias");

        // A source module means this is a re-export, whatever the grammar
        // chose to call it. Deriving it here rather than making every grammar
        // remember an `@export.kind` capture is why it now happens at all: no
        // grammar in this estate emits one, so `kind` was always "unknown",
        // and `orphaned-code` tests for exactly "re-export" before counting a
        // re-export as a use. It therefore never counted one, anywhere, and
        // every layered module tree reported its whole public surface as dead.
        const kind: ExportInfo["kind"] = kindCapture
          ? kindCapture.text as ExportInfo["kind"]
          : fromCapture
          ? "re-export"
          : "unknown";

        // `export { foo as bar }` exports `bar`; `foo` is the local name. The
        // query captures the local under `name:` and the exported name under
        // `alias:`, so reading only the first got both backwards whenever an
        // export was renamed.
        exports.push({
          name: aliasCapture ? aliasCapture.text : nameCapture.text,
          ...(aliasCapture ? { localName: nameCapture.text } : {}),
          location: nodeToLocation(nameCapture.node, filePath),
          kind,
          isTypeOnly: captures.has("export.type_only"),
          from: fromCapture ? stripQuotes(fromCapture.text) : undefined,
        });
      }
    }
  }

  return foldExports(exports);
}

/**
 * One export statement is one export, however many query patterns matched it.
 *
 * A grammar's export patterns overlap by nature: `export type { T } from "./x"`
 * is a named export, a type-only export and a re-export all at once, and a
 * query written to catch each shape matches it three times. Each match then
 * became its own record, carrying whichever fields its own pattern captured,
 * so the same symbol appeared as three exports of which only one knew where it
 * came from. Anything counting exports counted three, and `orphaned-code` saw
 * both a used record and an unused one for the same name.
 *
 * Folding keeps the most specific answer for each field: a source makes it a
 * re-export, a named kind beats "unknown", and type-only holds if any match
 * said so.
 */
function foldExports(exports: readonly ExportInfo[]): ExportInfo[] {
  const byKey = new Map<string, ExportInfo>();

  for (const next of exports) {
    // Keyed on position alone, because one export specifier is one export and
    // the matches disagree about its name: the re-export pattern captures no
    // alias, so `export { a as b } from "./y"` arrives as `b` from the named
    // pattern and as `a` from the re-export one. Keying on the name kept both.
    const key = `${next.location.line}\u0000${next.location.column ?? ""}`;
    const seen = byKey.get(key);
    if (seen === undefined) {
      byKey.set(key, next);
      continue;
    }
    // A record that knows a local name is the one that saw the alias, so its
    // idea of what this export is called is the correct one.
    const named = seen.localName !== undefined
      ? seen
      : next.localName !== undefined
      ? next
      : seen;
    byKey.set(key, {
      ...seen,
      name: named.name,
      ...(named.localName === undefined ? {} : { localName: named.localName }),
      kind: seen.kind === "unknown" ? next.kind : seen.kind,
      isTypeOnly: seen.isTypeOnly || next.isTypeOnly,
      from: seen.from ?? next.from,
    });
  }

  // A source seen on any match makes the whole export a re-export, even where
  // the match that carried the source was not the one that set the kind.
  return [...byKey.values()].map((e) =>
    e.from !== undefined && e.kind === "unknown" ? { ...e, kind: "re-export" } : e
  );
}

/**
 * One import specifier is one import, however many patterns matched it.
 *
 * The same overlap as `foldExports`: a type-only named import is a named
 * import and a type-only import and an import-with-a-source all at once, and
 * a query written to catch each shape matches it three times. Anything
 * counting imports counted three.
 *
 * Keyed on name and position together, because one statement legitimately
 * carries several names at distinct positions and those are distinct imports.
 */
function foldImports(imports: readonly ImportInfo[]): ImportInfo[] {
  const byKey = new Map<string, ImportInfo>();

  for (const next of imports) {
    const key = `${next.name}\u0000${next.from}\u0000${next.location.line}` +
      `\u0000${next.location.column ?? ""}`;
    const seen = byKey.get(key);
    if (seen === undefined) {
      byKey.set(key, next);
      continue;
    }
    byKey.set(key, {
      ...seen,
      isTypeOnly: seen.isTypeOnly || next.isTypeOnly,
      isNamespace: seen.isNamespace || next.isNamespace,
    });
  }

  return [...byKey.values()];
}

/**
 * Extract type/interface information from query captures.
 */
function extractTypes(
  tree: Tree,
  language: Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string,
): TypeInfo[] {
  if (!grammar.queries.types) return [];

  const types: TypeInfo[] = [];
  const transforms = grammar.transforms;

  for (
    const captures of runQuery(
      tree,
      language,
      grammar.queries.types,
      sourceCode,
    )
  ) {
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

      jsDoc: docCommentFor(node, grammar, sourceCode),
      kind,
      isExported: transforms?.isExported?.(node, captures) ??
        captures.has("type.export"),
      isDefaultExport: transforms?.isDefaultExport?.(node, captures) ??
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
/**
 * Whether a string literal sits in a type rather than in code.
 *
 * `Pick<Target, "runtime" | "platform" | "architecture">` holds three string
 * literals that tree-sitter reports as ordinary strings, so duplicate-strings
 * counted them and advised extracting them to a constant. A `Pick` needs
 * literal types and cannot take one, so the advice could not be followed.
 *
 * A type-position literal is not a string the program ever holds. It is part
 * of a type's spelling, and deduplicating it is a different question with a
 * different answer.
 */
function inTypePosition(node: SyntaxNode | undefined): boolean {
  let at: SyntaxNode | null | undefined = node;
  while (at) {
    if (
      at.type === "type_annotation" ||
      at.type === "type_arguments" ||
      at.type === "type_alias_declaration" ||
      at.type === "literal_type" ||
      at.type === "union_type" ||
      at.type === "interface_declaration"
    ) {
      return true;
    }
    at = at.parent;
  }
  return false;
}

/**
 * Run every query a grammar declares against one parsed file.
 *
 * Each category is extracted on its own and a failure in one does not stop
 * the rest, so a grammar with a broken types query still yields its exports.
 * What comes back is everything about a file that the parse can answer;
 * the caller supplies the rest of `FileInfo`, which is filesystem facts.
 */
export function extractFileData(
  tree: Tree,
  language: Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string,
): Omit<
  FileInfo,
  "path" | "extension" | "grammarId" | "lineCount" | "content"
> {
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
  sourceCode: string,
  grammarId: string = "",
): FileInfo {
  const extracted = extractFileData(
    tree,
    language,
    grammar,
    filePath,
    sourceCode,
  );

  return {
    ...extracted,
    path: filePath,
    extension,
    grammarId,
    lineCount: sourceCode.split("\n").length,
    content: sourceCode,
  };
}

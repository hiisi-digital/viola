# Viola Language-Agnostic Implementation Plan

> Step-by-step plan for implementing the single tree-sitter core with pluggable grammar definitions.

## Overview

This document outlines the concrete implementation steps to refactor viola from a TypeScript-only regex-based linter to a language-agnostic linter runtime using tree-sitter with pluggable grammar definitions.

## Architecture Summary

```
@hiisi/viola (core)
├── web-tree-sitter engine
├── Grammar loader (lazy WASM loading)
├── Generic extraction engine (standard captures → FileInfo)
├── Linter runtime
├── Comparison primitives (atLeast, equals, oneOf, etc.)
├── Condition API (when.issue.*, when.env(), when.in())
└── Builder API (.add(), .rule())

@hiisi/viola-grammar-ts    # Queries + transforms for TypeScript/JavaScript
@hiisi/viola-grammar-bash  # Queries + transforms for Bash/Shell
```

## Phase 1: Core Tree-Sitter Integration

### 1.0 Comparison Primitives

**File: `src/conditions/comparisons.ts`**

```ts
/**
 * Comparison primitives that work with numbers, strings, and ordered enums.
 * These compose with .and() and .or() for complex conditions.
 */

export interface Comparison<T> {
  evaluate(value: T): boolean;
  and(other: Comparison<T>): Comparison<T>;
  or(other: Comparison<T>): Comparison<T>;
}

class BaseComparison<T> implements Comparison<T> {
  constructor(private predicate: (value: T) => boolean) {}
  
  evaluate(value: T): boolean {
    return this.predicate(value);
  }
  
  and(other: Comparison<T>): Comparison<T> {
    return new BaseComparison((v) => this.evaluate(v) && other.evaluate(v));
  }
  
  or(other: Comparison<T>): Comparison<T> {
    return new BaseComparison((v) => this.evaluate(v) || other.evaluate(v));
  }
}

/** Exact equality */
export function equals<T>(expected: T): Comparison<T> {
  return new BaseComparison((v) => v === expected);
}

/** Greater than or equal (works with numbers and ordered enums) */
export function atLeast<T>(minimum: T): Comparison<T> {
  return new BaseComparison((v) => v >= minimum);
}

/** Less than or equal */
export function atMost<T>(maximum: T): Comparison<T> {
  return new BaseComparison((v) => v <= maximum);
}

/** Strictly less than */
export function lessThan<T>(bound: T): Comparison<T> {
  return new BaseComparison((v) => v < bound);
}

/** Strictly greater than */
export function moreThan<T>(bound: T): Comparison<T> {
  return new BaseComparison((v) => v > bound);
}

/** Inclusive range */
export function between<T>(min: T, max: T): Comparison<T> {
  return atLeast(min).and(atMost(max));
}

/** Match any of the given values */
export function oneOf<T>(...values: T[]): Comparison<T> {
  return new BaseComparison((v) => values.includes(v));
}
```

### 1.1 Add Dependencies

**File: `deno.json`**

```json
{
  "imports": {
    "web-tree-sitter": "npm:web-tree-sitter@0.22.6"
  }
}
```

### 1.2 Create Grammar Types

**File: `src/grammars/types.ts`**

```ts
import type { FunctionParam, TypeField, ImportInfo, ExportInfo } from "../data/types.ts";

/**
 * Metadata about a grammar.
 */
export interface GrammarMeta {
  id: string;
  name: string;
  extensions: readonly string[];
  globs?: readonly string[];
  description?: string;
}

/**
 * Reference to a tree-sitter grammar WASM file.
 */
export interface GrammarSource {
  source: "npm" | "url" | "bundled";
  package?: string;
  wasm?: string;
  url?: string;
}

/**
 * Tree-sitter queries for extracting code elements.
 */
export interface ExtractionQueries {
  functions: string;
  strings?: string;
  imports?: string;
  exports?: string;
  types?: string;
  docComments?: string;
}

/**
 * Query captures from a tree-sitter query match.
 */
export interface QueryCaptures {
  get(name: string): { node: SyntaxNode; text: string } | undefined;
  has(name: string): boolean;
  all(): Map<string, { node: SyntaxNode; text: string }>;
}

/**
 * A tree-sitter syntax node (simplified interface).
 */
export interface SyntaxNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  parent: SyntaxNode | null;
  children: SyntaxNode[];
  childForFieldName(name: string): SyntaxNode | null;
  namedChildren: SyntaxNode[];
}

/**
 * Optional transform callbacks for language-specific extraction.
 */
export interface GrammarTransforms {
  parseParams?: (paramsNode: SyntaxNode | undefined, source: string) => FunctionParam[];
  extractReturnType?: (node: SyntaxNode, captures: QueryCaptures) => string | undefined;
  normalizeBody?: (body: string, language: string) => string;
  isAsync?: (node: SyntaxNode, captures: QueryCaptures) => boolean;
  isGenerator?: (node: SyntaxNode, captures: QueryCaptures) => boolean;
  isExported?: (node: SyntaxNode, captures: QueryCaptures) => boolean;
  isDefaultExport?: (node: SyntaxNode, captures: QueryCaptures) => boolean;
  parseImport?: (node: SyntaxNode, captures: QueryCaptures, source: string) => ImportInfo | ImportInfo[];
  parseExport?: (node: SyntaxNode, captures: QueryCaptures, source: string) => ExportInfo | ExportInfo[];
  parseTypeFields?: (bodyNode: SyntaxNode | undefined, source: string) => TypeField[];
  parseDocComment?: (node: SyntaxNode, source: string) => string;
  getQuoteStyle?: (node: SyntaxNode) => "single" | "double" | "backtick" | "raw";
}

/**
 * A grammar definition provides everything needed to extract
 * structured data from files of a particular language.
 */
export interface GrammarDefinition {
  readonly meta: GrammarMeta;
  readonly grammar: GrammarSource;
  readonly queries: ExtractionQueries;
  readonly transforms?: GrammarTransforms;
}
```

### 1.3 Create Grammar Loader

**File: `src/grammars/loader.ts`**

```ts
import Parser from "web-tree-sitter";

let initialized = false;
const loadedLanguages = new Map<string, Parser.Language>();

/**
 * Initialize the tree-sitter WASM runtime.
 */
export async function initTreeSitter(): Promise<void> {
  if (initialized) return;
  await Parser.init();
  initialized = true;
}

/**
 * Load a grammar's WASM and return the Language object.
 */
export async function loadGrammar(grammar: GrammarSource): Promise<Parser.Language> {
  const key = grammarKey(grammar);
  
  const cached = loadedLanguages.get(key);
  if (cached) return cached;
  
  await initTreeSitter();
  
  let wasmPath: string;
  
  if (grammar.source === "npm") {
    // Resolve from node_modules or npm cache
    const pkg = grammar.package ?? "";
    const wasm = grammar.wasm ?? `${pkg}.wasm`;
    wasmPath = await resolveNpmWasm(pkg, wasm);
  } else if (grammar.source === "url") {
    wasmPath = grammar.url!;
  } else {
    // Bundled - path relative to viola package
    wasmPath = new URL(`../wasm/${grammar.wasm}`, import.meta.url).pathname;
  }
  
  const language = await Parser.Language.load(wasmPath);
  loadedLanguages.set(key, language);
  
  return language;
}

/**
 * Create a parser instance with the given language.
 */
export function createParser(language: Parser.Language): Parser {
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

function grammarKey(grammar: GrammarSource): string {
  if (grammar.source === "npm") return `npm:${grammar.package}`;
  if (grammar.source === "url") return `url:${grammar.url}`;
  return `bundled:${grammar.wasm}`;
}

async function resolveNpmWasm(pkg: string, wasm: string): Promise<string> {
  // In Deno, we can use import.meta.resolve or lookup in cache
  // This is a simplified version - real implementation needs more work
  const resolved = import.meta.resolve(`${pkg}/${wasm}`);
  return resolved.replace("file://", "");
}
```

### 1.4 Create Query Executor

**File: `src/grammars/query.ts`**

```ts
import type Parser from "web-tree-sitter";
import type { QueryCaptures, SyntaxNode } from "./types.ts";

/**
 * Run a tree-sitter query and yield matches with their captures.
 */
export function* runQuery(
  tree: Parser.Tree,
  language: Parser.Language,
  querySource: string,
  sourceCode: string
): Generator<QueryCaptures> {
  const query = language.query(querySource);
  const matches = query.matches(tree.rootNode);
  
  for (const match of matches) {
    const captures = new Map<string, { node: SyntaxNode; text: string }>();
    
    for (const capture of match.captures) {
      const text = sourceCode.slice(capture.node.startIndex, capture.node.endIndex);
      captures.set(capture.name, {
        node: capture.node as unknown as SyntaxNode,
        text,
      });
    }
    
    yield {
      get: (name) => captures.get(name),
      has: (name) => captures.has(name),
      all: () => captures,
    };
  }
}
```

### 1.5 Create Generic Extraction Engine

**File: `src/grammars/extractor.ts`**

```ts
import type Parser from "web-tree-sitter";
import type { FileInfo, FunctionInfo, StringLiteral, ImportInfo, ExportInfo, TypeInfo, SourceLocation } from "../data/types.ts";
import type { GrammarDefinition, QueryCaptures, SyntaxNode } from "./types.ts";
import { runQuery } from "./query.ts";
import { hashCodeBody } from "../utils/hash.ts";
import { normalizeCode } from "../utils/similarity.ts";

/**
 * Extract all data from a parsed file using the grammar's queries.
 */
export function extractFileData(
  tree: Parser.Tree,
  language: Parser.Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string
): Omit<FileInfo, "path" | "extension" | "lineCount"> {
  const functions = extractFunctions(tree, language, grammar, filePath, sourceCode);
  const strings = grammar.queries.strings
    ? extractStrings(tree, language, grammar, filePath, sourceCode)
    : [];
  const imports = grammar.queries.imports
    ? extractImports(tree, language, grammar, filePath, sourceCode)
    : [];
  const exports = grammar.queries.exports
    ? extractExports(tree, language, grammar, filePath, sourceCode)
    : [];
  const types = grammar.queries.types
    ? extractTypes(tree, language, grammar, filePath, sourceCode)
    : [];
  
  return { functions, strings, imports, exports, types };
}

function extractFunctions(
  tree: Parser.Tree,
  language: Parser.Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string
): FunctionInfo[] {
  const functions: FunctionInfo[] = [];
  const transforms = grammar.transforms;
  
  for (const captures of runQuery(tree, language, grammar.queries.functions, sourceCode)) {
    const nameCapture = captures.get("function.name");
    const bodyCapture = captures.get("function.body");
    const paramsCapture = captures.get("function.params");
    const returnCapture = captures.get("function.return");
    const functionCapture = captures.get("function");
    
    const name = nameCapture?.text ?? "";
    const body = bodyCapture?.text ?? "";
    const node = functionCapture?.node ?? nameCapture?.node ?? bodyCapture?.node;
    
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
      : normalizeCode(body);
    
    functions.push({
      name,
      location: nodeToLocation(node, filePath),
      params,
      returnType,
      body,
      normalizedBody,
      bodyHash: hashCodeBody(normalizedBody),
      isAsync: transforms?.isAsync?.(node, captures) ?? false,
      isGenerator: transforms?.isGenerator?.(node, captures) ?? false,
      isExported: transforms?.isExported?.(node, captures) ?? false,
      isDefaultExport: transforms?.isDefaultExport?.(node, captures) ?? false,
      kind: "function",
    });
  }
  
  return functions;
}

function extractStrings(
  tree: Parser.Tree,
  language: Parser.Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string
): StringLiteral[] {
  const strings: StringLiteral[] = [];
  const transforms = grammar.transforms;
  
  for (const captures of runQuery(tree, language, grammar.queries.strings!, sourceCode)) {
    const valueCapture = captures.get("string.value");
    if (!valueCapture) continue;
    
    const isTemplate = captures.has("string.template");
    const isRaw = captures.has("string.raw");
    
    const quoteStyle = transforms?.getQuoteStyle
      ? transforms.getQuoteStyle(valueCapture.node)
      : inferQuoteStyle(valueCapture.text);
    
    strings.push({
      value: stripQuotes(valueCapture.text),
      location: nodeToLocation(valueCapture.node, filePath),
      quoteStyle,
      isTemplate,
    });
  }
  
  return strings;
}

function extractImports(
  tree: Parser.Tree,
  language: Parser.Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string
): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const transforms = grammar.transforms;
  
  for (const captures of runQuery(tree, language, grammar.queries.imports!, sourceCode)) {
    if (transforms?.parseImport) {
      const result = transforms.parseImport(
        captures.get("import")?.node ?? captures.all().values().next().value?.node,
        captures,
        sourceCode
      );
      if (Array.isArray(result)) {
        imports.push(...result);
      } else {
        imports.push(result);
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

function extractExports(
  tree: Parser.Tree,
  language: Parser.Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string
): ExportInfo[] {
  const exports: ExportInfo[] = [];
  const transforms = grammar.transforms;
  
  for (const captures of runQuery(tree, language, grammar.queries.exports!, sourceCode)) {
    if (transforms?.parseExport) {
      const result = transforms.parseExport(
        captures.get("export")?.node ?? captures.all().values().next().value?.node,
        captures,
        sourceCode
      );
      if (Array.isArray(result)) {
        exports.push(...result);
      } else {
        exports.push(result);
      }
    } else {
      const nameCapture = captures.get("export.name");
      
      if (nameCapture) {
        exports.push({
          name: nameCapture.text,
          location: nodeToLocation(nameCapture.node, filePath),
          kind: (captures.get("export.kind")?.text as ExportInfo["kind"]) ?? "unknown",
          isTypeOnly: captures.has("export.type_only"),
          from: captures.get("export.from")?.text,
        });
      }
    }
  }
  
  return exports;
}

function extractTypes(
  tree: Parser.Tree,
  language: Parser.Language,
  grammar: GrammarDefinition,
  filePath: string,
  sourceCode: string
): TypeInfo[] {
  const types: TypeInfo[] = [];
  const transforms = grammar.transforms;
  
  for (const captures of runQuery(tree, language, grammar.queries.types!, sourceCode)) {
    const nameCapture = captures.get("type.name");
    const bodyCapture = captures.get("type.body");
    const typeCapture = captures.get("type");
    
    if (!nameCapture) continue;
    
    const body = bodyCapture?.text ?? "";
    const node = typeCapture?.node ?? nameCapture.node;
    
    const fields = transforms?.parseTypeFields
      ? transforms.parseTypeFields(bodyCapture?.node, sourceCode)
      : [];
    
    const normalizedBody = transforms?.normalizeBody
      ? transforms.normalizeBody(body, grammar.meta.id)
      : normalizeCode(body);
    
    types.push({
      name: nameCapture.text,
      location: nodeToLocation(node, filePath),
      kind: (captures.get("type.kind")?.text as "type" | "interface") ?? "type",
      isExported: transforms?.isExported?.(node, captures) ?? false,
      isDefaultExport: transforms?.isDefaultExport?.(node, captures) ?? false,
      fields,
      body,
      normalizedBody,
      bodyHash: hashCodeBody(normalizedBody),
    });
  }
  
  return types;
}

// Helper functions

function nodeToLocation(node: SyntaxNode, file: string): SourceLocation {
  return {
    file,
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
  };
}

function defaultParseParams(paramsText: string | undefined): FunctionParam[] {
  if (!paramsText) return [];
  // Simple param extraction - just split by comma
  // Grammars with complex params should provide a transform
  const inner = paramsText.replace(/^\(|\)$/g, "").trim();
  if (!inner) return [];
  
  return inner.split(",").map(p => ({
    name: p.trim().split(/[:\s=]/)[0].replace(/^\.\.\./, ""),
    optional: p.includes("?"),
    rest: p.trim().startsWith("..."),
  }));
}

function inferQuoteStyle(text: string): "single" | "double" | "backtick" {
  if (text.startsWith("`")) return "backtick";
  if (text.startsWith("'")) return "single";
  return "double";
}

function stripQuotes(text: string): string {
  return text.replace(/^["'`]|["'`]$/g, "");
}
```

### 1.6 Create Module Export

**File: `src/grammars/mod.ts`**

```ts
export type {
  GrammarMeta,
  GrammarSource,
  ExtractionQueries,
  GrammarTransforms,
  GrammarDefinition,
  QueryCaptures,
  SyntaxNode,
} from "./types.ts";

export { initTreeSitter, loadGrammar, createParser } from "./loader.ts";
export { runQuery } from "./query.ts";
export { extractFileData } from "./extractor.ts";
```

## Phase 2: Condition API (`when.*`)

### 2.1 Condition Types

**File: `src/conditions/types.ts`**

```ts
import type { Comparison } from "./comparisons.ts";

/**
 * A condition that can be evaluated at runtime.
 */
export interface Condition {
  evaluate(context: EvaluationContext): boolean;
  and(other: Condition): Condition;
}

/**
 * Context available when evaluating conditions.
 */
export interface EvaluationContext {
  file?: {
    path: string;
  };
  issue?: {
    by: string;        // linter/grammar id
    kind: string;
    impact: number;    // or enum value
    confidence: number;
  };
  env: Record<string, string | undefined>;
}
```

### 2.2 When API Implementation

**File: `src/conditions/when.ts`**

```ts
import type { Condition, EvaluationContext } from "./types.ts";
import type { Comparison } from "./comparisons.ts";
import { minimatch } from "minimatch";

class BaseCondition implements Condition {
  constructor(private predicate: (ctx: EvaluationContext) => boolean) {}
  
  evaluate(context: EvaluationContext): boolean {
    return this.predicate(context);
  }
  
  and(other: Condition): Condition {
    return new BaseCondition((ctx) => this.evaluate(ctx) && other.evaluate(ctx));
  }
}

/**
 * Path pattern matching.
 * 
 * @example
 * when.in("*.ts", "*.tsx")
 * when.in("**/test/**")
 */
function inPatterns(...patterns: string[]): Condition {
  return new BaseCondition((ctx) => {
    if (!ctx.file) return false;
    return patterns.some(p => minimatch(ctx.file!.path, p));
  });
}

/**
 * Issue properties namespace.
 */
const issue = {
  /**
   * Match issues by their source (linter or grammar).
   * 
   * @example
   * when.issue.by(similarFunctions)
   */
  by(source: { id: string } | string): Condition {
    const id = typeof source === "string" ? source : source.id;
    return new BaseCondition((ctx) => ctx.issue?.by === id);
  },
  
  /**
   * Match issues by kind.
   * 
   * @example
   * when.issue.kind("duplicate")
   */
  kind(issueKind: string): Condition {
    return new BaseCondition((ctx) => ctx.issue?.kind === issueKind);
  },
  
  /**
   * Match issues by impact level.
   * 
   * @example
   * when.issue.impact(atLeast(Impact.Major))
   */
  impact(comparison: Comparison<number>): Condition {
    return new BaseCondition((ctx) => {
      if (ctx.issue?.impact === undefined) return false;
      return comparison.evaluate(ctx.issue.impact);
    });
  },
  
  /**
   * Match issues by confidence level.
   * 
   * @example
   * when.issue.confidence(atLeast(80))
   */
  confidence(comparison: Comparison<number>): Condition {
    return new BaseCondition((ctx) => {
      if (ctx.issue?.confidence === undefined) return false;
      return comparison.evaluate(ctx.issue.confidence);
    });
  },
};

/**
 * Environment variable matching.
 * 
 * @example
 * when.env("CI").exists()
 * when.env("NODE_ENV").is(equals("production"))
 * when.env("TIMEOUT").is(atLeast(30))
 */
function env(varName: string) {
  return {
    exists(): Condition {
      return new BaseCondition((ctx) => ctx.env[varName] !== undefined);
    },
    
    is(comparison: Comparison<string | number>): Condition {
      return new BaseCondition((ctx) => {
        const value = ctx.env[varName];
        if (value === undefined) return false;
        // Try numeric comparison first
        const numValue = Number(value);
        if (!isNaN(numValue)) {
          return (comparison as Comparison<number>).evaluate(numValue);
        }
        return (comparison as Comparison<string>).evaluate(value);
      });
    },
  };
}

/**
 * The `when` condition builder.
 * 
 * @example
 * when.in("*.ts", "*.tsx")
 * when.issue.by(similarFunctions)
 * when.issue.impact(atLeast(Impact.Major))
 * when.env("CI").exists()
 * when.env("NODE_ENV").is(equals("production"))
 */
export const when = {
  in: inPatterns,
  issue,
  env,
};
```

### 2.3 Export Conditions Module

**File: `src/conditions/mod.ts`**

```ts
export type { Condition, EvaluationContext } from "./types.ts";
export type { Comparison } from "./comparisons.ts";
export { equals, atLeast, atMost, lessThan, moreThan, between, oneOf } from "./comparisons.ts";
export { when } from "./when.ts";
```

## Phase 3: Update Builder and Runtime

### 3.1 Update Builder

**File: `src/config/builder.ts`** (rewrite)

```ts
import type { GrammarDefinition } from "../grammars/types.ts";
import type { BaseLinter } from "../linters/base.ts";
import type { Condition } from "../conditions/types.ts";

// Sentinel types for .add()
export const grammar = Symbol("grammar");
export const linter = Symbol("linter");
export type GrammarKind = typeof grammar;
export type LinterKind = typeof linter;

// Report actions
export const report = {
  error: { level: "error" } as const,
  warn: { level: "warn" } as const,
  off: { level: "off" } as const,
  info: { level: "info" } as const,
};
export type ReportAction = typeof report[keyof typeof report];

// Grammar relationship actions
export function grammarRef(g: GrammarDefinition | string) {
  const id = typeof g === "string" ? g : g.meta.id;
  return {
    overrides(other: GrammarDefinition | string) {
      const otherId = typeof other === "string" ? other : other.meta.id;
      return { type: "grammar-overrides" as const, primary: id, secondary: otherId };
    },
    supplements(other: GrammarDefinition | string) {
      const otherId = typeof other === "string" ? other : other.meta.id;
      return { type: "grammar-supplements" as const, primary: id, secondary: otherId };
    },
  };
}

export type GrammarAction = ReturnType<ReturnType<typeof grammarRef>["overrides" | "supplements"]>;
export type RuleAction = ReportAction | GrammarAction;

interface RegisteredGrammar {
  definition: GrammarDefinition;
  alias?: string;
}

interface RegisteredLinter {
  linter: BaseLinter;
  alias?: string;
}

interface Rule {
  action: RuleAction;
  condition: Condition;
}

interface AddResult<T> {
  as(alias: string): ViolaBuilder;
}

class ViolaBuilder {
  private _grammars: RegisteredGrammar[] = [];
  private _linters: RegisteredLinter[] = [];
  private _rules: Rule[] = [];

  /**
   * Add a grammar or linter.
   * 
   * @example
   * .add(grammar, typescript).as(ts)
   * .add(linter, similarFunctions)
   */
  add(kind: GrammarKind, definition: GrammarDefinition): AddResult<GrammarDefinition>;
  add(kind: LinterKind, linterDef: BaseLinter): AddResult<BaseLinter>;
  add(kind: GrammarKind | LinterKind, thing: GrammarDefinition | BaseLinter): AddResult<unknown> {
    const self = this;
    
    if (kind === grammar) {
      const entry: RegisteredGrammar = { definition: thing as GrammarDefinition };
      this._grammars.push(entry);
      return {
        as(alias: string) {
          entry.alias = alias;
          return self;
        },
      };
    } else {
      const entry: RegisteredLinter = { linter: thing as BaseLinter };
      this._linters.push(entry);
      return {
        as(alias: string) {
          entry.alias = alias;
          return self;
        },
      };
    }
  }

  /**
   * Define a rule.
   * 
   * @example
   * .rule(report.error, when.issue.impact(atLeast(Impact.Major)))
   * .rule(grammar(ts).overrides(js), when.in("*.js"))
   */
  rule(action: RuleAction, condition: Condition): this {
    this._rules.push({ action, condition });
    return this;
  }

  build(): ViolaBuilderConfig {
    return {
      grammars: this._grammars,
      linters: this._linters,
      rules: this._rules,
    };
  }
}

export interface ViolaBuilderConfig {
  grammars: RegisteredGrammar[];
  linters: RegisteredLinter[];
  rules: Rule[];
}

/**
 * Create a new viola configuration builder.
 * 
 * @example
 * viola()
 *   .add(grammar, typescript).as(ts)
 *   .add(linter, similarFunctions)
 *   .rule(report.error, when.issue.impact(atLeast(Impact.Major)))
 */
export function viola(): ViolaBuilder {
  return new ViolaBuilder();
}
```

### 3.2 Update Runtime Crawler

**File: `src/runtime/crawler.ts`** (rewrite)

```ts
import { walk } from "@std/fs/walk";
import { basename, extname, join, relative } from "@std/path";
import { minimatch } from "minimatch";
import type { CodebaseData, FileInfo } from "../data/types.ts";
import type { GrammarDefinition } from "../grammars/types.ts";
import { loadGrammar, createParser, extractFileData, initTreeSitter } from "../grammars/mod.ts";

export interface CrawlConfig {
  projectRoot: string;
  include: readonly string[];
  exclude: readonly RegExp[];
  grammars: readonly GrammarDefinition[];
}

/**
 * Single-pass crawl of the codebase.
 * Parses each file once and dispatches to matching grammars.
 */
export async function crawlCodebase(config: CrawlConfig): Promise<CodebaseData> {
  await initTreeSitter();
  
  const files: FileInfo[] = [];
  const grammarCache = new Map<string, { language: any; parser: any }>();
  
  for (const includeDir of config.include) {
    const fullPath = join(config.projectRoot, includeDir);
    
    for await (const entry of walk(fullPath, { includeDirs: false })) {
      const relativePath = relative(config.projectRoot, entry.path);
      
      // Check exclusions
      if (config.exclude.some(pattern => pattern.test(relativePath))) {
        continue;
      }
      
      // Find matching grammar
      const grammar = findMatchingGrammar(entry.path, config.grammars);
      if (!grammar) continue;
      
      // Load grammar if not cached
      let cached = grammarCache.get(grammar.meta.id);
      if (!cached) {
        const language = await loadGrammar(grammar.grammar);
        const parser = createParser(language);
        cached = { language, parser };
        grammarCache.set(grammar.meta.id, cached);
      }
      
      // Read and parse file
      const content = await Deno.readTextFile(entry.path);
      const tree = cached.parser.parse(content);
      
      // Extract data
      const extracted = extractFileData(
        tree,
        cached.language,
        grammar,
        relativePath,
        content
      );
      
      files.push({
        path: relativePath,
        extension: extname(entry.path),
        lineCount: content.split("\n").length,
        content,
        ...extracted,
      });
    }
  }
  
  return buildCodebaseData(config.projectRoot, files);
}

function findMatchingGrammar(
  filePath: string,
  grammars: readonly GrammarDefinition[]
): GrammarDefinition | undefined {
  const ext = extname(filePath);
  const name = basename(filePath);
  
  // First registered grammar wins (priority order)
  for (const grammar of grammars) {
    // Check extension
    if (grammar.meta.extensions.includes(ext)) {
      return grammar;
    }
    
    // Check globs
    if (grammar.meta.globs) {
      for (const glob of grammar.meta.globs) {
        if (minimatch(name, glob) || minimatch(filePath, glob)) {
          return grammar;
        }
      }
    }
  }
  
  return undefined;
}

function buildCodebaseData(
  projectRoot: string,
  files: readonly FileInfo[]
): CodebaseData {
  return Object.freeze({
    projectRoot,
    files,
    schemas: [], // Schema extraction could be a separate grammar
    extractedAt: Date.now(),
    allFunctions: files.flatMap(f => f.functions),
    allTypes: files.flatMap(f => f.types),
    allStrings: files.flatMap(f => f.strings),
    allExports: files.flatMap(f => f.exports),
    allImports: files.flatMap(f => f.imports),
  });
}
```

## Phase 4: TypeScript Grammar Package

### 3.1 Package Structure

```
packages/viola-grammar-ts/
├── deno.json
├── mod.ts
├── src/
│   ├── queries.ts      # Tree-sitter queries
│   └── transforms.ts   # Transform functions
└── README.md
```

### 3.2 Package Config

**File: `packages/viola-grammar-ts/deno.json`**

```json
{
  "name": "@hiisi/viola-grammar-ts",
  "version": "0.1.0",
  "exports": "./mod.ts",
  "imports": {
    "@hiisi/viola": "jsr:@hiisi/viola"
  }
}
```

### 3.3 Queries

**File: `packages/viola-grammar-ts/src/queries.ts`**

```ts
export const functionQuery = `
; Regular function declarations
(function_declaration
  name: (identifier) @function.name
  parameters: (formal_parameters) @function.params
  return_type: (type_annotation type: (_) @function.return)?
  body: (statement_block) @function.body) @function

; Async function declarations
(function_declaration
  "async" @function.async
  name: (identifier) @function.name
  parameters: (formal_parameters) @function.params
  body: (statement_block) @function.body) @function

; Generator functions
(generator_function_declaration
  name: (identifier) @function.name
  parameters: (formal_parameters) @function.params
  body: (statement_block) @function.body) @function

; Arrow functions assigned to const/let
(lexical_declaration
  (variable_declarator
    name: (identifier) @function.name
    value: (arrow_function
      parameters: (formal_parameters) @function.params
      return_type: (type_annotation type: (_) @function.return)?
      body: (_) @function.body))) @function

; Method definitions in classes
(method_definition
  name: (property_identifier) @function.name
  parameters: (formal_parameters) @function.params
  return_type: (type_annotation type: (_) @function.return)?
  body: (statement_block) @function.body) @function

; Exported functions
(export_statement
  (function_declaration
    name: (identifier) @function.name
    parameters: (formal_parameters) @function.params
    body: (statement_block) @function.body) @function) @function.export
`;

export const stringQuery = `
(string) @string.value
(template_string) @string.value @string.template
`;

export const importQuery = `
; Default imports
(import_statement
  (import_clause
    (identifier) @import.name)
  source: (string) @import.from)

; Named imports
(import_statement
  (import_clause
    (named_imports
      (import_specifier
        name: (identifier) @import.name
        alias: (identifier)? @import.alias)))
  source: (string) @import.from)

; Namespace imports
(import_statement
  (import_clause
    (namespace_import
      (identifier) @import.name @import.namespace))
  source: (string) @import.from)

; Type imports
(import_statement
  "type" @import.type_only
  source: (string) @import.from)
`;

export const exportQuery = `
; Named exports
(export_statement
  (identifier) @export.name)

; Exported declarations
(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @export.name)))

(export_statement
  declaration: (function_declaration
    name: (identifier) @export.name))

; Default exports
(export_statement
  "default" @export.default
  (identifier) @export.name)

; Re-exports
(export_statement
  (export_clause
    (export_specifier
      name: (identifier) @export.name))
  source: (string)? @export.from)
`;

export const typeQuery = `
; Interface declarations
(interface_declaration
  name: (type_identifier) @type.name
  body: (object_type) @type.body) @type

; Type alias declarations
(type_alias_declaration
  name: (type_identifier) @type.name
  value: (_) @type.body) @type
`;

export const docCommentQuery = `
(comment) @doc.content
(#match? @doc.content "^/\\\\*\\\\*")
`;
```

### 3.4 Transforms

**File: `packages/viola-grammar-ts/src/transforms.ts`**

```ts
import type { FunctionParam, TypeField, ImportInfo, ExportInfo } from "@hiisi/viola";
import type { SyntaxNode, QueryCaptures } from "@hiisi/viola";

/**
 * Parse TypeScript function parameters.
 * Handles: destructuring, default values, rest params, type annotations.
 */
export function parseParams(paramsNode: SyntaxNode | undefined, source: string): FunctionParam[] {
  if (!paramsNode) return [];
  
  const params: FunctionParam[] = [];
  
  for (const child of paramsNode.namedChildren) {
    if (child.type === "required_parameter" || child.type === "optional_parameter") {
      const pattern = child.childForFieldName("pattern");
      const type = child.childForFieldName("type");
      const value = child.childForFieldName("value");
      
      params.push({
        name: pattern?.text ?? "",
        type: type?.text,
        optional: child.type === "optional_parameter",
        rest: false,
        defaultValue: value?.text,
      });
    } else if (child.type === "rest_pattern") {
      const name = child.namedChildren[0];
      params.push({
        name: name?.text ?? "",
        optional: false,
        rest: true,
      });
    }
  }
  
  return params;
}

/**
 * Parse TypeScript interface/type fields.
 */
export function parseTypeFields(bodyNode: SyntaxNode | undefined, source: string): TypeField[] {
  if (!bodyNode) return [];
  
  const fields: TypeField[] = [];
  
  for (const child of bodyNode.namedChildren) {
    if (child.type === "property_signature") {
      const name = child.childForFieldName("name");
      const type = child.childForFieldName("type");
      const optional = child.children.some(c => c.type === "?");
      const readonly = child.children.some(c => c.type === "readonly");
      
      if (name) {
        fields.push({
          name: name.text,
          type: type?.text ?? "unknown",
          optional,
          readonly,
        });
      }
    }
  }
  
  return fields;
}

/**
 * Check if a function is async.
 */
export function isAsync(node: SyntaxNode, captures: QueryCaptures): boolean {
  return captures.has("function.async") || 
         node.children.some(c => c.type === "async");
}

/**
 * Check if something is exported.
 */
export function isExported(node: SyntaxNode, captures: QueryCaptures): boolean {
  if (captures.has("function.export")) return true;
  
  // Check parent for export_statement
  let current: SyntaxNode | null = node;
  while (current) {
    if (current.type === "export_statement") return true;
    current = current.parent;
  }
  return false;
}

/**
 * Check if it's a default export.
 */
export function isDefaultExport(node: SyntaxNode, captures: QueryCaptures): boolean {
  let current: SyntaxNode | null = node;
  while (current) {
    if (current.type === "export_statement") {
      return current.children.some(c => c.type === "default");
    }
    current = current.parent;
  }
  return false;
}

/**
 * Parse doc comments (JSDoc).
 */
export function parseDocComment(node: SyntaxNode, source: string): string {
  const text = node.text;
  // Strip /** and */ and leading *
  return text
    .replace(/^\/\*\*\s*/, "")
    .replace(/\s*\*\/$/, "")
    .split("\n")
    .map(line => line.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim();
}

/**
 * Get quote style from string node.
 */
export function getQuoteStyle(node: SyntaxNode): "single" | "double" | "backtick" {
  const text = node.text;
  if (text.startsWith("`")) return "backtick";
  if (text.startsWith("'")) return "single";
  return "double";
}
```

### 3.5 Module Export

**File: `packages/viola-grammar-ts/mod.ts`**

```ts
import type { GrammarDefinition } from "@hiisi/viola";
import {
  functionQuery,
  stringQuery,
  importQuery,
  exportQuery,
  typeQuery,
  docCommentQuery,
} from "./src/queries.ts";
import {
  parseParams,
  parseTypeFields,
  isAsync,
  isExported,
  isDefaultExport,
  parseDocComment,
  getQuoteStyle,
} from "./src/transforms.ts";

export const typescript: GrammarDefinition = {
  meta: {
    id: "typescript",
    name: "TypeScript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    description: "TypeScript and TSX files using tree-sitter-typescript",
  },
  
  grammar: {
    source: "npm",
    package: "tree-sitter-typescript",
    wasm: "tree-sitter-typescript.wasm",
  },
  
  queries: {
    functions: functionQuery,
    strings: stringQuery,
    imports: importQuery,
    exports: exportQuery,
    types: typeQuery,
    docComments: docCommentQuery,
  },
  
  transforms: {
    parseParams,
    parseTypeFields,
    isAsync,
    isExported,
    isDefaultExport,
    parseDocComment,
    getQuoteStyle,
  },
};

export const javascript: GrammarDefinition = {
  meta: {
    id: "javascript",
    name: "JavaScript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    description: "JavaScript and JSX files using tree-sitter-javascript",
  },
  
  grammar: {
    source: "npm",
    package: "tree-sitter-javascript",
    wasm: "tree-sitter-javascript.wasm",
  },
  
  queries: {
    functions: functionQuery,
    strings: stringQuery,
    imports: importQuery,
    exports: exportQuery,
    // No types query for plain JS
    docComments: docCommentQuery,
  },
  
  transforms: {
    parseParams,
    isAsync,
    isExported,
    isDefaultExport,
    parseDocComment,
    getQuoteStyle,
  },
};

export default typescript;
```

## Phase 5: Bash Grammar Package

### 4.1 Package Structure

```
packages/viola-grammar-bash/
├── deno.json
├── mod.ts
├── src/
│   ├── queries.ts
│   └── transforms.ts
└── README.md
```

### 4.2 Queries

**File: `packages/viola-grammar-bash/src/queries.ts`**

```ts
export const functionQuery = `
; function name() { body }
(function_definition
  name: (word) @function.name
  body: (compound_statement) @function.body) @function
`;

export const stringQuery = `
; Double-quoted strings
(string) @string.value

; Single-quoted strings (raw)
(raw_string) @string.value @string.raw

; ANSI-C strings ($'...')
(ansii_c_string) @string.value
`;

export const importQuery = `
; source "file.sh"
(command
  name: (command_name (word) @_cmd)
  argument: (word) @import.from
  (#eq? @_cmd "source"))

; source "file.sh" (with string)
(command
  name: (command_name (word) @_cmd)
  argument: (string) @import.from
  (#eq? @_cmd "source"))

; . "file.sh"
(command
  name: (command_name (word) @_cmd)
  argument: (word) @import.from
  (#eq? @_cmd "."))

; . "file.sh" (with string)
(command
  name: (command_name (word) @_cmd)
  argument: (string) @import.from
  (#eq? @_cmd "."))
`;

export const exportQuery = `
; export VAR=value
(declaration_command
  (variable_assignment
    name: (variable_name) @export.name))

; export -f function_name
(command
  name: (command_name (word) @_cmd)
  argument: (word) @_flag
  argument: (word) @export.name
  (#eq? @_cmd "export")
  (#eq? @_flag "-f"))

; readonly VAR=value
(declaration_command
  "readonly"
  (variable_assignment
    name: (variable_name) @export.name))
`;

export const docCommentQuery = `
; Comments (we'll filter for those before functions in transform)
(comment) @doc.content
`;
```

### 4.3 Transforms

**File: `packages/viola-grammar-bash/src/transforms.ts`**

```ts
import type { FunctionParam, ImportInfo, ExportInfo } from "@hiisi/viola";
import type { SyntaxNode, QueryCaptures } from "@hiisi/viola";

/**
 * Extract positional parameters used in a bash function body.
 * Scans for $1, $2, ${1}, ${2}, $@, $*, $#
 */
export function parseParams(paramsNode: SyntaxNode | undefined, source: string): FunctionParam[] {
  // In bash, paramsNode is actually the function body - we scan for usage
  if (!paramsNode) return [];
  
  const body = paramsNode.text;
  const params: FunctionParam[] = [];
  const seen = new Set<string>();
  
  // Match positional parameters: $1, ${1}, $2, ${2}, etc.
  const positionalRegex = /\$\{?(\d+)\}?/g;
  let match;
  while ((match = positionalRegex.exec(body)) !== null) {
    const num = match[1];
    if (!seen.has(num)) {
      seen.add(num);
      params.push({
        name: `$${num}`,
        optional: false,
        rest: false,
      });
    }
  }
  
  // Sort by parameter number
  params.sort((a, b) => {
    const numA = parseInt(a.name.slice(1));
    const numB = parseInt(b.name.slice(1));
    return numA - numB;
  });
  
  // Check for $@ or $* (rest-like)
  if (/\$[@*]|\$\{[@*]\}/.test(body)) {
    params.push({
      name: "$@",
      optional: false,
      rest: true,
    });
  }
  
  return params;
}

/**
 * Normalize bash function body for comparison.
 */
export function normalizeBody(body: string, language: string): string {
  return body
    // Remove comments
    .replace(/#.*$/gm, "")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    // Remove leading/trailing whitespace
    .trim()
    // Normalize here-doc markers
    .replace(/<<-?\s*['"]?(\w+)['"]?/g, "<<$1")
    // Normalize string quotes (approximately)
    .replace(/"([^"\\]|\\.)*"/g, '""')
    .replace(/'[^']*'/g, "''");
}

/**
 * Get quote style from bash string node.
 */
export function getQuoteStyle(node: SyntaxNode): "single" | "double" | "backtick" | "raw" {
  const text = node.text;
  if (node.type === "raw_string") return "raw";
  if (text.startsWith("$'")) return "raw"; // ANSI-C
  if (text.startsWith("'")) return "single";
  if (text.startsWith('"')) return "double";
  if (text.startsWith("`")) return "backtick";
  return "double";
}

/**
 * Check if function is exported (defined before or has export -f).
 * In bash, functions are exported if 'export -f name' is called.
 */
export function isExported(node: SyntaxNode, captures: QueryCaptures): boolean {
  // This would need full-file analysis to determine
  // For now, return false and let a linter detect unexported functions
  return false;
}

/**
 * Parse bash import (source command).
 */
export function parseImport(
  node: SyntaxNode,
  captures: QueryCaptures,
  source: string
): ImportInfo {
  const fromCapture = captures.get("import.from");
  const fromText = fromCapture?.text ?? "";
  
  // Strip quotes if present
  const from = fromText.replace(/^["']|["']$/g, "");
  
  return {
    name: from.split("/").pop() ?? from,
    location: {
      file: "",  // Will be filled in by caller
      line: node.startPosition.row + 1,
      column: node.startPosition.column + 1,
    },
    from,
    isTypeOnly: false,
    isNamespace: false,
  };
}

/**
 * Parse doc comments for bash (comments before function).
 */
export function parseDocComment(node: SyntaxNode, source: string): string {
  // Strip leading # and whitespace
  return node.text
    .split("\n")
    .map(line => line.replace(/^\s*#\s?/, ""))
    .join("\n")
    .trim();
}
```

### 4.4 Module Export

**File: `packages/viola-grammar-bash/mod.ts`**

```ts
import type { GrammarDefinition } from "@hiisi/viola";
import {
  functionQuery,
  stringQuery,
  importQuery,
  exportQuery,
  docCommentQuery,
} from "./src/queries.ts";
import {
  parseParams,
  normalizeBody,
  getQuoteStyle,
  isExported,
  parseImport,
  parseDocComment,
} from "./src/transforms.ts";

export const bash: GrammarDefinition = {
  meta: {
    id: "bash",
    name: "Bash/Shell",
    extensions: [".sh", ".bash"],
    globs: [".bashrc", ".bash_profile", ".profile", ".bash_aliases"],
    description: "Bash and shell scripts using tree-sitter-bash",
  },
  
  grammar: {
    source: "npm",
    package: "tree-sitter-bash",
    wasm: "tree-sitter-bash.wasm",
  },
  
  queries: {
    functions: functionQuery,
    strings: stringQuery,
    imports: importQuery,
    exports: exportQuery,
    // No types in bash
    types: undefined,
    docComments: docCommentQuery,
  },
  
  transforms: {
    parseParams,
    normalizeBody,
    getQuoteStyle,
    isExported,
    parseImport,
    parseDocComment,
  },
};

export default bash;
```

## Phase 6: Nutshell Integration

### 6.1 Viola Config for Nutshell

**File: `nutshell/viola.config.ts`**

```ts
import { viola, grammar, linter, report, when } from "@hiisi/viola";
import { atLeast } from "@hiisi/viola";
import bash from "@hiisi/viola-grammar-bash";
import similarFunctions from "@hiisi/viola-lint-similar-functions";
import duplicateStrings from "@hiisi/viola-lint-duplicate-strings";

export default viola()
  // Register grammar
  .add(grammar, bash)
  
  // Register linters
  .add(linter, similarFunctions)
  .add(linter, duplicateStrings)
  
  // Severity rules
  .rule(report.error, when.issue.impact(atLeast(Impact.Major)))
  .rule(report.warn, when.issue.impact(atLeast(Impact.Minor)))
  
  // Path exclusions
  .rule(report.off, when.in("**/impl/**"))
  .rule(report.off, when.in("**/examples/**"))
  
  // CI-specific: stricter in CI
  .rule(report.error, when.env("CI").exists().and(when.issue.impact(atLeast(Impact.Minor))));
```

### 6.2 Update Check Script

**File: `nutshell/check`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIOLA_BIN="${SCRIPT_DIR}/bin/viola"

# Check if viola binary exists
if [[ ! -x "$VIOLA_BIN" ]]; then
    echo "Error: viola binary not found at $VIOLA_BIN" >&2
    echo "Run './build-viola' to build it" >&2
    exit 1
fi

# Run viola with all arguments
exec "$VIOLA_BIN" "$@"
```

### 6.3 Build Script

**File: `nutshell/build-viola`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Compile viola with bash grammar bundled
deno compile \
    --allow-read \
    --allow-write \
    --allow-env \
    --output "${SCRIPT_DIR}/bin/viola" \
    "${SCRIPT_DIR}/viola.config.ts"

echo "Built bin/viola"
```

## Phase 7: Testing Infrastructure

### 7.1 Grammar Test Fixtures

**Directory: `packages/viola-grammar-bash/test/fixtures/`**

```
fixtures/
├── functions/
│   ├── simple.sh           # Basic function def
│   ├── with-params.sh      # Function using $1, $2
│   ├── with-local.sh       # Function with local vars
│   └── exported.sh         # Function with export -f
├── strings/
│   ├── double-quoted.sh
│   ├── single-quoted.sh
│   └── heredoc.sh
├── imports/
│   ├── source-command.sh
│   └── dot-command.sh
└── expected/
    ├── functions.json
    ├── strings.json
    └── imports.json
```

### 7.2 Grammar Tests

**File: `packages/viola-grammar-bash/test/extraction_test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { bash } from "../mod.ts";
import { loadGrammar, createParser, extractFileData } from "@hiisi/viola";

Deno.test("bash grammar extracts simple function", async () => {
  const language = await loadGrammar(bash.grammar);
  const parser = createParser(language);
  
  const source = `
my_function() {
    echo "hello"
}
`;
  
  const tree = parser.parse(source);
  const data = extractFileData(tree, language, bash, "test.sh", source);
  
  assertEquals(data.functions.length, 1);
  assertEquals(data.functions[0].name, "my_function");
});

Deno.test("bash grammar extracts positional params", async () => {
  const language = await loadGrammar(bash.grammar);
  const parser = createParser(language);
  
  const source = `
greet() {
    echo "Hello, $1! You are $2 years old."
}
`;
  
  const tree = parser.parse(source);
  const data = extractFileData(tree, language, bash, "test.sh", source);
  
  assertEquals(data.functions[0].params.length, 2);
  assertEquals(data.functions[0].params[0].name, "$1");
  assertEquals(data.functions[0].params[1].name, "$2");
});

Deno.test("bash grammar extracts source imports", async () => {
  const language = await loadGrammar(bash.grammar);
  const parser = createParser(language);
  
  const source = `
source "./lib/utils.sh"
. "../common.sh"
`;
  
  const tree = parser.parse(source);
  const data = extractFileData(tree, language, bash, "test.sh", source);
  
  assertEquals(data.imports.length, 2);
  assertEquals(data.imports[0].from, "./lib/utils.sh");
  assertEquals(data.imports[1].from, "../common.sh");
});
```

## Required Transforms Summary

### TypeScript Transforms (Must Implement)

| Transform | Complexity | Reason |
|-----------|------------|--------|
| `parseParams` | High | Destructuring, defaults, rest, types, decorators |
| `parseTypeFields` | Medium | Interface/type field extraction |
| `isAsync` | Low | Check for async keyword |
| `isGenerator` | Low | Check for * in function |
| `isExported` | Medium | Check parent for export statement |
| `isDefaultExport` | Medium | Check for default keyword in export |
| `parseDocComment` | Medium | Strip JSDoc markers, parse tags |
| `getQuoteStyle` | Low | Determine quote character |

### Bash Transforms (Must Implement)

| Transform | Complexity | Reason |
|-----------|------------|--------|
| `parseParams` | Medium | Scan body for $1, $2, $@, $* usage |
| `normalizeBody` | Medium | Handle here-docs, different quote styles |
| `parseImport` | Low | Extract path from source/. command |
| `parseDocComment` | Low | Strip # prefix from comments |
| `getQuoteStyle` | Low | Distinguish '', "", $'' |
| `isExported` | Low | Would need full-file scan for export -f |

### Transforms NOT Needed (Query-Only)

These can be handled purely by tree-sitter queries:
- Function name extraction
- Function body extraction  
- String literal extraction
- Basic import/export detection
- Type name extraction
- Type body extraction

## Timeline Estimate

| Phase | Description | Effort |
|-------|-------------|--------|
| 1 | Core tree-sitter + comparisons | 2-3 days |
| 2 | Condition API (`when.*`) | 1-2 days |
| 3 | Builder API update | 1-2 days |
| 4 | TypeScript grammar package | 2-3 days |
| 5 | Bash grammar package | 1-2 days |
| 6 | Nutshell integration | 1 day |
| 7 | Testing infrastructure | 1 day |

**Total: ~9-14 days**

## Open Items

1. **WASM loading strategy** - How to resolve npm package paths to WASM files in Deno?
2. **Grammar bundling** - Should grammars be bundled in the compiled binary or loaded at runtime?
3. **Query validation** - Should we validate capture names at grammar registration time?
4. **Incremental parsing** - Should we use tree-sitter's incremental parsing for watch mode?
5. **Error recovery** - How to handle parse errors gracefully?
6. **Type inference for aliases** - How to make `.as(ts)` provide proper TypeScript inference for use in `grammar(ts)`?

## Next Steps

1. Start with Phase 1 - comparison primitives and tree-sitter integration
2. Phase 2 - implement `when.*` condition API
3. Phase 3 - update builder with `.add()` and `.rule()` patterns
4. Create minimal TypeScript grammar to validate the approach
5. Run against existing viola tests to ensure no regressions
6. Then add bash grammar and integrate with nutshell

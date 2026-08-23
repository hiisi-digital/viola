//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Grammar Loader
 *
 * Handles lazy loading of tree-sitter grammar WASM files.
 * Grammars are loaded on-demand and cached for reuse.
 *
 * @module
 */

import type { GrammarSource } from "./types.ts";

// =============================================================================
// Types
// =============================================================================

/**
 * Tree-sitter Parser type (from web-tree-sitter).
 * We define this interface to avoid direct import in type definitions.
 */
/**
 * Raised wherever a parse is attempted before the runtime is up.
 *
 * One message, because two spellings of one condition drift and a caller
 * matching on the text then handles one of them.
 */
const NOT_INITIALIZED =
  "Tree-sitter not initialized. Call initTreeSitter() first.";

/**
 * The part of tree-sitter's parser this needs.
 *
 * Declared here rather than imported, because the runtime arrives through a
 * dynamic import whose types are not available at build time.
 */
export interface Parser {
  parse(input: string, oldTree?: Tree | null): Tree;
  setLanguage(language: Language | null): void;
  getLanguage(): Language | null;
  setTimeoutMicros(timeout: number): void;
  getTimeoutMicros(): number;
  reset(): void;
  delete(): void;
}

/**
 * Tree-sitter Language type.
 */
export interface Language {
  readonly version: number;
  readonly fieldCount: number;
  readonly nodeTypeCount: number;
  fieldNameForId(fieldId: number): string | null;
  fieldIdForName(fieldName: string): number | null;
  idForNodeType(type: string, named: boolean): number;
  nodeTypeForId(typeId: number): string | null;
  nodeTypeIsNamed(typeId: number): boolean;
  nodeTypeIsVisible(typeId: number): boolean;
  query(source: string): Query;
}

/**
 * Tree-sitter Tree type.
 */
export interface Tree {
  readonly rootNode: SyntaxNode;
  copy(): Tree;
  delete(): void;
  edit(edit: Edit): void;
  walk(): TreeCursor;
  getChangedRanges(other: Tree): Range[];
  getLanguage(): Language;
}

/**
 * Tree-sitter Query type.
 */
export interface Query {
  matches(
    node: SyntaxNode,
    startPosition?: { row: number; column: number },
    endPosition?: { row: number; column: number },
  ): QueryMatch[];
  captures(
    node: SyntaxNode,
    startPosition?: { row: number; column: number },
    endPosition?: { row: number; column: number },
  ): QueryCapture[];
  delete(): void;
}

/**
 * Tree-sitter QueryMatch type.
 */
export interface QueryMatch {
  pattern: number;
  captures: QueryCapture[];
}

/**
 * Tree-sitter QueryCapture type.
 */
export interface QueryCapture {
  name: string;
  node: SyntaxNode;
}

/**
 * Tree-sitter SyntaxNode type.
 */
export interface SyntaxNode {
  readonly type: string;
  readonly text: string;
  readonly startPosition: { row: number; column: number };
  readonly endPosition: { row: number; column: number };
  readonly startIndex: number;
  readonly endIndex: number;
  readonly parent: SyntaxNode | null;
  /** The node before this one, skipping anonymous nodes. */
  readonly previousNamedSibling: SyntaxNode | null;
  /** The node after this one, skipping anonymous nodes. */
  readonly nextNamedSibling: SyntaxNode | null;
  readonly children: SyntaxNode[];
  readonly namedChildren: SyntaxNode[];
  readonly childCount: number;
  readonly namedChildCount: number;
  readonly hasError: boolean;
  readonly isMissing: boolean;
  childForFieldName(name: string): SyntaxNode | null;
  child(index: number): SyntaxNode | null;
  namedChild(index: number): SyntaxNode | null;
  descendantForIndex(index: number): SyntaxNode;
  descendantsOfType(
    type: string | string[],
    startPosition?: { row: number; column: number },
    endPosition?: { row: number; column: number },
  ): SyntaxNode[];
  walk(): TreeCursor;
}

/**
 * Tree-sitter TreeCursor type.
 */
export interface TreeCursor {
  readonly nodeType: string;
  readonly nodeText: string;
  readonly nodeIsNamed: boolean;
  readonly startPosition: { row: number; column: number };
  readonly endPosition: { row: number; column: number };
  readonly startIndex: number;
  readonly endIndex: number;
  readonly currentNode: SyntaxNode;
  readonly currentFieldName: string | null;
  reset(node: SyntaxNode): void;
  gotoParent(): boolean;
  gotoFirstChild(): boolean;
  gotoFirstChildForIndex(index: number): boolean;
  gotoNextSibling(): boolean;
}

/**
 * Tree-sitter Edit type.
 */
interface Edit {
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
  startPosition: { row: number; column: number };
  oldEndPosition: { row: number; column: number };
  newEndPosition: { row: number; column: number };
}

/**
 * Tree-sitter Range type.
 */
interface Range {
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
}

/**
 * The tree-sitter Parser class/constructor.
 */
interface ParserConstructor {
  new (): Parser;
  init(
    options?: { locateFile?: (scriptName: string) => string },
  ): Promise<void>;
  Language: {
    load(path: string): Promise<Language>;
  };
}

// =============================================================================
// State
// =============================================================================

/** Whether tree-sitter WASM runtime has been initialized */
let initialized = false;

/** Cached loaded languages by grammar key */
const loadedLanguages = new Map<string, Language>();

/** Cached parsers by grammar key */
const parserCache = new Map<string, Parser>();

/** The tree-sitter Parser class (loaded dynamically) */
let ParserClass: ParserConstructor | null = null;

// =============================================================================
// Public API
// =============================================================================

/**
 * Initialize the tree-sitter WASM runtime.
 * This must be called before loading any grammars.
 * Safe to call multiple times - will only initialize once.
 */
export async function initTreeSitter(): Promise<void> {
  if (initialized) return;

  // Dynamically import web-tree-sitter
  const TreeSitter = await import("npm:web-tree-sitter@0.22.6");
  ParserClass = TreeSitter.default as unknown as ParserConstructor;

  // Initialize the WASM runtime
  await ParserClass.init();

  initialized = true;
}

/**
 * Check if tree-sitter has been initialized.
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Load a grammar's WASM and return the Language object.
 * Languages are cached, so subsequent calls return the cached instance.
 *
 * @throws Error if tree-sitter hasn't been initialized
 * @throws Error if grammar loading fails
 */
export async function loadGrammar(grammar: GrammarSource): Promise<Language> {
  if (!initialized || !ParserClass) {
    throw new Error(
      NOT_INITIALIZED,
    );
  }

  const key = grammarKey(grammar);

  // Return cached language if available
  const cached = loadedLanguages.get(key);
  if (cached) return cached;

  // Resolve WASM path based on source type
  const wasmPath = await resolveWasmPath(grammar);

  // Load the language
  const language = await ParserClass.Language.load(wasmPath);

  // Cache and return
  loadedLanguages.set(key, language);
  return language;
}

/**
 * Create a parser instance configured with the given language.
 * Parsers are cached per grammar.
 *
 * @throws Error if tree-sitter hasn't been initialized
 */
export function createParser(
  grammar: GrammarSource,
  language: Language,
): Parser {
  if (!initialized || !ParserClass) {
    throw new Error(
      NOT_INITIALIZED,
    );
  }

  const key = grammarKey(grammar);

  // Return cached parser if available
  const cached = parserCache.get(key);
  if (cached) return cached;

  // Create new parser
  const parser = new ParserClass();
  parser.setLanguage(language);

  // Cache and return
  parserCache.set(key, parser);
  return parser;
}

/**
 * Get a parser for a grammar, loading the grammar if necessary.
 * Convenience function that combines loadGrammar and createParser.
 *
 * @throws Error if tree-sitter hasn't been initialized
 * @throws Error if grammar loading fails
 */
export async function getParser(grammar: GrammarSource): Promise<Parser> {
  const language = await loadGrammar(grammar);
  return createParser(grammar, language);
}

/**
 * Clear all cached languages and parsers.
 * Useful for testing or when you need to free memory.
 */
export function clearCache(): void {
  // Delete all cached parsers
  for (const parser of parserCache.values()) {
    parser.delete();
  }
  parserCache.clear();
  loadedLanguages.clear();
}

/**
 * Reset the loader state completely.
 * After calling this, initTreeSitter() must be called again.
 */
export function reset(): void {
  clearCache();
  initialized = false;
  ParserClass = null;
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Generate a unique key for a grammar source.
 */
function grammarKey(grammar: GrammarSource): string {
  switch (grammar.source) {
    case "npm":
      return `npm:${grammar.package}/${grammar.wasm}`;
    case "url":
      return `url:${grammar.url}`;
    case "bundled":
      return `bundled:${grammar.wasm}`;
    default:
      throw new Error(
        `Unknown grammar source type: ${(grammar as GrammarSource).source}`,
      );
  }
}

/**
 * Resolve the WASM path for a grammar source.
 */
async function resolveWasmPath(grammar: GrammarSource): Promise<string> {
  switch (grammar.source) {
    case "npm":
      return resolveNpmWasm(grammar.package!, grammar.wasm!);

    case "url":
      if (!grammar.url) {
        throw new Error("Grammar source 'url' requires a url property");
      }
      return grammar.url;

    case "bundled":
      if (!grammar.wasm) {
        throw new Error("Grammar source 'bundled' requires a wasm property");
      }
      // Bundled grammars are relative to the viola package
      return new URL(`../../wasm/${grammar.wasm}`, import.meta.url).pathname;

    default:
      throw new Error(
        `Unknown grammar source type: ${(grammar as GrammarSource).source}`,
      );
  }
}

/**
 * Resolve WASM path from an npm package.
 *
 * This attempts to locate the WASM file in the npm package.
 * In Deno, npm packages are stored in the npm cache.
 */
async function resolveNpmWasm(
  packageName: string,
  wasmFile: string,
): Promise<string> {
  // Strategy 1: Try import.meta.resolve (works if Deno returns file:// URL)
  try {
    const resolved = import.meta.resolve(`npm:${packageName}/${wasmFile}`);
    if (resolved.startsWith("file://")) {
      const path = new URL(resolved).pathname;
      await Deno.stat(path);
      return path;
    }
  } catch {
    // Not a file URL or file doesn't exist
  }

  // Strategy 2: Look in Deno's npm cache (macOS and Linux locations)
  const cacheRoots = [
    `${Deno.env.get("DENO_DIR") ?? ""}/npm/registry.npmjs.org`,
    `${Deno.env.get("HOME")}/Library/Caches/deno/npm/registry.npmjs.org`,
    `${Deno.env.get("HOME")}/.cache/deno/npm/registry.npmjs.org`,
  ].filter((p) => p && !p.startsWith("/npm/"));

  for (const cacheRoot of cacheRoots) {
    const packageDir = `${cacheRoot}/${packageName}`;
    try {
      // List version directories
      for await (const entry of Deno.readDir(packageDir)) {
        if (!entry.isDirectory) continue;
        const wasmPath = `${packageDir}/${entry.name}/${wasmFile}`;
        try {
          await Deno.stat(wasmPath);
          return wasmPath;
        } catch {
          // Try nested dist directory
          try {
            const distPath = `${packageDir}/${entry.name}/dist/${wasmFile}`;
            await Deno.stat(distPath);
            return distPath;
          } catch {
            // WASM not in this version dir
          }
        }
      }
    } catch {
      // Cache directory doesn't exist
    }
  }

  // Strategy 3: Look in node_modules (if nodeModulesDir is enabled)
  try {
    const nmPath = `node_modules/${packageName}/${wasmFile}`;
    await Deno.stat(nmPath);
    return nmPath;
  } catch {
    // node_modules not available
  }

  throw new Error(
    `Could not resolve WASM file for npm package: ${packageName}/${wasmFile}. ` +
      `Ensure the package is imported in deno.json.`,
  );
}

//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Query Executor
 *
 * Runs tree-sitter queries against parsed syntax trees and yields
 * matches with their captures in a convenient format.
 *
 * @module
 */

import type { Language, Query, SyntaxNode, Tree } from "./loader.ts";
import type { QueryCaptures } from "./types.ts";

// =============================================================================
// Query Captures Implementation
// =============================================================================

/**
 * Implementation of QueryCaptures interface.
 * Wraps a map of captures for convenient access.
 */
class QueryCapturesImpl implements QueryCaptures {
  private readonly captures: Map<string, { node: SyntaxNode; text: string }>;

  constructor(captures: Map<string, { node: SyntaxNode; text: string }>) {
    this.captures = captures;
  }

  get(name: string): { node: SyntaxNode; text: string } | undefined {
    return this.captures.get(name);
  }

  has(name: string): boolean {
    return this.captures.has(name);
  }

  all(): ReadonlyMap<string, { node: SyntaxNode; text: string }> {
    return this.captures;
  }
}

// =============================================================================
// Query Execution
// =============================================================================

/**
 * Run a tree-sitter query and yield matches with their captures.
 *
 * Each match yields a QueryCaptures object that provides convenient
 * access to captured nodes by name.
 *
 * @param tree - The parsed syntax tree
 * @param language - The language object (for creating the query)
 * @param querySource - The query source code (S-expression format)
 * @param sourceCode - The original source code (for extracting text)
 *
 * @example
 * ```ts
 * const query = `
 *   (function_definition
 *     name: (word) @function.name
 *     body: (compound_statement) @function.body)
 * `;
 *
 * for (const captures of runQuery(tree, language, query, source)) {
 *   const name = captures.get("function.name");
 *   if (name) {
 *     console.log(`Found function: ${name.text}`);
 *   }
 * }
 * ```
 */
export function* runQuery(
  tree: Tree,
  language: Language,
  querySource: string,
  sourceCode: string,
): Generator<QueryCaptures> {
  // Create the query from source
  let query: Query;
  try {
    query = language.query(querySource);
  } catch (error) {
    throw new Error(
      `Failed to compile tree-sitter query: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    // Get all matches
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      // Build captures map for this match
      const capturesMap = new Map<string, { node: SyntaxNode; text: string }>();

      for (const capture of match.captures) {
        // Extract text from source code using node positions
        // This is more reliable than node.text for some edge cases
        const text = sourceCode.slice(
          capture.node.startIndex,
          capture.node.endIndex,
        );

        capturesMap.set(capture.name, {
          node: capture.node,
          text,
        });
      }

      yield new QueryCapturesImpl(capturesMap);
    }
  } finally {
    // Clean up query resources
    query.delete();
  }
}

/**
 * Run a query and collect all matches into an array.
 * Convenience function when you need all matches at once.
 *
 * @param tree - The parsed syntax tree
 * @param language - The language object
 * @param querySource - The query source code
 * @param sourceCode - The original source code
 * @returns Array of all captures
 */
export function queryAll(
  tree: Tree,
  language: Language,
  querySource: string,
  sourceCode: string,
): QueryCaptures[] {
  return [...runQuery(tree, language, querySource, sourceCode)];
}

/**
 * Run a query and return the first match, or undefined if no matches.
 *
 * @param tree - The parsed syntax tree
 * @param language - The language object
 * @param querySource - The query source code
 * @param sourceCode - The original source code
 * @returns The first match's captures, or undefined
 */
export function queryFirst(
  tree: Tree,
  language: Language,
  querySource: string,
  sourceCode: string,
): QueryCaptures | undefined {
  for (const captures of runQuery(tree, language, querySource, sourceCode)) {
    return captures;
  }
  return undefined;
}

/**
 * Count the number of matches for a query.
 *
 * @param tree - The parsed syntax tree
 * @param language - The language object
 * @param querySource - The query source code
 * @param sourceCode - The original source code
 * @returns Number of matches
 */
export function queryCount(
  tree: Tree,
  language: Language,
  querySource: string,
  sourceCode: string,
): number {
  let count = 0;
  for (const _ of runQuery(tree, language, querySource, sourceCode)) {
    count++;
  }
  return count;
}

/**
 * Check if a query has any matches.
 *
 * @param tree - The parsed syntax tree
 * @param language - The language object
 * @param querySource - The query source code
 * @param sourceCode - The original source code
 * @returns True if at least one match exists
 */
export function queryHasMatch(
  tree: Tree,
  language: Language,
  querySource: string,
  sourceCode: string,
): boolean {
  return queryFirst(tree, language, querySource, sourceCode) !== undefined;
}

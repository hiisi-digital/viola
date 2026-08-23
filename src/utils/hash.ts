/**
 * Viola Hashing Utilities
 *
 * Fast hashing functions for content comparison and deduplication.
 * Uses simple but effective algorithms suitable for code analysis.
 *
 * @module
 */

import type { CodeFingerprint } from "./types/hash.types.ts";

// Re-export types for convenience
export type { CodeFingerprint } from "./types/hash.types.ts";

// =============================================================================
// Simple Hash Functions
// =============================================================================

/**
 * djb2 hash algorithm - fast and simple string hashing.
 * Good for hash tables and quick comparisons.
 *
 * @param str - String to hash
 * @returns 32-bit hash as hex string
 */
export function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  // Convert to unsigned 32-bit integer and then to hex
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * FNV-1a hash algorithm - good distribution and speed.
 *
 * @param str - String to hash
 * @returns 32-bit hash as hex string
 */
export function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // FNV prime: 0x01000193
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Combine multiple hashes into one.
 * Useful for hashing composite data.
 *
 * @param hashes - Hashes to combine
 * @returns Combined hash
 */
export function combineHashes(...hashes: string[]): string {
  return fnv1aHash(hashes.join(":"));
}

// =============================================================================
// Content Hashing
// =============================================================================

/**
 * Hash content with normalization options.
 * Used for comparing code bodies where formatting shouldn't matter.
 *
 * @param content - Content to hash
 * @param normalize - Whether to normalize whitespace
 * @returns Hash of content
 */
export function hashContent(
  content: string,
  normalize: boolean = true,
): string {
  let processed = content;

  if (normalize) {
    // Normalize line endings
    processed = processed.replace(/\r\n/g, "\n");
    // Collapse multiple whitespace to single space
    processed = processed.replace(/\s+/g, " ");
    // Trim
    processed = processed.trim();
  }

  return fnv1aHash(processed);
}

/**
 * Hash code body for comparison.
 * Removes comments and normalizes whitespace.
 *
 * @param code - Code to hash
 * @returns Hash of normalized code
 */
export function hashCodeBody(code: string): string {
  let normalized = code;

  // Remove single-line comments
  normalized = normalized.replace(/\/\/.*$/gm, "");

  // Remove multi-line comments
  normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, "");

  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, " ").trim();

  return fnv1aHash(normalized);
}

/**
 * Create a structural hash that ignores identifier names.
 * Useful for detecting renamed copies of code.
 *
 * @param code - Code to hash
 * @returns Structural hash
 */
export function hashStructure(code: string): string {
  let normalized = code;

  // Remove comments
  normalized = normalized.replace(/\/\/.*$/gm, "");
  normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, "");

  // Replace string literals with placeholder
  normalized = normalized.replace(/"(?:[^"\\]|\\.)*"/g, '"_"');
  normalized = normalized.replace(/'(?:[^'\\]|\\.)*'/g, "'_'");
  normalized = normalized.replace(/`(?:[^`\\]|\\.)*`/g, "`_`");

  // Replace identifiers with placeholder
  // This is a simplified approach - a proper AST would be more accurate
  normalized = normalized.replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, "_");

  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, " ").trim();

  return fnv1aHash(normalized);
}

// =============================================================================
// Fingerprinting
// =============================================================================

/**
 * Create a fingerprint for a piece of code.
 * Multiple hashes allow for different comparison strategies.
 *
 * @param code - Code to fingerprint
 * @returns Fingerprint with multiple hashes
 */
export function createFingerprint(code: string): CodeFingerprint {
  return Object.freeze({
    raw: fnv1aHash(code),
    normalized: hashCodeBody(code),
    structural: hashStructure(code),
    length: code.length,
    lines: code.split("\n").length,
  });
}

/**
 * Check if two fingerprints are potentially similar.
 * Quick check before doing more expensive comparison.
 *
 * @param a - First fingerprint
 * @param b - Second fingerprint
 * @returns Whether fingerprints might represent similar code
 */
export function fingerprintsMightMatch(
  a: CodeFingerprint,
  b: CodeFingerprint,
): boolean {
  // Exact structural match is a strong signal
  if (a.structural === b.structural) return true;

  // Exact normalized match
  if (a.normalized === b.normalized) return true;

  // Similar length (within 20%)
  const lengthRatio = Math.min(a.length, b.length) /
    Math.max(a.length, b.length);
  if (lengthRatio < 0.8) return false;

  // Similar line count (within 2 lines or 20%)
  const lineDiff = Math.abs(a.lines - b.lines);
  const lineRatio = Math.min(a.lines, b.lines) / Math.max(a.lines, b.lines);
  if (lineDiff > 2 && lineRatio < 0.8) return false;

  return true;
}

// =============================================================================
// Hash-based Deduplication
// =============================================================================

/**
 * Group items by hash.
 * Useful for finding exact duplicates quickly.
 *
 * @param items - Items to group
 * @param getContent - Function to get hashable content from item
 * @returns Map from hash to items with that hash
 */
export function groupByHash<T>(
  items: readonly T[],
  getContent: (item: T) => string,
): Map<string, T[]> {
  return groupBy(items, (item) => hashContent(getContent(item)));
}

/**
 * Gather items under whatever key a function gives them.
 *
 * The two grouping functions below differ only in which hash they take, and
 * were written out twice in full. This is the part that was the same.
 */
function groupBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = keyOf(item);
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}

/**
 * Find exact duplicates using hash-based comparison.
 *
 * @param items - Items to check
 * @param getContent - Function to get hashable content from item
 * @returns Groups of items that are exact duplicates
 */
export function findExactDuplicates<T>(
  items: readonly T[],
  getContent: (item: T) => string,
): T[][] {
  const groups = groupByHash(items, getContent);
  return Array.from(groups.values()).filter((group) => group.length > 1);
}

/**
 * Group items by structural hash.
 * Finds items that are structurally identical (ignoring identifier names).
 *
 * @param items - Items to group
 * @param getCode - Function to get code from item
 * @returns Map from structural hash to items
 */
export function groupByStructure<T>(
  items: readonly T[],
  getCode: (item: T) => string,
): Map<string, T[]> {
  return groupBy(items, (item) => hashStructure(getCode(item)));
}

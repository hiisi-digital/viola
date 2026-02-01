/**
 * Viola Similarity Utilities
 *
 * Functions for comparing strings, sets, and code structures.
 * Used by linters to detect duplicates and similar code.
 *
 * @module
 */

import type {
    SimilarityLevel,
    SimilarityMatch,
    SimilarityThresholds
} from "./types/similarity.types.ts";

// Re-export types for convenience
export type {
    SimilarityLevel,
    SimilarityMatch,
    SimilarityThresholds
} from "./types/similarity.types.ts";

// =============================================================================
// Levenshtein Distance
// =============================================================================

/**
 * Calculate Levenshtein distance between two strings.
 * This is the minimum number of single-character edits (insertions,
 * deletions, or substitutions) required to change one string into the other.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Edit distance (0 = identical)
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use two rows instead of full matrix for memory efficiency
  let prevRow = new Array(b.length + 1);
  let currRow = new Array(b.length + 1);

  // Initialize first row
  for (let j = 0; j <= b.length; j++) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    currRow[0] = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // deletion
        currRow[j - 1] + 1, // insertion
        prevRow[j - 1] + cost // substitution
      );
    }

    // Swap rows
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[b.length];
}

/**
 * Calculate normalized Levenshtein similarity (0 to 1).
 * 1 = identical, 0 = completely different.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Similarity score between 0 and 1
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

// =============================================================================
// Jaccard Similarity
// =============================================================================

/**
 * Calculate Jaccard similarity coefficient between two sets.
 * J(A,B) = |A ∩ B| / |A ∪ B|
 *
 * @param a - First set or array
 * @param b - Second set or array
 * @returns Similarity score between 0 and 1
 */
export function jaccardSimilarity<T>(
  a: ReadonlySet<T> | readonly T[],
  b: ReadonlySet<T> | readonly T[]
): number {
  const setA = a instanceof Set ? a : new Set(a);
  const setB = b instanceof Set ? b : new Set(b);

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersection++;
    }
  }

  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/**
 * Calculate Jaccard similarity for strings based on character n-grams.
 *
 * @param a - First string
 * @param b - Second string
 * @param n - N-gram size (default: 2 for bigrams)
 * @returns Similarity score between 0 and 1
 */
export function jaccardNGramSimilarity(
  a: string,
  b: string,
  n: number = 2
): number {
  const ngramsA = getNGrams(a, n);
  const ngramsB = getNGrams(b, n);
  return jaccardSimilarity(ngramsA, ngramsB);
}

/**
 * Extract n-grams from a string.
 */
function getNGrams(str: string, n: number): Set<string> {
  const ngrams = new Set<string>();
  if (str.length < n) {
    ngrams.add(str);
    return ngrams;
  }
  for (let i = 0; i <= str.length - n; i++) {
    ngrams.add(str.slice(i, i + n));
  }
  return ngrams;
}

// =============================================================================
// Token-based Similarity
// =============================================================================

/**
 * Tokenize a string into words/identifiers.
 * Handles camelCase, snake_case, and kebab-case.
 */
export function tokenize(str: string): string[] {
  return str
    // Split camelCase: "camelCase" -> "camel Case"
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    // Split on non-alphanumeric
    .split(/[^a-zA-Z0-9]+/)
    // Filter empty and convert to lowercase
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
}

/**
 * Calculate token-based similarity.
 * Useful for comparing identifier names.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Similarity score between 0 and 1
 */
export function tokenSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  return jaccardSimilarity(tokensA, tokensB);
}

// =============================================================================
// Combined Similarity
// =============================================================================



/**
 * Default thresholds for name comparison.
 */
export const NAME_SIMILARITY_THRESHOLDS: SimilarityThresholds = {
  low: 0.5,
  medium: 0.7,
  high: 0.85,
};

/**
 * Default thresholds for body/content comparison.
 */
export const BODY_SIMILARITY_THRESHOLDS: SimilarityThresholds = {
  low: 0.6,
  medium: 0.8,
  high: 0.95,
};



/**
 * Classify similarity score against thresholds.
 */
export function classifySimilarity(
  score: number,
  thresholds: SimilarityThresholds = NAME_SIMILARITY_THRESHOLDS
): SimilarityLevel {
  if (score >= 1) return "exact";
  if (score >= thresholds.high) return "high";
  if (score >= thresholds.medium) return "medium";
  if (score >= thresholds.low) return "low";
  return "none";
}

/**
 * Combined similarity score using multiple metrics.
 * Useful for more robust comparison.
 *
 * @param a - First string
 * @param b - Second string
 * @param weights - Weights for each metric (should sum to 1)
 * @returns Combined similarity score between 0 and 1
 */
export function combinedSimilarity(
  a: string,
  b: string,
  weights: {
    levenshtein?: number;
    jaccard?: number;
    token?: number;
  } = { levenshtein: 0.4, jaccard: 0.3, token: 0.3 }
): number {
  const lev = weights.levenshtein ?? 0;
  const jac = weights.jaccard ?? 0;
  const tok = weights.token ?? 0;

  const totalWeight = lev + jac + tok;
  if (totalWeight === 0) return 0;

  let score = 0;
  if (lev > 0) score += lev * levenshteinSimilarity(a, b);
  if (jac > 0) score += jac * jaccardNGramSimilarity(a, b);
  if (tok > 0) score += tok * tokenSimilarity(a, b);

  return score / totalWeight;
}

// =============================================================================
// Identifier Name Comparison
// =============================================================================

/**
 * Compare two identifier names for similarity.
 * Uses a combination of metrics optimized for code identifiers.
 *
 * @param a - First identifier
 * @param b - Second identifier
 * @returns Similarity analysis result
 */
export function compareIdentifiers(
  a: string,
  b: string
): {
  similarity: number;
  level: SimilarityLevel;
  metrics: {
    levenshtein: number;
    jaccard: number;
    token: number;
  };
} {
  // Exact match short-circuit
  if (a === b) {
    return {
      similarity: 1,
      level: "exact",
      metrics: { levenshtein: 1, jaccard: 1, token: 1 },
    };
  }

  // Case-insensitive exact match
  if (a.toLowerCase() === b.toLowerCase()) {
    return {
      similarity: 0.99,
      level: "exact",
      metrics: { levenshtein: 0.99, jaccard: 1, token: 1 },
    };
  }

  const metrics = {
    levenshtein: levenshteinSimilarity(a, b),
    jaccard: jaccardNGramSimilarity(a, b),
    token: tokenSimilarity(a, b),
  };

  // Weight token similarity higher for identifiers
  const similarity =
    metrics.levenshtein * 0.3 + metrics.jaccard * 0.2 + metrics.token * 0.5;

  return {
    similarity,
    level: classifySimilarity(similarity),
    metrics,
  };
}

// =============================================================================
// Code Body Comparison
// =============================================================================

/**
 * Normalize code for comparison.
 * Removes comments, normalizes whitespace, and optionally removes identifiers.
 */
export function normalizeCode(
  code: string,
  options: {
    removeComments?: boolean;
    normalizeWhitespace?: boolean;
    removeStringLiterals?: boolean;
    removeIdentifiers?: boolean;
  } = {}
): string {
  const {
    removeComments = true,
    normalizeWhitespace = true,
    removeStringLiterals = false,
    removeIdentifiers = false,
  } = options;

  let result = code;

  if (removeComments) {
    // Remove single-line comments
    result = result.replace(/\/\/.*$/gm, "");
    // Remove multi-line comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, "");
  }

  if (removeStringLiterals) {
    // Replace string literals with placeholder
    result = result.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    result = result.replace(/'(?:[^'\\]|\\.)*'/g, "''");
    result = result.replace(/`(?:[^`\\]|\\.)*`/g, "``");
  }

  if (removeIdentifiers) {
    // Replace identifiers with placeholder (simplified)
    result = result.replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, "_");
  }

  if (normalizeWhitespace) {
    // Normalize all whitespace to single spaces
    result = result.replace(/\s+/g, " ");
    result = result.trim();
  }

  return result;
}

/**
 * Compare two code bodies for structural similarity.
 *
 * @param a - First code body
 * @param b - Second code body
 * @returns Similarity analysis result
 */
export function compareCodeBodies(
  a: string,
  b: string
): {
  similarity: number;
  level: SimilarityLevel;
  normalizedSimilarity: number;
  structuralSimilarity: number;
} {
  // Exact match
  if (a === b) {
    return {
      similarity: 1,
      level: "exact",
      normalizedSimilarity: 1,
      structuralSimilarity: 1,
    };
  }

  // Compare normalized versions
  const normA = normalizeCode(a);
  const normB = normalizeCode(b);
  const normalizedSimilarity = levenshteinSimilarity(normA, normB);

  // Compare structural (identifiers removed)
  const structA = normalizeCode(a, { removeIdentifiers: true });
  const structB = normalizeCode(b, { removeIdentifiers: true });
  const structuralSimilarity = levenshteinSimilarity(structA, structB);

  // Combined score (weight structural higher as it catches renamed copies)
  const similarity = normalizedSimilarity * 0.4 + structuralSimilarity * 0.6;

  return {
    similarity,
    level: classifySimilarity(similarity, BODY_SIMILARITY_THRESHOLDS),
    normalizedSimilarity,
    structuralSimilarity,
  };
}

// =============================================================================
// Batch Comparison
// =============================================================================



/**
 * Find similar items in a collection.
 *
 * @param target - Item to find matches for
 * @param candidates - Items to compare against
 * @param getName - Function to get name from item
 * @param minSimilarity - Minimum similarity to include in results
 * @returns Sorted list of matches (highest similarity first)
 */
export function findSimilar<T>(
  target: T,
  candidates: readonly T[],
  getName: (item: T) => string,
  minSimilarity: number = 0.5
): SimilarityMatch<T>[] {
  const targetName = getName(target);
  const matches: SimilarityMatch<T>[] = [];

  for (const candidate of candidates) {
    if (candidate === target) continue;

    const candidateName = getName(candidate);
    const { similarity, level } = compareIdentifiers(targetName, candidateName);

    if (similarity >= minSimilarity) {
      matches.push({ item: candidate, similarity, level });
    }
  }

  return matches.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Find all pairs of similar items in a collection.
 * More efficient than comparing each to all others.
 *
 * @param items - Items to compare
 * @param getName - Function to get name from item
 * @param minSimilarity - Minimum similarity to include in results
 * @returns List of similar pairs
 */
export function findAllSimilarPairs<T>(
  items: readonly T[],
  getName: (item: T) => string,
  minSimilarity: number = 0.5
): Array<{
  a: T;
  b: T;
  similarity: number;
  level: SimilarityLevel;
}> {
  const pairs: Array<{
    a: T;
    b: T;
    similarity: number;
    level: SimilarityLevel;
  }> = [];

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const itemA = items[i];
      const itemB = items[j];
      if (!itemA || !itemB) continue;
      const nameA = getName(itemA);
      const nameB = getName(itemB);
      const { similarity, level } = compareIdentifiers(nameA, nameB);

      if (similarity >= minSimilarity) {
        pairs.push({ a: itemA, b: itemB, similarity, level });
      }
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity);
}

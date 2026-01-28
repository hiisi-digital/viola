/**
 * Viola Utilities Module
 *
 * Exports all utility functions used by the viola lint runtime.
 *
 * @module
 */

// Similarity functions
export {
    BODY_SIMILARITY_THRESHOLDS,
    classifySimilarity,
    // Combined
    combinedSimilarity,
    compareCodeBodies,
    // Identifier comparison
    compareIdentifiers,
    findAllSimilarPairs,
    // Batch comparison
    findSimilar,
    jaccardNGramSimilarity,
    // Jaccard
    jaccardSimilarity,
    // Levenshtein
    levenshteinDistance,
    levenshteinSimilarity,
    NAME_SIMILARITY_THRESHOLDS,
    // Code comparison
    normalizeCode,
    // Token-based
    tokenize,
    tokenSimilarity,
    type SimilarityLevel,
    type SimilarityMatch,
    // Types and constants
    type SimilarityThresholds
} from "./similarity.ts";

// Hash functions
export {
    combineHashes,
    // Fingerprinting
    createFingerprint,
    // Simple hashes
    djb2Hash,
    findExactDuplicates,
    fingerprintsMightMatch,
    fnv1aHash,
    // Hash-based grouping
    groupByHash,
    groupByStructure,
    hashCodeBody,
    // Content hashing
    hashContent,
    hashStructure,
    type CodeFingerprint
} from "./hash.ts";

// =============================================================================
// Flash-Freeze Re-exports
// =============================================================================
// Viola uses flash-freeze for immutable data structures.
// We re-export the most commonly used functions for convenience.

export {
    assertFrozen, deepFreeze, ensureFrozen,
    // Core freeze functions
    freeze,
    // Builders
    frozen,
    frozenArray, frozenCopy, frozenMap, frozenObject, frozenSet, isDeeplyFrozen,
    // Validation
    isFrozen, type DeepReadonly,
    type Freezable,
    // Types
    type Frozen
} from "@hiisi/flash-freeze";

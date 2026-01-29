/**
 * Viola Linters Module
 *
 * Exports linter infrastructure: base class, registry, and utilities.
 * Linter implementations are loaded via the plugin system.
 *
 * @module
 */

// Base linter class
export {
    BaseLinter,
    isLinter,
    type LinterConstructor,
    type LinterDataRequirements,
    type LinterMeta
} from "./base.ts";

// Registry
export {
    register,
    registerLinter,
    registry,
    runLinter,
    runLinters,
    type RunOptions
} from "./registry.ts";

// Individual linters (for direct import, not auto-registered)
export { DeprecationCheckLinter, deprecationCheckLinter, type DeprecationCheckOptions } from "./deprecation-check.ts";
export { DuplicateStringsLinter, duplicateStringsLinter, type DuplicateStringsOptions } from "./duplicate-strings.ts";
export { SimilarFunctionsLinter, similarFunctionsLinter, type SimilarFunctionsOptions } from "./similar-functions.ts";
export { SimilarTypesLinter, similarTypesLinter, type SimilarTypesOptions } from "./similar-types.ts";
export { TypeLocationLinter, typeLocationLinter } from "./type-location.ts";

// Additional linters
export { DuplicateLogicLinter } from "./duplicate-logic.ts";
export { MissingDocsLinter } from "./missing-docs.ts";
export { OrphanedCodeLinter } from "./orphaned-code.ts";
export { SchemaCollisionLinter } from "./schema-collision.ts";

// =============================================================================
// Linter instances (exported but NOT auto-registered)
// =============================================================================

import { DuplicateLogicLinter } from "./duplicate-logic.ts";
import { MissingDocsLinter } from "./missing-docs.ts";
import { OrphanedCodeLinter } from "./orphaned-code.ts";
import { SchemaCollisionLinter } from "./schema-collision.ts";

/** Pre-instantiated missing-docs linter */
export const missingDocsLinter: MissingDocsLinter = new MissingDocsLinter();

/** Pre-instantiated duplicate-logic linter */
export const duplicateLogicLinter: DuplicateLogicLinter = new DuplicateLogicLinter();

/** Pre-instantiated schema-collision linter */
export const schemaCollisionLinter: SchemaCollisionLinter = new SchemaCollisionLinter();

/** Pre-instantiated orphaned-code linter */
export const orphanedCodeLinter: OrphanedCodeLinter = new OrphanedCodeLinter();

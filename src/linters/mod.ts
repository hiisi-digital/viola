/**
 * Viola Linters Module
 *
 * Exports all linters and the linter registry.
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

// Individual linters
export { DeprecationCheckLinter, deprecationCheckLinter, type DeprecationCheckOptions } from "./deprecation-check.ts";
export { DuplicateStringsLinter, duplicateStringsLinter, type DuplicateStringsOptions } from "./duplicate-strings.ts";
export { SimilarFunctionsLinter, similarFunctionsLinter, type SimilarFunctionsOptions } from "./similar-functions.ts";
export { SimilarTypesLinter, similarTypesLinter, type SimilarTypesOptions } from "./similar-types.ts";
export { TypeLocationLinter, typeLocationLinter } from "./type-location.ts";

// New linters
export { DuplicateLogicLinter } from "./duplicate-logic.ts";
export { MissingDocsLinter } from "./missing-docs.ts";
export { OrphanedCodeLinter } from "./orphaned-code.ts";
export { SchemaCollisionLinter } from "./schema-collision.ts";

// =============================================================================
// Linter instances
// =============================================================================

import { deprecationCheckLinter } from "./deprecation-check.ts";
import { DuplicateLogicLinter } from "./duplicate-logic.ts";
import { duplicateStringsLinter } from "./duplicate-strings.ts";
import { MissingDocsLinter } from "./missing-docs.ts";
import { OrphanedCodeLinter } from "./orphaned-code.ts";
import { registry } from "./registry.ts";
import { SchemaCollisionLinter } from "./schema-collision.ts";
import { similarFunctionsLinter } from "./similar-functions.ts";
import { similarTypesLinter } from "./similar-types.ts";
import { typeLocationLinter } from "./type-location.ts";

/** Pre-instantiated missing-docs linter */
export const missingDocsLinter = new MissingDocsLinter();

/** Pre-instantiated duplicate-logic linter */
export const duplicateLogicLinter = new DuplicateLogicLinter();

/** Pre-instantiated schema-collision linter */
export const schemaCollisionLinter = new SchemaCollisionLinter();

/** Pre-instantiated orphaned-code linter */
export const orphanedCodeLinter = new OrphanedCodeLinter();

/**
 * Register all built-in linters with the global registry.
 * This is called automatically when the module is imported.
 */
export function registerBuiltinLinters(): void {
  // Only register if not already registered
  if (!registry.has(typeLocationLinter.meta.id)) {
    registry.register(typeLocationLinter);
  }
  if (!registry.has(similarFunctionsLinter.meta.id)) {
    registry.register(similarFunctionsLinter);
  }
  if (!registry.has(similarTypesLinter.meta.id)) {
    registry.register(similarTypesLinter);
  }
  if (!registry.has(duplicateStringsLinter.meta.id)) {
    registry.register(duplicateStringsLinter);
  }
  if (!registry.has(deprecationCheckLinter.meta.id)) {
    registry.register(deprecationCheckLinter);
  }
  // New linters
  if (!registry.has(missingDocsLinter.meta.id)) {
    registry.register(missingDocsLinter);
  }
  if (!registry.has(duplicateLogicLinter.meta.id)) {
    registry.register(duplicateLogicLinter);
  }
  if (!registry.has(schemaCollisionLinter.meta.id)) {
    registry.register(schemaCollisionLinter);
  }
  if (!registry.has(orphanedCodeLinter.meta.id)) {
    registry.register(orphanedCodeLinter);
  }
}

// Auto-register on module import
registerBuiltinLinters();

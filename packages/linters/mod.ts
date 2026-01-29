/**
 * Viola Linters Package
 *
 * A collection of linters for the viola convention linter.
 * This package is loaded as a plugin via the viola plugin system.
 *
 * ## Usage
 *
 * Add to your `deno.json` viola configuration:
 *
 * ```json
 * {
 *   "viola": {
 *     "plugins": ["@hiisi/viola-linters"],
 *     "**\/*.ts": {
 *       "*>=major": "error",
 *       "*>=minor": "warn"
 *     }
 *   }
 * }
 * ```
 *
 * Or import individual linters:
 *
 * ```ts
 * import { typeLocationLinter, similarFunctionsLinter } from "@hiisi/viola-linters";
 * ```
 *
 * @module
 */

// =============================================================================
// Individual Linter Exports
// =============================================================================

export {
    DeprecationCheckLinter,
    deprecationCheckLinter,
    type DeprecationCheckOptions
} from "./src/deprecation-check.ts";

export {
    DuplicateLogicLinter,
    duplicateLogicLinter
} from "./src/duplicate-logic.ts";

export {
    DuplicateStringsLinter,
    duplicateStringsLinter,
    type DuplicateStringsOptions
} from "./src/duplicate-strings.ts";

export {
    MissingDocsLinter,
    missingDocsLinter
} from "./src/missing-docs.ts";

export {
    OrphanedCodeLinter,
    orphanedCodeLinter
} from "./src/orphaned-code.ts";

export {
    SchemaCollisionLinter,
    schemaCollisionLinter
} from "./src/schema-collision.ts";

export {
    SimilarFunctionsLinter,
    similarFunctionsLinter,
    type SimilarFunctionsOptions
} from "./src/similar-functions.ts";

export {
    SimilarTypesLinter,
    similarTypesLinter,
    type SimilarTypesOptions
} from "./src/similar-types.ts";

export {
    TypeLocationLinter,
    typeLocationLinter
} from "./src/type-location.ts";

// =============================================================================
// Linters Array (for plugin discovery)
// =============================================================================

import type { BaseLinter } from "@hiisi/viola";
import { deprecationCheckLinter } from "./src/deprecation-check.ts";
import { duplicateLogicLinter } from "./src/duplicate-logic.ts";
import { duplicateStringsLinter } from "./src/duplicate-strings.ts";
import { missingDocsLinter } from "./src/missing-docs.ts";
import { orphanedCodeLinter } from "./src/orphaned-code.ts";
import { schemaCollisionLinter } from "./src/schema-collision.ts";
import { similarFunctionsLinter } from "./src/similar-functions.ts";
import { similarTypesLinter } from "./src/similar-types.ts";
import { typeLocationLinter } from "./src/type-location.ts";

/**
 * All linters as an array.
 * This is the preferred export for plugin discovery.
 */
export const linters: BaseLinter[] = [
    typeLocationLinter,
    similarFunctionsLinter,
    similarTypesLinter,
    duplicateStringsLinter,
    duplicateLogicLinter,
    deprecationCheckLinter,
    missingDocsLinter,
    orphanedCodeLinter,
    schemaCollisionLinter,
];

/**
 * Default export is the linters array for convenience.
 */
export default linters;

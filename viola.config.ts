/**
 * Viola configuration for dogfooding.
 *
 * Uses local imports to test the viola package against itself.
 * 
 * This config demonstrates proper use of explicit escape hatches:
 * - Each exemption is listed explicitly, forcing us to justify it
 * - No broad patterns or directory-wide ignores
 * - Comments explain WHY each exemption exists
 */

import defaultLints from "../viola-default-lints/mod.ts";
import { report, viola, when } from "./mod.ts";

export default viola()
  // Use the default lints plugin
  .use(defaultLints)

  // Test files: off (they have their own conventions)
  .rule(report.off, when.in("**/*_test.ts"))

  // =============================================================================
  // Linter-specific configuration with explicit escape hatches
  // =============================================================================

  // duplicate-logic: Condition builders are intentionally similar by design.
  // They follow a factory pattern where each creates a specific condition type.
  // The similarity IS the point - they're parallel implementations.
  .set("duplicate-logic", {
    ignoreFunctions: [
      "impactCond",      // Creates impact-based conditions
      "categoryCond",    // Creates category-based conditions  
      "fileCond",        // Creates file pattern conditions
      "linterCond",      // Creates linter ID conditions
      "confidenceCond",  // Creates confidence threshold conditions
      "resolveBundle",   // Plugin resolution - similar to resolvePreset by design
      "resolvePreset",   // Plugin resolution - similar to resolveBundle by design
    ],
  })

  // similar-functions: Same justification as duplicate-logic above.
  // These condition builders are MEANT to have similar names - they're a family.
  .set("similar-functions", {
    ignoreFunctions: [
      "impactCond",
      "categoryCond",
      "fileCond", 
      "linterCond",
      "confidenceCond",
    ],
  })

  // similar-types: Condition types are intentionally parallel structures.
  // Each condition type has the same shape with different discriminators.
  .set("similar-types", {
    ignoreTypes: [
      "ImpactCondition",
      "CategoryCondition",
      "FileCondition",
      "LinterCondition",
      "ConfidenceCondition",
    ],
  })

  // orphaned-code: These files export utilities intended for external consumption
  // by linter plugin authors. They're re-exported via mod.ts but the linter
  // can't always track the re-export chain perfectly.
  .set("orphaned-code", {
    publicApiFiles: [
      // Utility functions for linter authors
      "src/utils/hash.ts",
      "src/utils/similarity.ts",
      // Core types and base classes
      "src/linters/base.ts",
      "src/linters/registry.ts",
      "src/linters/types/base.types.ts",
      // Config utilities
      "src/config/types.ts",
      "src/config/enums.ts",
      "src/config/evaluator.ts",
      "src/config/merge.ts",
      "src/config/loader.ts",
      "src/config/validate.ts",
      "src/config/pattern.ts",
      "src/config/types/conditions.types.ts",
      // Plugin types (exported for plugin authors)
      "src/types/plugin.ts",
      // Runtime utilities
      "src/runtime/plugins.ts",
      "src/runtime/crawler.ts",
    ],
  })

  // duplicate-strings: Project-specific strings that are intentionally repeated.
  // Domain terminology that appears in both type definitions and runtime code.
  .set("duplicate-strings", {
    ignoreStrings: [
      // Severity/impact levels - domain vocabulary
      "critical",
      "major", 
      "minor",
      "trivial",
      // Issue categories - domain vocabulary
      "correctness",
      "maintainability",
      "consistency",
      "performance",
      "style",
      // Condition type discriminators
      "impact",
      "category",
      "file",
      "linter",
      "confidence",
      "compound",
      // Quote types in string literal detection
      "single",
      "double",
      "backtick",
    ],
  });

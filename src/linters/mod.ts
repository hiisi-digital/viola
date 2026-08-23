/**
 * Viola Linters Module
 *
 * Exports linter infrastructure: base class, registry, and utilities.
 * Linter implementations are loaded via the plugin system from external packages.
 *
 * @module
 */

// Base linter class
export {
  BaseLinter,
  isLinter,
  type LinterConstructor,
  type LinterDataRequirements,
  type LinterMeta,
} from "./base.ts";

// Registry
export {
  register,
  registerLinter,
  registry,
  runLinter,
  runLinters,
  type RunOptions,
} from "./registry.ts";

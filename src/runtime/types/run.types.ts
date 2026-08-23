/**
 * What a run takes.
 *
 * Lived at the root of `mod.ts`, which meant the runtime could not name the
 * type the runtime consumes, and anything under `src/` resolving a config had
 * to hand back an untyped bag for `mod.ts` to cast.
 *
 * @module
 */

import type { Frozen } from "@hiisi/flash-freeze";
import type { IssueCatalog } from "../../config/types.ts";
import type { Rule } from "../../config/types/builder.types.ts";
import type { CrawlConfig } from "../../data/types.ts";
import type { GrammarRegistry } from "../../grammars/registry.ts";
import type { GrammarRelationshipRule } from "../../grammars/resolver.ts";
import type { RunOptions } from "../../linters/registry.ts";

/**
 * Options for running viola.
 */
export interface ViolaOptions
  extends Partial<CrawlConfig>, Partial<RunOptions> {
  /** Plugin specifiers to load (JSR, npm, URL, or import map references) */
  plugins?: string[];
  /** Preset names to inherit from loaded plugins */
  inherit?: string[];
  /** Per-linter configuration options (merged with preset configs) */
  linterConfig?: Record<string, Record<string, unknown>>;
  /** Rules for classifying issues (from builder config) */
  rules?: readonly Frozen<Rule>[];
  /** Issue catalogs for rule evaluation (linter ID -> catalog) */
  catalogs?: Map<string, IssueCatalog>;
  /** Grammar registry for tree-sitter based extraction (required) */
  grammarRegistry: GrammarRegistry;
  /**
   * Grammar relationship rules, from `grammar("a").overrides("b")` in the
   * config.
   *
   * Without these every grammar matching a file runs as a primary, which is
   * what happened to every run before this was passed: the rules were
   * collected by the builder and read by nobody, so the feature was in the
   * readme and not in the product.
   */
  grammarRules?: readonly GrammarRelationshipRule[];
  /** What the environment is, for conditions that ask about it. */
  env?: Readonly<Record<string, string | undefined>>;
}

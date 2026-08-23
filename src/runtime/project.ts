//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Running viola over a project, from its config to its verdict.
 *
 * This is what a front end does, and it lived in the cli, which meant nothing
 * else could do it. The cli is argument parsing and a subprocess that bridges a
 * foreign project's import map; the run itself is library work and belongs
 * here. viola's own gate calls this directly, so the gate and the cli provably
 * execute the same path rather than two that are meant to agree.
 *
 * @module
 */

import { loadConfig } from "../config/loader.ts";
import type { IssueCatalog } from "../config/types.ts";
import type { ViolaBuilderConfigExtended } from "../config/builder.ts";
import { createGrammarRegistry } from "../grammars/registry.ts";
import type { BaseLinter } from "../linters/base.ts";
import { registry } from "../linters/registry.ts";
import type { ViolaOptions } from "./types/run.types.ts";

/**
 * Where viola looks when a project has not said.
 *
 * One list. It was written out twice in two different orders, which is two
 * defaults that agree by coincidence.
 */
export const DEFAULT_INCLUDE: readonly string[] = ["src", "packages", "app"];

/** What a project run needs to know that its config does not say. */
export interface ProjectRunOptions {
  /** Where the project is. Defaults to the current directory. */
  readonly projectRoot?: string;
  /** Directories and files to read. Overrides the config's own list. */
  readonly include?: readonly string[];
  /** A config file somewhere other than `viola.config.ts`. */
  readonly configPath?: string;
  /** Only these linters. */
  readonly only?: readonly string[];
  /** Everything but these linters. */
  readonly skip?: readonly string[];
  /** Report findings without failing the run. */
  readonly reportOnly?: boolean;
  /** Say what is happening while it happens. */
  readonly verbose?: boolean;
  /** Run linters concurrently. */
  readonly parallel?: boolean;
  /** A config module already imported, for a caller that had to load it. */
  readonly preloadedConfig?: unknown;
  /** The environment, for conditions that ask about it. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Let a run that read no files pass.
   *
   * Off by default, because a run that scanned nothing reports "All clear" and
   * that is a false clean bill on a package nobody checked. Only a project
   * that genuinely has nothing to lint yet should say so out loud.
   */
  readonly allowEmpty?: boolean;
}

/**
 * Register a builder's linters and collect what each one can report.
 *
 * The catalog is how a rule about impact or category reaches a finding that
 * carries neither, so registering without collecting leaves every such rule
 * unable to match.
 */
export function registerBuilderLinters(
  linters: readonly BaseLinter[],
): Map<string, IssueCatalog> {
  for (const linter of linters) {
    registry.register(linter);
  }
  return catalogsOf(linters);
}

/**
 * What each of these linters can report, keyed by which linter reports it.
 *
 * Collecting them was written out twice, once over a builder's linters and
 * once over the registry's. The difference is where the linters come from.
 */
export function catalogsOf(
  linters: readonly BaseLinter[],
): Map<string, IssueCatalog> {
  const catalogs = new Map<string, IssueCatalog>();
  for (const linter of linters) {
    if (linter.catalog) {
      catalogs.set(linter.meta.id, linter.catalog);
    }
  }
  return catalogs;
}

/** What a project run needs handed to `runViola`, once the config is read. */
export interface ResolvedRun {
  readonly options: ViolaOptions;
  readonly builderConfig?: ViolaBuilderConfigExtended;
}

/**
 * Turn a project's config into the options a run takes.
 *
 * Separated from running it so a caller can inspect what was resolved, which
 * is what the cli's `--list` does and what a test needs to assert against.
 */
export async function resolveRun(
  options: ProjectRunOptions = {},
): Promise<ResolvedRun> {
  const projectRoot = options.projectRoot ?? Deno.cwd();
  const { config, builderConfig } = await loadConfig(projectRoot, {
    verbose: options.verbose,
    ...(options.configPath === undefined
      ? {}
      : { configPath: options.configPath }),
    ...(options.preloadedConfig === undefined
      ? {}
      : { preloadedModule: options.preloadedConfig }),
  });

  const include = options.include ??
    (config.include.length > 0 ? config.include : DEFAULT_INCLUDE);

  const linters = builderConfig?.linters ?? [];
  const catalogs = linters.length > 0
    ? registerBuilderLinters(linters)
    : undefined;

  return {
    builderConfig,
    options: {
      projectRoot,
      include: [...include],
      plugins: linters.length > 0 ? [] : config.plugins,
      inherit: config.inherit,
      linterConfig: config.linterConfig,
      reportOnly: options.reportOnly ?? false,
      verbose: options.verbose ?? false,
      parallel: options.parallel ?? false,
      ...(options.only === undefined ? {} : { only: [...options.only] }),
      ...(options.skip === undefined ? {} : { skip: [...options.skip] }),
      ...(catalogs === undefined ? {} : { catalogs }),
      ...(builderConfig?.rules === undefined
        ? {}
        : { rules: builderConfig.rules }),
      grammarRules: builderConfig?.grammarRules ?? [],
      grammarRegistry: builderConfig?.grammarRegistry ??
        createGrammarRegistry(),
      ...(options.env === undefined ? {} : { env: options.env }),
    },
  };
}

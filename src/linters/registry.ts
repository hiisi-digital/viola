/**
 * Viola Linter Registry
 *
 * Central registry for all linters. The runtime uses this to discover
 * and run linters.
 *
 * @module
 */

import type {
  CodebaseData,
  LinterConfig,
  LinterResult,
  LintResults,
} from "../data/types.ts";
import type { BaseLinter, LinterConstructor, LinterMeta } from "./base.ts";
import type { RunOptions } from "./types/registry.types.ts";

// Re-export types for convenience
export type { RunOptions } from "./types/registry.types.ts";

// =============================================================================
// Registry
// =============================================================================

/**
 * Registry of all available linters.
 */
export class LinterRegistry {
  private readonly linters = new Map<string, BaseLinter>();

  /**
   * Register a linter.
   *
   * @param linter - Linter instance or constructor
   */
  register(linter: BaseLinter | LinterConstructor): void {
    const instance = typeof linter === "function" ? new linter() : linter;
    const id = instance.meta.id;

    if (this.linters.has(id)) {
      throw new Error(`Linter "${id}" is already registered`);
    }

    this.linters.set(id, instance);
  }

  /**
   * Register multiple linters.
   *
   * @param linters - Linter instances or constructors
   */
  registerAll(linters: Array<BaseLinter | LinterConstructor>): void {
    for (const linter of linters) {
      this.register(linter);
    }
  }

  /**
   * Get a linter by ID.
   *
   * @param id - Linter ID
   * @returns Linter instance or undefined
   */
  get(id: string): BaseLinter | undefined {
    return this.linters.get(id);
  }

  /**
   * Check if a linter is registered.
   *
   * @param id - Linter ID
   * @returns True if registered
   */
  has(id: string): boolean {
    return this.linters.has(id);
  }

  /**
   * Get all registered linters.
   *
   * @returns Array of linter instances
   */
  getAll(): BaseLinter[] {
    return Array.from(this.linters.values());
  }

  /**
   * Get all linter IDs.
   *
   * @returns Array of linter IDs
   */
  getIds(): string[] {
    return Array.from(this.linters.keys());
  }

  /**
   * Get metadata for all registered linters.
   *
   * @returns Array of linter metadata
   */
  getAllMeta(): LinterMeta[] {
    return this.getAll().map((l) => l.meta);
  }

  /**
   * Unregister a linter.
   *
   * @param id - Linter ID
   * @returns True if linter was removed
   */
  unregister(id: string): boolean {
    return this.linters.delete(id);
  }

  /**
   * Clear all registered linters.
   */
  clear(): void {
    this.linters.clear();
  }

  /**
   * Get the number of registered linters.
   */
  get size(): number {
    return this.linters.size;
  }
}

// =============================================================================
// Global Registry
// =============================================================================

/**
 * Global linter registry instance.
 */
export const registry: LinterRegistry = new LinterRegistry();

// =============================================================================
// Runner
// =============================================================================

/**
 * Default linter configuration.
 */
const DEFAULT_LINTER_CONFIG: LinterConfig = {
  enabled: true,
};

/**
 * Run all registered linters against the codebase data.
 *
 * @param data - Frozen codebase data
 * @param options - Run options
 * @returns Aggregated lint results
 */
export async function runLinters(
  data: Readonly<CodebaseData>,
  options: RunOptions = {},
): Promise<LintResults> {
  const startTime = performance.now();
  const results: LinterResult[] = [];

  // Determine which linters to run
  let lintersToRun = (options.registry ?? registry).getAll();

  if (options.only && options.only.length > 0) {
    lintersToRun = lintersToRun.filter((l) =>
      options.only!.includes(l.meta.id)
    );
  }

  if (options.skip && options.skip.length > 0) {
    lintersToRun = lintersToRun.filter((l) =>
      !options.skip!.includes(l.meta.id)
    );
  }

  // Filter out disabled linters
  lintersToRun = lintersToRun.filter((linter) => {
    const config = options.config?.[linter.meta.id] ?? DEFAULT_LINTER_CONFIG;
    return config.enabled;
  });

  // Run linters
  if (options.parallel) {
    // Run in parallel
    const promises = lintersToRun.map((linter) => {
      const config = options.config?.[linter.meta.id] ?? DEFAULT_LINTER_CONFIG;
      return Promise.resolve(linter.run(data, config));
    });
    results.push(...(await Promise.all(promises)));
  } else {
    // Run sequentially
    for (const linter of lintersToRun) {
      const config = options.config?.[linter.meta.id] ?? DEFAULT_LINTER_CONFIG;
      if (options.verbose) {
        console.log(`Running linter: ${linter.meta.id}...`);
      }
      const result = await linter.run(data, config);
      results.push(result);
      if (options.verbose) {
        console.log(
          `  ${result.issues.length} issues in ${
            result.durationMs.toFixed(1)
          }ms`,
        );
      }
    }
  }

  // Aggregate results
  const totalDurationMs = performance.now() - startTime;
  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);

  return {
    results,
    totalIssues,
    totalDurationMs,
    hasErrors: results.some((r) => !r.success),
    filesScanned: data.files.length,
  };
}

/**
 * Run a single linter by ID.
 *
 * @param id - Linter ID
 * @param data - Frozen codebase data
 * @param config - Linter configuration
 * @returns Linter result
 */
export function runLinter(
  id: string,
  data: Readonly<CodebaseData>,
  config: LinterConfig = DEFAULT_LINTER_CONFIG,
): Promise<LinterResult> {
  const linter = registry.get(id);

  if (!linter) {
    return Promise.resolve({
      linter: id,
      issues: [],
      durationMs: 0,
      success: false,
      error: `Linter "${id}" not found`,
    });
  }

  return linter.run(data, config);
}

// =============================================================================
// Registration Helpers
// =============================================================================

/**
 * Decorator to register a linter class with the global registry.
 *
 * @example
 * ```ts
 * @registerLinter
 * class MyLinter extends BaseLinter { ... }
 * ```
 */
export function registerLinter<T extends LinterConstructor>(constructor: T): T {
  registry.register(constructor);
  return constructor;
}

/**
 * Create and register a linter instance.
 *
 * @param linter - Linter instance
 * @returns The same linter instance
 */
export function register<T extends BaseLinter>(linter: T): T {
  registry.register(linter);
  return linter;
}

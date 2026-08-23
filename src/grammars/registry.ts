/**
 * Grammar Registry
 *
 * Manages registered grammars, their aliases, and relationships.
 * The registry is the central store for all grammar definitions
 * that have been added to a viola configuration.
 *
 * @module
 */

import type { GrammarDefinition, RegisteredGrammar } from "./types.ts";

// =============================================================================
// Types
// =============================================================================

/**
 * A registered grammar entry with its resolved alias.
 */
export interface GrammarEntry {
  /** The grammar definition */
  readonly definition: GrammarDefinition;
  /** The alias used to reference this grammar (defaults to grammar id) */
  readonly alias: string;
  /** Pattern overrides from registration */
  readonly matchOverrides?: RegisteredGrammar["matchOverrides"];
}

/**
 * Result of adding a grammar, allowing chained `.as()` call.
 */
export interface GrammarAddResult {
  /**
   * Set an alias for this grammar.
   * The alias is used to reference the grammar in rules.
   *
   * @param alias - The alias name
   * @returns The registry for chaining
   *
   * @example
   * registry.add(typescript).as("ts");
   */
  as(alias: string): GrammarRegistry;
}

// =============================================================================
// Registry Implementation
// =============================================================================

/**
 * Registry for managing grammar definitions.
 *
 * Grammars are registered with optional aliases and can be looked up
 * by alias or grammar ID.
 *
 * @example
 * ```ts
 * const registry = new GrammarRegistry();
 * registry.add(typescript).as("ts");
 * registry.add(javascript).as("js");
 *
 * const ts = registry.get("ts");
 * const allGrammars = registry.all();
 * ```
 */
export class GrammarRegistry {
  /** Map of alias -> grammar entry */
  private readonly entries = new Map<string, GrammarEntry>();

  /** Track the last added grammar for .as() chaining */
  private lastAddedAlias: string | null = null;

  /**
   * Register a grammar definition.
   *
   * If no alias is provided via `.as()`, the grammar's `meta.id` is used.
   *
   * @param grammar - The grammar definition to register
   * @returns An object with `.as()` method for setting an alias
   *
   * @example
   * ```ts
   * registry.add(typescript);  // alias defaults to "typescript"
   * registry.add(javascript).as("js");  // explicit alias
   * ```
   */
  add(grammar: GrammarDefinition): GrammarAddResult {
    const defaultAlias = grammar.meta.id;

    // Register with default alias
    this.entries.set(defaultAlias, {
      definition: grammar,
      alias: defaultAlias,
    });
    this.lastAddedAlias = defaultAlias;

    // Return builder for optional .as() call
    return {
      as: (alias: string): GrammarRegistry => {
        if (this.lastAddedAlias === null) {
          throw new Error("No grammar to alias");
        }

        // Get the entry registered with default alias
        const entry = this.entries.get(this.lastAddedAlias);
        if (!entry) {
          throw new Error(`Grammar not found: ${this.lastAddedAlias}`);
        }

        // Remove old entry if alias is different
        if (alias !== this.lastAddedAlias) {
          this.entries.delete(this.lastAddedAlias);
        }

        // Re-register with new alias
        this.entries.set(alias, {
          ...entry,
          alias,
        });

        this.lastAddedAlias = null;
        return this;
      },
    };
  }

  /**
   * Get a grammar by its alias.
   *
   * @param alias - The grammar alias
   * @returns The grammar entry, or undefined if not found
   */
  get(alias: string): GrammarEntry | undefined {
    return this.entries.get(alias);
  }

  /**
   * Check if a grammar with the given alias exists.
   *
   * @param alias - The grammar alias
   */
  has(alias: string): boolean {
    return this.entries.has(alias);
  }

  /**
   * Get all registered grammars.
   *
   * @returns Array of all grammar entries
   */
  all(): readonly GrammarEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get all grammar aliases.
   *
   * @returns Array of all registered aliases
   */
  aliases(): readonly string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Find grammars that match a file path based on extensions and globs.
   *
   * @param filePath - The file path to match
   * @returns Array of matching grammar entries
   */
  findMatchingGrammars(filePath: string): readonly GrammarEntry[] {
    const extension = this.getExtension(filePath);
    const matches: GrammarEntry[] = [];

    for (const entry of this.entries.values()) {
      const meta = entry.definition.meta;
      const overrides = entry.matchOverrides;

      // Check if we should use override patterns
      if (overrides?.only) {
        // Only use specified patterns
        if (this.matchesPatterns(filePath, overrides.only)) {
          matches.push(entry);
        }
        continue;
      }

      let matched = false;

      // Check extensions
      if (meta.extensions.includes(extension)) {
        matched = true;
      }

      // Check globs if defined
      if (!matched && meta.globs) {
        if (this.matchesPatterns(filePath, meta.globs)) {
          matched = true;
        }
      }

      // Check added patterns from overrides
      if (!matched && overrides?.add) {
        if (this.matchesPatterns(filePath, overrides.add)) {
          matched = true;
        }
      }

      // Check if matched but should be removed
      if (matched && overrides?.remove) {
        if (this.matchesPatterns(filePath, overrides.remove)) {
          matched = false;
        }
      }

      if (matched) {
        matches.push(entry);
      }
    }

    return matches;
  }

  /**
   * Get the number of registered grammars.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Get all file extensions registered across all grammars.
   *
   * @returns Array of unique extensions (e.g., [".ts", ".tsx", ".sh"])
   */
  allExtensions(): readonly string[] {
    const extensions = new Set<string>();
    for (const entry of this.entries.values()) {
      for (const ext of entry.definition.meta.extensions) {
        extensions.add(ext);
      }
    }
    return Array.from(extensions);
  }

  /**
   * Clear all registered grammars.
   */
  clear(): void {
    this.entries.clear();
    this.lastAddedAlias = null;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Extract file extension from path.
   */
  private getExtension(filePath: string): string {
    const lastSlash = Math.max(
      filePath.lastIndexOf("/"),
      filePath.lastIndexOf("\\"),
    );
    const filename = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
    const dotIndex = filename.lastIndexOf(".");
    return dotIndex >= 0 ? filename.slice(dotIndex) : "";
  }

  /**
   * Check if a file path matches any of the given patterns.
   */
  private matchesPatterns(
    filePath: string,
    patterns: readonly string[],
  ): boolean {
    for (const pattern of patterns) {
      if (this.matchGlob(pattern, filePath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Simple glob matching for file patterns.
   * Supports *, **, and ? wildcards.
   */
  private matchGlob(pattern: string, path: string): boolean {
    // Handle exact match for files without wildcards (like ".bashrc")
    if (!pattern.includes("*") && !pattern.includes("?")) {
      return path === pattern || path.endsWith("/" + pattern);
    }

    // Convert glob to regex
    let regexPattern = "";
    let i = 0;

    while (i < pattern.length) {
      const char = pattern[i] as string;
      const nextChar = pattern[i + 1] as string | undefined;

      if (char === "*" && nextChar === "*") {
        const afterStars = pattern[i + 2] as string | undefined;
        if (afterStars === "/" || afterStars === undefined) {
          regexPattern += afterStars === "/" ? "(?:.*/)?" : ".*";
          i += afterStars === "/" ? 3 : 2;
        } else {
          regexPattern += ".*";
          i += 2;
        }
      } else if (char === "*") {
        regexPattern += "[^/]*";
        i++;
      } else if (char === "?") {
        regexPattern += "[^/]";
        i++;
      } else if (".+^${}()|[]\\".includes(char)) {
        regexPattern += "\\" + char;
        i++;
      } else {
        regexPattern += char;
        i++;
      }
    }

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }
}

/**
 * Create a new grammar registry.
 *
 * @returns A new empty registry
 */
export function createGrammarRegistry(): GrammarRegistry {
  return new GrammarRegistry();
}

//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Viola Crawler
 *
 * Single-pass code analyzer that extracts all relevant data from the codebase.
 * This is the heart of viola - it crawls once and provides immutable data to all linters.
 *
 * Requires at least one grammar to be registered. All code extraction is performed
 * using tree-sitter grammars: files without a matching grammar are skipped.
 *
 * @module
 */

import { deepFreeze } from "@hiisi/flash-freeze";
import { walk } from "@std/fs/walk";
import { basename, extname, join, relative } from "@std/path";
import type {
  CodebaseData,
  CrawlConfig,
  FileInfo,
  SchemaInfo,
} from "../data/types.ts";
import {
  createParser,
  extractCompleteFileInfo,
  type GrammarRegistry,
  type GrammarRelationshipRule,
  GrammarResolver,
  type GrammarRole,
  initTreeSitter,
  loadGrammar,
  mergeExtractionResults,
} from "../grammars/mod.ts";

/**
 * Fold several grammars' readings of one file into one.
 *
 * The first extraction is the file itself: its path, its size, its content,
 * and the grammar that is answering for it. Everything a grammar found is
 * merged by position, so a supplement contributes what the grammar it
 * supplements did not find at that line and never a second copy of what it
 * did. That rule lives in `mergeExtractionResults` because the resolver is
 * what knows what a role means.
 */
function mergeFileInfo(
  extractions: ReadonlyArray<{ data: FileInfo; role: GrammarRole }>,
): FileInfo {
  const first = extractions[0]!.data;
  if (extractions.length === 1) return first;

  // Spelled out per field rather than folded over a key union, because each
  // field carries a different item type and `mergeExtractionResults` is
  // generic over one of them at a time.
  const roles = extractions.map(({ role }) => role);
  const items = <T>(pick: (data: FileInfo) => readonly T[]) =>
    extractions.map(({ data }, i) => ({ items: pick(data), role: roles[i]! }));

  return {
    ...first,
    functions: mergeExtractionResults(items((d) => d.functions)),
    types: mergeExtractionResults(items((d) => d.types)),
    strings: mergeExtractionResults(items((d) => d.strings)),
    exports: mergeExtractionResults(items((d) => d.exports)),
    imports: mergeExtractionResults(items((d) => d.imports)),
  };
}

/** A quoted string in a type body, single or double quoted. */
const QUOTED = /(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;

/**
 * Every string the codebase declares as part of a type.
 *
 * Read off the raw body of each declaration, which is where a string-literal
 * union keeps its members and a string enum keeps its values. Reading the text
 * rather than a parse of it is deliberate: a union member, an enum value, a
 * literal type and an indexed access all spell the string the same way, and
 * the question here is only whether the codebase named it, not what shape
 * named it.
 *
 * The cost of being wrong is one direction only. A string wrongly included is
 * one duplicate-string finding not reported; a string wrongly excluded cannot
 * happen, since nothing is added that the source did not write inside a type.
 */
function declaredVocabulary(
  types: readonly { readonly body: string }[],
): ReadonlySet<string> {
  const vocabulary = new Set<string>();
  for (const type of types) {
    for (const match of type.body.matchAll(QUOTED)) {
      const value = match[1] ?? match[2];
      if (value !== undefined && value !== "") vocabulary.add(value);
    }
  }
  return vocabulary;
}

// =============================================================================
// Schema Extraction
// =============================================================================

/**
 * Extract schema information from a JSON schema file.
 */
async function extractSchemaData(filePath: string): Promise<SchemaInfo | null> {
  try {
    const content = await Deno.readTextFile(filePath);
    const schema = JSON.parse(content);

    // Check if it's actually a JSON Schema
    if (!schema.$schema && !schema.type && !schema.properties) {
      return null;
    }

    const name = basename(filePath, ".schema.json").replace(".json", "");

    return {
      file: filePath,
      name,
      title: schema.$title || schema.title,
      description: schema.description,
      rootType: schema.type,
      properties: schema.properties ? Object.keys(schema.properties) : [],
      required: schema.required || [],
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Main Crawler
// =============================================================================

/**
 * Default configuration for the crawler.
 */
export const DEFAULT_CONFIG: Partial<CrawlConfig> = {
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"],
  exclude: [
    /node_modules/,
    /\.git/,
    /_fresh/,
    /target/,
    /dist/,
    /build/,
    /coverage/,
    /\.d\.ts$/,
  ],
};

/**
 * Crawl the codebase and extract all relevant data.
 *
 * Requires a grammar registry with at least one grammar registered.
 * Files without a matching grammar are skipped (with a verbose warning).
 * Grammar extraction failures also skip the file.
 *
 * @param config - Crawler configuration
 * @param grammarRegistry - Registry of grammars for extraction (required)
 * @returns Frozen codebase data
 * @throws Error if no grammars are registered
 */
export async function crawlCodebase(
  config: CrawlConfig,
  grammarRegistry: GrammarRegistry,
  grammarRules: readonly GrammarRelationshipRule[] = [],
  run: {
    env?: Readonly<Record<string, string | undefined>>;
    projectRoot?: string;
  } = {},
): Promise<Readonly<CodebaseData>> {
  // Validate grammar registration
  if (grammarRegistry.size === 0) {
    throw new Error(
      "No grammars registered. Viola requires at least one grammar " +
        "(e.g., @hiisi/viola-grammar-ts) to extract code data. " +
        "Register grammars using builder.add(grammar).as(alias) in your config.",
    );
  }

  // What decides which of several matching grammars run, and in what order.
  // Without the rules this is every match as a primary, which is what the
  // registry alone would have said, so a project with no relationships pays
  // nothing for this.
  const resolver = new GrammarResolver(grammarRegistry, grammarRules);
  const env = run.env ?? {};
  const projectRoot = run.projectRoot ?? config.projectRoot;

  // Build extension filter from grammar registry
  const baseExtensions = config.extensions.length > 0
    ? config.extensions
    : DEFAULT_CONFIG.extensions!;
  const extensions = [...baseExtensions];
  for (const ext of grammarRegistry.allExtensions()) {
    if (!extensions.includes(ext)) {
      extensions.push(ext);
    }
  }

  const excludePatterns = [
    ...(config.exclude || []),
    ...(DEFAULT_CONFIG.exclude || []),
  ];

  // Initialize tree-sitter
  await initTreeSitter();
  if (config.verbose) {
    console.log(
      `Tree-sitter initialized with ${grammarRegistry.size} grammar(s)`,
    );
  }

  const files: FileInfo[] = [];
  const schemas: SchemaInfo[] = [];
  let skippedCount = 0;

  // Crawl source files
  for (const includeDir of config.include) {
    const fullPath = join(config.projectRoot, includeDir);

    try {
      for await (
        const entry of walk(fullPath, {
          exts: extensions.map((e) => e.replace(/^\./, "")),
          // Only the two directories it is worth not descending into, and
          // both anchored on separators.
          //
          // The exclude patterns cannot go here. `walk` tests them against the
          // absolute path, and a pattern like `dist` then matches any
          // *ancestor* directory of the project as readily as a directory
          // inside it: `deno-dist` excluded its own entire tree, reported
          // "Files scanned: 0", and said "All clear". A checkout under
          // `~/build/` would have done the same to any project.
          //
          // They are applied below instead, against the path relative to the
          // project root, which is the only path the project has any say over.
          skip: [/[/\\]node_modules[/\\]/, /[/\\]\.git[/\\]/],
        })
      ) {
        if (!entry.isFile) continue;

        const relativePath = relative(config.projectRoot, entry.path);
        if (excludePatterns.some((p) => p.test(relativePath))) continue;

        try {
          const content = await Deno.readTextFile(entry.path);

          const ext = extname(entry.path);

          // Which grammars run for this file, and in what role. An override
          // suppresses what it overrides; a supplement runs after the grammar
          // it supplements and fills in what that one did not find.
          const resolution = resolver.resolve(relativePath, {
            file: { path: relativePath, extension: ext, grammarId: "" },
            env,
            projectRoot,
          });

          if (config.verbose && resolution.grammars.length > 0) {
            // Which grammar answered, and what it suppressed. Debugging a
            // grammar relationship without this means guessing, and it is the
            // only place the resolution is observable from outside.
            const ran = resolution.grammars
              .map(({ entry: g, role }) => `${g.alias}=${role}`)
              .join(" ");
            const gone = resolution.suppressed
              .map(({ entry: g }) => g.alias)
              .join(" ");
            console.log(
              `grammars for ${relativePath}: ${ran}` +
                (gone === "" ? "" : ` (suppressed ${gone})`),
            );
          }

          if (resolution.grammars.length === 0) {
            skippedCount++;
            if (config.verbose) {
              console.warn(`No grammar matches ${relativePath}, skipping`);
            }
            continue;
          }

          const extractions: Array<
            { data: FileInfo; role: GrammarRole }
          > = [];
          for (const { entry: grammarEntry, role } of resolution.grammars) {
            try {
              const language = await loadGrammar(
                grammarEntry.definition.grammar,
              );
              const parser = createParser(
                grammarEntry.definition.grammar,
                language,
              );
              const tree = parser.parse(content);
              extractions.push({
                data: extractCompleteFileInfo(
                  tree,
                  language,
                  grammarEntry.definition,
                  relativePath,
                  ext,
                  content,
                  grammarEntry.alias,
                ),
                role,
              });
            } catch (grammarErr) {
              // One grammar failing does not lose the others. That is the
              // point of resolving several: a supplement can still answer.
              if (config.verbose) {
                console.error(
                  `Grammar ${grammarEntry.alias} failed on ${entry.path}:`,
                  grammarErr,
                );
              }
            }
          }

          if (extractions.length === 0) {
            skippedCount++;
            if (config.verbose) {
              console.error(
                `Every grammar failed on ${entry.path}, skipping`,
              );
            }
            continue;
          }

          files.push(mergeFileInfo(extractions));
        } catch (err) {
          if (config.verbose) {
            console.error(`Error reading ${entry.path}:`, err);
          }
        }
      }
    } catch (err) {
      if (config.verbose) {
        console.error(`Error walking ${fullPath}:`, err);
      }
    }
  }

  if (skippedCount > 0 && config.verbose) {
    console.log(`Skipped ${skippedCount} file(s) without matching grammar`);
  }

  // Crawl JSON schemas
  for (const includeDir of config.include) {
    const fullPath = join(config.projectRoot, includeDir);

    try {
      for await (
        const entry of walk(fullPath, {
          exts: ["json"],
          skip: excludePatterns,
          match: [/\.schema\.json$/, /schemas?\//],
        })
      ) {
        if (!entry.isFile) continue;

        const schemaData = await extractSchemaData(entry.path);
        if (schemaData) {
          schemas.push(schemaData);
        }
      }
    } catch {
      // Ignore errors for schema crawling
    }
  }

  // Aggregate views
  const allFunctions = files.flatMap((f) => f.functions);
  const allTypes = files.flatMap((f) => f.types);
  const allStrings = files.flatMap((f) => f.strings);
  const allExports = files.flatMap((f) => f.exports);
  const allImports = files.flatMap((f) => f.imports);

  const data: CodebaseData = {
    projectRoot: config.projectRoot,
    files,
    schemas,
    extractedAt: Date.now(),
    allFunctions,
    allTypes,
    allStrings,
    allExports,
    allImports,
    literalVocabulary: declaredVocabulary(allTypes),
  };

  // Freeze everything before returning
  return deepFreeze(data);
}

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
    FileInfo,
    SchemaInfo,
    ViolaConfig
} from "../data/types.ts";
import {
    extractCompleteFileInfo,
    type GrammarRegistry,
    initTreeSitter,
    loadGrammar,
    createParser,
} from "../grammars/mod.ts";

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
export const DEFAULT_CONFIG: Partial<ViolaConfig> = {
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
  config: ViolaConfig,
  grammarRegistry: GrammarRegistry
): Promise<Readonly<CodebaseData>> {
  // Validate grammar registration
  if (grammarRegistry.size === 0) {
    throw new Error(
      "No grammars registered. Viola requires at least one grammar " +
      "(e.g., @hiisi/viola-grammar-ts) to extract code data. " +
      "Register grammars using builder.add(grammar).as(alias) in your config."
    );
  }

  // Build extension filter from grammar registry
  const baseExtensions = config.extensions.length > 0 ? config.extensions : DEFAULT_CONFIG.extensions!;
  const extensions = [...baseExtensions];
  for (const ext of grammarRegistry.allExtensions()) {
    if (!extensions.includes(ext)) {
      extensions.push(ext);
    }
  }

  const excludePatterns = [...(config.exclude || []), ...(DEFAULT_CONFIG.exclude || [])];

  // Initialize tree-sitter
  await initTreeSitter();
  if (config.verbose) {
    console.log(`Tree-sitter initialized with ${grammarRegistry.size} grammar(s)`);
  }

  const files: FileInfo[] = [];
  const schemas: SchemaInfo[] = [];
  let skippedCount = 0;

  // Crawl source files
  for (const includeDir of config.include) {
    const fullPath = join(config.projectRoot, includeDir);

    try {
      for await (const entry of walk(fullPath, {
        exts: extensions.map((e) => e.replace(/^\./, "")),
        skip: excludePatterns,
      })) {
        if (!entry.isFile) continue;

        // Additional exclusion check
        const relativePath = relative(config.projectRoot, entry.path);
        if (excludePatterns.some((p) => p.test(relativePath))) continue;

        try {
          const content = await Deno.readTextFile(entry.path);

          // Find matching grammar for this file
          const matchingGrammars = grammarRegistry.findMatchingGrammars(relativePath);

          if (matchingGrammars.length === 0) {
            // No grammar matches this file: skip it
            skippedCount++;
            if (config.verbose) {
              console.warn(`No grammar matches ${relativePath}, skipping`);
            }
            continue;
          }

          // Tree-sitter extraction
          const grammarEntry = matchingGrammars[0]!;
          const ext = extname(entry.path);

          try {
            const language = await loadGrammar(grammarEntry.definition.grammar);
            const parser = createParser(grammarEntry.definition.grammar, language);
            const tree = parser.parse(content);
            const fileData = extractCompleteFileInfo(
              tree, language, grammarEntry.definition,
              relativePath, ext, content
            );
            files.push(fileData);
          } catch (grammarErr) {
            // Grammar extraction failed: skip this file
            skippedCount++;
            if (config.verbose) {
              console.error(`Grammar extraction failed for ${entry.path}, skipping:`, grammarErr);
            }
          }
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
      for await (const entry of walk(fullPath, {
        exts: ["json"],
        skip: excludePatterns,
        match: [/\.schema\.json$/, /schemas?\//],
      })) {
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
  };

  // Freeze everything before returning
  return deepFreeze(data);
}

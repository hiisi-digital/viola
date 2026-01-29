#!/usr/bin/env -S deno run -A
/**
 * Viola CLI
 *
 * Command-line interface for running viola linters.
 *
 * Usage:
 *   deno run -A cli.ts [options]
 *
 * Options:
 *   --help, -h           Show help
 *   --report-only, -r    Report violations without failing
 *   --verbose, -v        Verbose output
 *   --only <linters>     Only run specified linters (comma-separated)
 *   --skip <linters>     Skip specified linters (comma-separated)
 *   --list               List all available linters
 *   --include <dirs>     Directories to include (comma-separated)
 *   --project <path>     Project root directory (default: cwd)
 *
 * @module
 */

import { parseArgs } from "@std/cli/parse-args";
import { dirname, fromFileUrl, join } from "@std/path";

import { formatResults, registry, runViola, type ViolaOptions } from "./mod.ts";

// =============================================================================
// CLI Arguments
// =============================================================================

const args = parseArgs(Deno.args, {
  boolean: ["help", "report-only", "verbose", "list", "parallel"],
  string: ["only", "skip", "include", "project"],
  alias: {
    h: "help",
    r: "report-only",
    v: "verbose",
    l: "list",
    p: "project",
    i: "include",
  },
  default: {
    "report-only": false,
    verbose: false,
    parallel: false,
  },
});

// =============================================================================
// Help
// =============================================================================

function showHelp(): void {
  console.log(`
Viola - Violation Detection for Muse

A unified lint runtime that crawls the codebase once and provides
immutable data to multiple linters.

USAGE:
  deno run -A viola/cli.ts [options]
  deno task lint:viola [options]

OPTIONS:
  --help, -h           Show this help message
  --report-only, -r    Report violations without failing (exit code 0)
  --verbose, -v        Verbose output
  --parallel           Run linters in parallel
  --only <linters>     Only run specified linters (comma-separated)
  --skip <linters>     Skip specified linters (comma-separated)
  --list, -l           List all available linters
  --include, -i <dirs> Directories to include (comma-separated)
  --project, -p <path> Project root directory (default: cwd)

EXAMPLES:
  # Run all linters
  deno run -A viola/cli.ts

  # Report only, don't fail
  deno run -A viola/cli.ts --report-only

  # Run specific linters
  deno run -A viola/cli.ts --only type-location,similar-functions

  # Skip certain linters
  deno run -A viola/cli.ts --skip duplicate-strings

  # Verbose output
  deno run -A viola/cli.ts --verbose

  # Specify project root
  deno run -A viola/cli.ts --project /path/to/project

BUILT-IN LINTERS:
`);

  // List built-in linters
  for (const linter of registry.getAll()) {
    console.log(`  ${linter.meta.id}`);
    console.log(`    ${linter.meta.description}`);
    console.log(`    Default severity: ${linter.meta.defaultSeverity}`);
    console.log();
  }
}

// =============================================================================
// List Linters
// =============================================================================

function listLinters(): void {
  console.log("\nAvailable Linters:\n");

  const linters = registry.getAll();
  const maxIdLen = Math.max(...linters.map((l) => l.meta.id.length));

  for (const linter of linters) {
    const id = linter.meta.id.padEnd(maxIdLen);
    const sev = linter.meta.defaultSeverity.padEnd(7);
    console.log(`  ${id}  [${sev}]  ${linter.meta.description}`);
  }

  console.log(`\nTotal: ${linters.length} linters\n`);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  // Handle help
  if (args.help) {
    showHelp();
    Deno.exit(0);
  }

  // Handle list
  if (args.list) {
    listLinters();
    Deno.exit(0);
  }

  // Determine project root
  let projectRoot = args.project;
  if (!projectRoot) {
    // Try to find project root by looking for deno.json
    const __dirname = dirname(fromFileUrl(import.meta.url));
    projectRoot = join(__dirname, "../.."); // Assumes viola is in packages/viola
  }

  // Parse include directories
  const include = args.include
    ? args.include.split(",").map((s: string) => s.trim())
    : ["packages", "app"];

  // Parse only/skip linters
  const only = args.only
    ? args.only.split(",").map((s: string) => s.trim())
    : undefined;

  const skip = args.skip
    ? args.skip.split(",").map((s: string) => s.trim())
    : undefined;

  // Build options
  const options: ViolaOptions = {
    projectRoot,
    include,
    reportOnly: args["report-only"],
    verbose: args.verbose,
    parallel: args.parallel,
    only,
    skip,
  };

  // Print header
  console.log("\n" + "=".repeat(80));
  console.log("VIOLA - Violation Detection");
  console.log("=".repeat(80));

  if (args.verbose) {
    console.log("\nConfiguration:");
    console.log(`  Project root: ${projectRoot}`);
    console.log(`  Include: ${include.join(", ")}`);
    console.log(`  Report only: ${args["report-only"]}`);
    if (only) console.log(`  Only: ${only.join(", ")}`);
    if (skip) console.log(`  Skip: ${skip.join(", ")}`);
  }

  console.log();

  try {
    // Run viola
    const results = await runViola(options);

    // Print results
    console.log(formatResults(results));

    // Exit code
    if (results.hasErrors && !args["report-only"]) {
      Deno.exit(1);
    }

    Deno.exit(0);
  } catch (error) {
    console.error("\nError running viola:");
    console.error(error instanceof Error ? error.message : String(error));

    if (args.verbose && error instanceof Error && error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }

    Deno.exit(1);
  }
}

// Run
main();

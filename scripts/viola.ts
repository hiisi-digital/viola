#!/usr/bin/env -S deno run -A
/**
 * Dogfooding script - run viola on itself.
 *
 * Since viola has no "built-in" linters, we must explicitly load them
 * as plugins before running.
 */

import { formatResults, loadPlugins, runViola } from "../mod.ts";

const strict = Deno.args.includes("--strict");
const verbose = Deno.args.includes("--verbose") || Deno.args.includes("-v");

// Load linters from the local packages directory via import map alias
// In a real project, this would be a published package like "jsr:@hiisi/viola-linters"
const pluginResults = await loadPlugins(
  ["@hiisi/viola-linters"],
  { verbose }
);

if (!pluginResults.allSucceeded) {
  console.error("Failed to load linter plugins");
  Deno.exit(1);
}

if (verbose) {
  console.log(`Loaded ${pluginResults.totalLinters} linter(s)\n`);
}

const results = await runViola({
  projectRoot: Deno.cwd(),
  include: ["src"],
  verbose,
  // Skip linters that are too noisy for viola's own codebase:
  // - type-location: designed for monorepos with packages/types structure
  // - duplicate-strings: flags type literals like "function", "interface"
  // - orphaned-code: flags public API exports that aren't used internally
  // - similar-functions: each linter has similar helper functions by design
  // - duplicate-logic: same as above - linter helpers are intentionally similar
  skip: ["type-location", "duplicate-strings", "orphaned-code", "similar-functions", "duplicate-logic"],
});

console.log(formatResults(results));

if (strict && results.summary.total > 0) {
  console.log("\n[strict mode] Failing due to convention issues.\n");
  Deno.exit(1);
}

if (results.hasErrors) {
  Deno.exit(1);
}

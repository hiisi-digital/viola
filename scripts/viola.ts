#!/usr/bin/env -S deno run -A
/**
 * Dogfooding script - run viola on itself.
 *
 * Loads linters via the plugin system from @hiisi/viola-default-lints.
 */

import { formatResults, runViola } from "../mod.ts";

const strict = Deno.args.includes("--strict");
const verbose = Deno.args.includes("--verbose") || Deno.args.includes("-v");

const results = await runViola({
  projectRoot: Deno.cwd(),
  include: ["src"],
  plugins: ["@hiisi/viola-default-lints"],
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

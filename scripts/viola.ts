#!/usr/bin/env -S deno run -A
/**
 * Dogfooding script - run viola on itself.
 *
 * Loads configuration from viola.config.ts which imports linters locally.
 */

import defaultLints from "../../viola-default-lints/mod.ts";
import { formatResults, runViola } from "../mod.ts";
import { registry } from "../src/linters/mod.ts";

const verbose = Deno.args.includes("--verbose") || Deno.args.includes("-v");

// Register linters from the default lints plugin
for (const linter of defaultLints.linters ?? []) {
  registry.register(linter);
}

// Import linters array directly
import { linters } from "../../viola-default-lints/mod.ts";
for (const linter of linters) {
  registry.register(linter);
}

const results = await runViola({
  projectRoot: Deno.cwd(),
  include: ["src"],
  plugins: [], // Empty - we registered linters directly
  verbose,
  // No skipping - we want to dogfood all linters
});

console.log(formatResults(results));

if (results.hasErrors) {
  Deno.exit(1);
}

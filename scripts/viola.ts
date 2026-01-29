#!/usr/bin/env -S deno run -A
/**
 * Dogfooding script - run viola on itself.
 */

import { formatResults, runViola } from "../mod.ts";

const strict = Deno.args.includes("--strict");

const results = await runViola({
  projectRoot: Deno.cwd(),
  include: ["src"],
  verbose: Deno.args.includes("--verbose") || Deno.args.includes("-v"),
});

console.log(formatResults(results));

if (strict && results.summary.total > 0) {
  console.log("\n[strict mode] Failing due to convention issues.\n");
  Deno.exit(1);
}

if (results.hasErrors) {
  Deno.exit(1);
}

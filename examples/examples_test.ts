//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Every example, run for real, and checked.
 *
 * These invoke the cli as a subprocess against the example's own directory,
 * which is what a reader would do. That matters more than it sounds: config
 * loading happens in a subprocess with a merged import map, and running the
 * library directly from a test skips the part that has broken most often.
 *
 * An example that stops being true fails here, so the documentation cannot
 * drift from the product the way a readme snippet does.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const here = fromFileUrl(new URL(".", import.meta.url));
const cli = fromFileUrl(new URL("../../viola-cli/mod.ts", import.meta.url));

interface Run {
  readonly code: number;
  readonly output: string;
  /** One entry per reported finding, in the order the cli printed them. */
  readonly findings: readonly string[];
}

/**
 * Run the cli over one example, the way its readme says to.
 */
async function runExample(
  name: string,
  include = "src",
  verbose = false,
): Promise<Run> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      "--min-dep-age=0",
      cli,
      "--project",
      `${here}${name}`,
      "--include",
      include,
      ...(verbose ? ["--verbose"] : []),
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  const output = new TextDecoder().decode(stdout) +
    new TextDecoder().decode(stderr);
  const findings = output
    .split("\n")
    .filter((line) =>
      /^\[[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\] \S+:\d+/.test(line)
    )
    .map((line) => line.trim());
  return { code, output, findings };
}

/** Which linter and issue a finding line names. */
function kinds(run: Run): string[] {
  return run.findings.map((f) => f.slice(1, f.indexOf("]")));
}

/** Which file a finding line names. */
function files(run: Run): string[] {
  return run.findings.map((f) => f.slice(f.indexOf("] ") + 2).split(":")[0]!);
}

Deno.test("example 01 - the smallest config reports something", async () => {
  const run = await runExample("01-getting-started");
  // The undocumented export is the point of the example. If this stops being
  // reported the example has stopped showing what it says it shows.
  assertEquals(kinds(run).includes("missing-docs/missing-function-docs"), true);
  assertEquals(run.code, 1, "a config with an error rule fails the run");
});

Deno.test("example 01 - a grammar is registered, so files are actually read", async () => {
  // Without a grammar viola reports nothing, which looks exactly like a clean
  // project. Three packages in this estate reported zero that way.
  const run = await runExample("01-getting-started");
  assertStringIncludes(run.output, "Files scanned:");
  assertEquals(run.output.includes("Files scanned: 0"), false);
});

Deno.test("example 02 - the level tracks confidence, band by band", async () => {
  // The example exists to show three bands, so the run has to produce
  // findings in more than one of them. A run that reported everything at one
  // level would pass a weaker assertion while showing nothing.
  const run = await runExample("02-severity-by-confidence");
  assertEquals(run.findings.length > 0, true);
  assertStringIncludes(run.output, "WARN");
  assertStringIncludes(run.output, "ERROR");
  assertEquals(run.code, 1, "an error-level finding fails the run");
});

Deno.test("example 03 - a path rule turns a whole directory off", async () => {
  const run = await runExample("03-scoping-by-path");
  const reported = files(run);
  assertEquals(
    reported.some((f) => f.includes("generated/")),
    false,
    "src/generated is reported off and must produce no findings",
  );
});

Deno.test("example 03 - the strict bar still applies outside the exemptions", async () => {
  const run = await runExample("03-scoping-by-path");
  assertEquals(
    run.findings.length > 0,
    true,
    "the library itself is still linted",
  );
});

Deno.test("example 04 - an overriding grammar answers and suppresses the other", async () => {
  // The test the missing feature needed, and the assertion has to be on
  // something that differs. An earlier version of this checked only that
  // files were scanned, which is true whether or not the config's rule was
  // ever read: with the resolver unwired every one of these tests still
  // passed, which made them decoration.
  //
  // What differs is the resolution itself, which is why the crawler reports
  // it under `--verbose`.
  const run = await runExample("04-grammar-relationships", "src", true);
  assertStringIncludes(
    run.output,
    "grammars for src/core.ts: strict=overriding (suppressed loose)",
  );
});

Deno.test("example 04 - a supplement runs after what it supplements", async () => {
  // The other half of the rule. `loose` keeps its primary role and `strict`
  // comes after it as a supplement, rather than either being suppressed.
  const run = await runExample("04-grammar-relationships", "tools", true);
  assertStringIncludes(run.output, "grammars for tools/helper.ts:");
  assertStringIncludes(run.output, "strict=supplement");
  assertEquals(
    run.output.includes("suppressed"),
    false,
    "a supplement suppresses nothing",
  );
});

Deno.test("example 04 - two grammars on one file do not double-count", async () => {
  // `supplements` merges by position, so the second grammar contributes what
  // the first did not find at that line and never a second copy of what it
  // did.
  const run = await runExample("04-grammar-relationships", "tools");
  const seen = new Set<string>();
  for (const finding of run.findings) {
    assertEquals(
      seen.has(finding),
      false,
      `a finding was reported twice, so the merge did not dedupe: ${finding}`,
    );
    seen.add(finding);
  }
});

//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * What an exclude pattern is matched against.
 *
 * The patterns used to be handed to `walk`, which tests them against the
 * absolute path. `dist` then matched any ancestor directory as readily as one
 * inside the project: a package in a directory called `deno-dist` excluded its
 * own entire tree, reported "Files scanned: 0", and said "All clear". It was
 * counted as a clean package for as long as anybody had been counting.
 *
 * A project has a say over the paths inside it and none at all over where
 * somebody checked it out, so the relative path is the only honest thing to
 * match.
 */

import { assertEquals } from "@std/assert";
import typescript from "@hiisi/viola-grammar-ts";
import { createGrammarRegistry } from "../grammars/registry.ts";
import type { CrawlConfig } from "../data/types.ts";
import { crawlCodebase, DEFAULT_CONFIG } from "./crawler.ts";

/** A tree under a directory whose name contains an excluded word. */
async function inAwkwardlyNamedDirectory(): Promise<string> {
  const parent = await Deno.makeTempDir();
  const root = `${parent}/deno-dist`;
  await Deno.mkdir(`${root}/src`, { recursive: true });
  await Deno.writeTextFile(
    `${root}/src/thing.ts`,
    "/** A thing. */\nexport function thing(): number {\n  return 1;\n}\n",
  );
  await Deno.mkdir(`${root}/dist`, { recursive: true });
  await Deno.writeTextFile(
    `${root}/dist/built.ts`,
    "export const built = 1;\n",
  );
  return root;
}

/** The defaults, pointed at a project. */
function crawlConfig(root: string, include: readonly string[]): CrawlConfig {
  return {
    ...DEFAULT_CONFIG,
    projectRoot: root,
    include,
    exclude: DEFAULT_CONFIG.exclude ?? [],
    extensions: DEFAULT_CONFIG.extensions ?? [],
    linters: DEFAULT_CONFIG.linters ?? {},
    reportOnly: false,
    verbose: false,
  };
}

function registry() {
  const r = createGrammarRegistry();
  r.add(typescript).as("ts");
  return r;
}

Deno.test("crawler - an excluded word in an ancestor directory excludes nothing", async () => {
  const root = await inAwkwardlyNamedDirectory();
  try {
    const data = await crawlCodebase(
      crawlConfig(root, ["src"]),
      registry(),
    );
    assertEquals(data.files.length, 1, "the project's own file is read");
    assertEquals(data.files[0]?.path, "src/thing.ts");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("crawler - the same word inside the project still excludes", async () => {
  // The control. Matching on the relative path must not stop `dist` meaning
  // `dist` when it is the project's own build output.
  const root = await inAwkwardlyNamedDirectory();
  try {
    const data = await crawlCodebase(
      crawlConfig(root, ["."]),
      registry(),
    );
    const paths = data.files.map((f) => f.path);
    assertEquals(paths.includes("src/thing.ts"), true);
    assertEquals(
      paths.some((p) => p.startsWith("dist/")),
      false,
      "the project's own dist directory is still excluded",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

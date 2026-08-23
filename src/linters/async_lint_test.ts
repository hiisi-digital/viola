//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * An async lint has to actually resolve before its issues are counted.
 *
 * `lint` returns `Issue[] | Promise<Issue[]>` and both `run` and the registry
 * await it. That is three awaits over two files, and a union return type is
 * exactly the shape where dropping one of them costs nothing visible: a
 * synchronous lint keeps working, and an async one silently contributes a
 * pending promise instead of its issues. So every law here uses a lint that
 * resolves on a later tick, because a lint that resolves immediately cannot
 * tell a missing await from a present one.
 *
 * @module
 */

import { assert, assertEquals } from "@std/assert";

import { BaseLinter } from "./base.ts";
import { LinterRegistry, runLinters } from "./registry.ts";
import type { IssueCatalog } from "../config/types.ts";
import type { CodebaseData, Issue, LinterConfig } from "../data/types.ts";
import type { LinterDataRequirements, LinterMeta } from "./types/base.types.ts";

// =============================================================================
// Fixtures
// =============================================================================

const EMPTY_DATA: CodebaseData = {
  projectRoot: "/nowhere",
  files: [],
  schemas: [],
  extractedAt: 0,
  allFunctions: [],
  allTypes: [],
  allStrings: [],
  allExports: [],
  allImports: [],
  literalVocabulary: new Set<string>(),
};

const ENABLED: LinterConfig = { enabled: true };

function catalogue(id: string): IssueCatalog {
  return {
    [`${id}/found`]: {
      category: "correctness",
      impact: "trivial",
      description: "the fixture's only issue kind",
    },
  };
}

function issue(id: string): Issue {
  // no cast. the cast was hiding two things: `location` is required and was
  // absent, so every issue this fixture made would have crashed any reporter
  // that read it, and `confidence` is documented 0-100 while this said 1.
  // the laws only read `kind`, so nothing here would ever have noticed.
  return {
    kind: `${id}/found`,
    location: { file: "fixture.ts", line: 1, column: 1 },
    message: "the fixture reported this",
    confidence: 100,
  };
}

/** A lint whose result is only available after the current tick has ended. */
class LaterLinter extends BaseLinter {
  readonly meta: LinterMeta = {
    id: "later",
    name: "Later",
    description: "resolves on a later tick, which is the whole point",
  };
  readonly catalog: IssueCatalog = catalogue("later");
  readonly requirements: LinterDataRequirements = {};

  override async lint(): Promise<Issue[]> {
    // a real async lint spawns a process or fetches. a timer is the cheapest
    // thing with the same property: the value does not exist yet when `lint`
    // returns, so a caller that forgets to await gets a promise rather than
    // an array and every count downstream reads zero.
    await new Promise((resolve) => setTimeout(resolve, 1));
    return [issue("later")];
  }
}

/** The control: same shape, same issue, no waiting. */
class NowLinter extends BaseLinter {
  readonly meta: LinterMeta = {
    id: "now",
    name: "Now",
    description: "returns an array, so it cannot distinguish a missing await",
  };
  readonly catalog: IssueCatalog = catalogue("now");
  readonly requirements: LinterDataRequirements = {};

  override lint(): Issue[] {
    return [issue("now")];
  }
}

// =============================================================================
// Laws
// =============================================================================

Deno.test("run awaits a lint that resolves later", async () => {
  const result = await new LaterLinter().run(EMPTY_DATA, ENABLED);

  assert(result.success, `the run failed: ${result.error}`);
  assertEquals(result.issues.length, 1);
  const found = result.issues[0];
  assert(found !== undefined, "the run reported no issue to read");
  assertEquals(found.kind, "later/found");
});

Deno.test("run still carries a synchronous lint's issues", async () => {
  // the control for the law above. If this one broke too, the finding would be
  // about `run` rather than about awaiting.
  const result = await new NowLinter().run(EMPTY_DATA, ENABLED);

  assert(result.success, `the run failed: ${result.error}`);
  assertEquals(result.issues.length, 1);
  const found = result.issues[0];
  assert(found !== undefined, "the run reported no issue to read");
  assertEquals(found.kind, "now/found");
});

/** Rejects on a later tick, which is the case a try block can be written to miss. */
class ThrowsLater extends BaseLinter {
  readonly meta: LinterMeta = {
    id: "throws",
    name: "Throws",
    description: "rejects after the tick that called it has ended",
  };
  readonly catalog: IssueCatalog = catalogue("throws");
  readonly requirements: LinterDataRequirements = {};

  override async lint(): Promise<Issue[]> {
    await new Promise((resolve) => setTimeout(resolve, 1));
    throw new Error("the lint could not do its job");
  }
}

Deno.test("a rejected lint is reported as a failed run, not thrown", async () => {
  const result = await new ThrowsLater().run(EMPTY_DATA, ENABLED);

  // a rejection arriving after the try block would escape it. This says it does not.
  assertEquals(result.success, false);
  assertEquals(result.error, "the lint could not do its job");
  assertEquals(result.issues.length, 0);
});

for (const parallel of [false, true]) {
  Deno.test(`the registry collects an async lint's issues, parallel=${parallel}`, async () => {
    // both dispatch paths, because they are written differently: one awaits
    // `run` in a loop and the other wraps it in Promise.resolve and gathers.
    const registry = new LinterRegistry();
    registry.register(new LaterLinter());
    registry.register(new NowLinter());

    const results = await runLinters(EMPTY_DATA, { parallel, registry });
    const kinds = results.results.flatMap((r) => r.issues.map((i) => i.kind))
      .sort();

    assertEquals(kinds, ["later/found", "now/found"]);
  });
}

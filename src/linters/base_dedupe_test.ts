//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * A linter may not report the same finding twice.
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import { BaseLinter } from "./base.ts";
import type { CodebaseData, Issue, LinterConfig } from "../data/types.ts";
import type { LinterDataRequirements } from "./types/base.types.ts";

const at = (file: string, line: number) => ({ file, line, column: 1 });

class Repeats extends BaseLinter {
  override meta = { id: "t", name: "t", description: "t", version: "0.0.0" };
  override catalog = {};
  override requirements: LinterDataRequirements = {};
  constructor(private readonly out: Issue[]) {
    super();
  }
  override lint(_d: CodebaseData, _c: LinterConfig): Issue[] {
    return this.out;
  }
}

const reported = (
  kind: string,
  file: string,
  line: number,
  message: string,
): Issue => ({
  kind,
  location: at(file, line),
  message,
  confidence: 80,
});

Deno.test("a linter reporting one finding three times reports it once", async () => {
  // `orphaned-code` did exactly this: one export reachable through three
  // re-export paths produced three findings at one and the same line.
  const same = reported("a/b", "src/x.ts", 23, "never imported");
  const r = await new Repeats([same, same, same]).run(
    {} as CodebaseData,
    {} as LinterConfig,
  );
  assertEquals(r.issues.length, 1);
});

Deno.test("findings that differ in any part all survive", async () => {
  const r = await new Repeats([
    reported("a/b", "src/x.ts", 23, "never imported"),
    reported("a/b", "src/x.ts", 24, "never imported"),
    reported("a/b", "src/y.ts", 23, "never imported"),
    reported("a/c", "src/x.ts", 23, "never imported"),
    reported("a/b", "src/x.ts", 23, "something else"),
  ]).run({} as CodebaseData, {} as LinterConfig);
  assertEquals(r.issues.length, 5);
});

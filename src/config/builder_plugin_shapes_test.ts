//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * `use()` accepts both plugin shapes this package publishes.
 *
 * `ViolaPlugin` names two different interfaces here: one with `build(viola)`
 * and one with `linters`/`bundles`. A plugin written against the second used to
 * throw at the user, and `@hiisi/viola-script-lints` 0.3.0 is exactly that
 * case, published against a published `@hiisi/viola` 0.3.0.
 *
 * @module
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { viola } from "./builder.ts";
import type { BaseLinter } from "../linters/base.ts";

/** The smallest thing `isLinter` accepts, so these tests are about `use()`. */
function linter(id: string): BaseLinter {
  return {
    meta: { id, name: id, description: id },
    catalog: {},
    lint: () => [],
  } as unknown as BaseLinter;
}

Deno.test("use() takes a build() plugin, which is the shape that always worked", () => {
  const built = viola().use({ build: (v) => void v.add(linter("a")) }).build();
  assertEquals(built.linters.map((l) => l.meta.id), ["a"]);
});

Deno.test("use() takes a plugin function", () => {
  const built = viola().use((v) => void v.add(linter("b"))).build();
  assertEquals(built.linters.map((l) => l.meta.id), ["b"]);
});

Deno.test("use() takes a plugin carrying a linters array", () => {
  const built = viola().use({ name: "p", linters: [linter("c"), linter("d")] })
    .build();
  assertEquals(built.linters.map((l) => l.meta.id), ["c", "d"]);
});

Deno.test("use() takes a plugin carrying bundles, and keeps every bundle", () => {
  const built = viola()
    .use({
      name: "p",
      bundles: { strict: [linter("e")], minimal: [linter("f")] },
    })
    .build();
  assertEquals(built.linters.map((l) => l.meta.id).sort(), ["e", "f"]);
});

Deno.test("use() takes an async linters function, resolved by resolve()", async () => {
  const b = viola().use({
    name: "p",
    linters: () => Promise.resolve([linter("g")]),
  });
  const built = await b.resolve();
  assertEquals(built.linters.map((l) => l.meta.id), ["g"]);
});

Deno.test("build() refuses rather than silently dropping an unresolved source", () => {
  const b = viola().use({
    name: "p",
    linters: () => Promise.resolve([linter("h")]),
  });
  // The whole point: a config that lints nothing is worse than an error, because
  // a clean run reads as a passing one.
  assertThrows(() => b.build(), Error, "unresolved");
});

Deno.test("resolve() is safe to call when nothing is pending", async () => {
  const built = await viola().use({ name: "p", linters: [linter("i")] })
    .resolve();
  assertEquals(built.linters.map((l) => l.meta.id), ["i"]);
});

Deno.test("resolve() drains once, so a second call does not double the linters", async () => {
  const b = viola().use({
    name: "p",
    linters: () => Promise.resolve([linter("j")]),
  });
  await b.resolve();
  const again = await b.resolve();
  assertEquals(again.linters.map((l) => l.meta.id), ["j"]);
});

Deno.test("use() still refuses something that is neither shape", () => {
  assertThrows(
    () => viola().use({ nope: true } as never),
    Error,
    "Invalid plugin",
  );
  assertThrows(() => viola().use(42 as never), Error, "Invalid plugin");
});

Deno.test("a rejecting linters source surfaces rather than resolving empty", async () => {
  const b = viola().use({
    name: "p",
    linters: () => Promise.reject(new Error("discovery failed")),
  });
  await assertRejects(() => b.resolve(), Error, "discovery failed");
});

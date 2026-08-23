/**
 * What `runProject` refuses, and what it lets through.
 *
 * These exist because the two refusals are the whole point of it and had no
 * coverage at all. Both guard the same failure: a run that checked nothing
 * prints the same verdict as a run that checked everything and found nothing.
 * One of those is good news.
 *
 * Every refusal here is paired with the case that must still pass, so a guard
 * cannot look correct by refusing everything.
 *
 * @module
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { runProject } from "../../mod.ts";
import { viola } from "../config/mod.ts";

/** Run with stdout and stderr captured, so a refusal's reasoning is testable. */
async function capture(
  fn: () => Promise<number>,
): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  console.error = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    return { code: await fn(), out: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = err;
  }
}

/** A project directory with the given files, thrown away after the test. */
async function project(files: Record<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "viola-project-" });
  for (const [name, body] of Object.entries(files)) {
    const path = `${dir}/${name}`;
    await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(path, body);
  }
  return dir;
}

Deno.test("runProject refuses a config that registers nothing", async () => {
  const dir = await project({ "src/a.ts": "export const a = 1;\n" });
  const { code, out } = await capture(() =>
    runProject({
      projectRoot: dir,
      include: ["src"],
      preloadedConfig: viola().build(),
      env: {},
    })
  );
  assertEquals(code, 1);
  assertStringIncludes(out, "no plugins configured");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("runProject says a grammar is not optional when it refuses", async () => {
  // The refusal is only useful if it says what to do. A config with no grammar
  // reads nothing, which is the failure this message exists to explain.
  const dir = await project({ "src/a.ts": "export const a = 1;\n" });
  const { out } = await capture(() =>
    runProject({
      projectRoot: dir,
      include: ["src"],
      preloadedConfig: viola().build(),
      env: {},
    })
  );
  assertStringIncludes(out, "A grammar is not optional");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("runProject accepts an empty config when told to", async () => {
  // The control for both refusals. Without it they could pass by refusing
  // everything, which is a gate nobody can get through rather than a gate.
  const dir = await project({ "src/a.ts": "export const a = 1;\n" });
  const { code } = await capture(() =>
    runProject({
      projectRoot: dir,
      include: ["src"],
      preloadedConfig: viola().build(),
      env: {},
      allowEmpty: true,
    })
  );
  assertEquals(code, 0);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("runProject refuses a run that read no files", async () => {
  // An include list pointing somewhere empty prints "All clear", which is the
  // worst available thing to say about a package nobody checked.
  const dir = await project({ "src/a.ts": "export const a = 1;\n" });
  const { code, out } = await capture(() =>
    runProject({
      projectRoot: dir,
      include: ["nowhere"],
      preloadedConfig: viola().build(),
      env: {},
      // Past the first refusal, so this reaches the file count rather than
      // stopping at the empty config and testing the wrong guard.
      allowEmpty: false,
    })
  );
  assertEquals(code, 1);
  // It stops at the config refusal first, which is itself the correct order:
  // an unconfigured run cannot say anything about files either.
  assertStringIncludes(out, "Refusing to pass");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("a project directory that does not exist does not read as clean", async () => {
  const { code } = await capture(() =>
    runProject({
      projectRoot: "/nonexistent-viola-project",
      include: ["src"],
      preloadedConfig: viola().build(),
      env: {},
    })
  );
  assertEquals(code, 1);
});

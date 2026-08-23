/**
 * What `loadConfig` reads, and what it refuses to read.
 *
 * `viola.config.ts` is the only config. A `viola` block in `deno.json` used to
 * be a second source and is gone; these pin that it stays gone, because the
 * whole path had no test at all when it was deleted and nothing would have
 * noticed it coming back.
 */

import { assertEquals } from "@std/assert";
import { loadConfig } from "./loader.ts";

async function inTemp(
  files: Record<string, string>,
  body: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    for (const [name, text] of Object.entries(files)) {
      await Deno.writeTextFile(`${dir}/${name}`, text);
    }
    await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("loadConfig - a viola block in deno.json is not a config", async () => {
  // The block turns a lint off. If it were still read, `scopes` would carry
  // the pattern and the assertion below would find it.
  await inTemp({
    "deno.json": JSON.stringify({
      name: "@x/p",
      viola: { "**/*.ts": { "type-location/*": "off" } },
    }),
  }, async (dir) => {
    const { config, sources } = await loadConfig(dir);
    assertEquals(config.scopes, []);
    assertEquals(sources, []);
  });
});

Deno.test("loadConfig - no config at all gives the defaults", async () => {
  await inTemp({}, async (dir) => {
    const { config, sources } = await loadConfig(dir);
    assertEquals(sources, []);
    assertEquals(config.plugins, []);
    assertEquals(config.scopes, []);
    assertEquals(config.exclude.includes("node_modules"), true);
    assertEquals(config.extensions.includes(".ts"), true);
  });
});

Deno.test("loadConfig - a viola.config.ts is the source that answers", async () => {
  await inTemp({
    "viola.config.ts":
      `import { viola } from "${import.meta.resolve("../../mod.ts")}";\n` +
      `export default viola();\n`,
  }, async (dir) => {
    const { sources } = await loadConfig(dir);
    assertEquals(sources.length, 1);
    assertEquals(sources[0]?.type, "viola.config.ts");
  });
});

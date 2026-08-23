#!/usr/bin/env -S deno run -A
/**
 * viola, run on itself, by itself.
 *
 * The gate used to shell out to a published `viola-cli`, and that is wrong in
 * two ways at once. A published cli resolves a published viola, so a fix on
 * disk was invisible to the gate meant to catch it: the dedupe commit sat in
 * `src/linters/base.ts` while the gate happily reported findings the fixed code
 * would have collapsed. And it made the package that everything else in the
 * chain depends on the one package unable to check itself until its own
 * dependents had shipped.
 *
 * There is nothing the cli does here that the library cannot. The cli is
 * argument parsing plus a subprocess carrying a merged import map, and that
 * subprocess exists to bridge a *foreign* project whose config names plugins
 * this cli has never heard of. A project running viola on itself has its own
 * manifest in effect already, so the config imports resolve and the run is a
 * function call.
 *
 * `runProject` is that function, and the cli calls it too, so the gate and the
 * cli cannot drift into checking different things.
 *
 * @module
 */

import config from "./viola.config.ts";
import { runProject } from "./mod.ts";

if (import.meta.main) {
  Deno.exit(
    await runProject({
      projectRoot: new URL(".", import.meta.url).pathname,
      include: ["mod.ts", "src", "viola.config.ts", "gate.ts"],
      preloadedConfig: config,
      env: Deno.env.toObject(),
    }),
  );
}

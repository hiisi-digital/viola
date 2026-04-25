// viola-deno-runtime — embedded ES module wrapper.
//
// Loaded by the embedded JsRuntime as the main module
// (`viola-internal:runtime.ts`). The runtime crate publishes the
// user's `viola.config.ts` path through the `op_get_config_path` op
// before each lint evaluation; this wrapper reads the path and
// dynamically imports the user module so any TS sources it touches
// flow through the host's `TsFsModuleLoader` (with deno_ast transpile).
//
// In PR-B the user config is responsible for emitting its own
// diagnostics by calling `Deno.core.ops.op_emit_diagnostic(JSON.stringify(...))`.
// PR-C wires the `@hiisi/viola` builder API so the user config exports
// a builder result instead, and this wrapper translates that result
// into op_emit_diagnostic calls.
//
// If the path is empty (no `[ts].config` configured, or canonicalize
// failed on the host side), the wrapper does nothing and the host
// returns an empty diagnostic batch.

const path: string = (Deno as unknown as { core: { ops: Record<string, () => string> } })
  .core.ops.op_get_config_path();

if (path.length > 0) {
  await import(path);
}

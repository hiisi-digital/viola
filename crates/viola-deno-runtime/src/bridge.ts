// viola-deno-runtime — embedded bridge worker.
//
// Runs as `deno run --allow-all bridge.ts <user-config-path>` in a
// long-lived child process spawned by the cdylib at init. Loops on
// stdin reading line-delimited JSON requests, dispatches to the user
// config, writes line-delimited JSON responses to stdout. The cdylib
// is on the other end of the pipes.
//
// Wire protocol (one JSON object per line, both directions):
//
//   host -> worker:
//     {"op":"lint","scope":{ ... }}
//     {"op":"shutdown"}
//
//   worker -> host:
//     {"diag":{plugin_id,rule_id,severity,message,path,line,column}}
//     {"done":true}
//     {"err":"..."}
//
// The user config is imported once on startup. It runs in the deno
// runtime with full byonm support: import "@hiisi/viola" or "jsr:..."
// or relative .ts paths all flow through deno's standard resolvers.
// The config opts in to the lint protocol by exporting a default
// async function (req) => void; that function is called for every
// {"op":"lint"} request and uses the global `viola.diag(...)` to emit
// diagnostics. Configs without a default export still load (their
// top-level side-effects fire); subsequent lint requests are no-ops.

interface BridgeDiagnostic {
  plugin_id: string;
  rule_id: string;
  severity: "info" | "warn" | "error";
  message: string;
  path: string;
  line: number;
  column: number;
}

interface ViolaApi {
  diag(d: BridgeDiagnostic): void;
}

const encoder = new TextEncoder();

// Synchronous write so callers (incl. user config's lint handler)
// cannot lose diagnostics under backpressure. The fire-and-forget
// `void emit(promise)` shape is unsafe: rejections vanish silently
// and high-volume passes drop diagnostics. writeSync flushes per
// line; for our protocol that is what we want anyway.
function emit(obj: unknown): void {
  Deno.stdout.writeSync(encoder.encode(JSON.stringify(obj) + "\n"));
}

const viola: ViolaApi = {
  diag(d) {
    emit({ diag: d });
  },
};
(globalThis as unknown as { viola: ViolaApi }).viola = viola;

const userConfigPath = Deno.args[0];
if (!userConfigPath) {
  emit({ err: "viola-deno-runtime: missing user config path argv[0]" });
  Deno.exit(2);
}

let userMod: { default?: (req: unknown) => void | Promise<void> };
try {
  userMod = await import(userConfigPath);
} catch (e) {
  emit({ err: `viola-deno-runtime: failed to import ${userConfigPath}: ${e}` });
  Deno.exit(2);
}

// Line-delimited JSON reader over stdin. Buffers partial lines across
// reads so a single JSON object can span chunk boundaries.
const stdinReader = Deno.stdin.readable.getReader();
const decoder = new TextDecoder();
let pending = "";

async function readNextRequest(): Promise<unknown | null> {
  while (true) {
    const newlineIdx = pending.indexOf("\n");
    if (newlineIdx >= 0) {
      const line = pending.slice(0, newlineIdx);
      pending = pending.slice(newlineIdx + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        emit({ err: `viola-deno-runtime: bad request JSON: ${e}` });
        continue;
      }
    }
    const { value, done } = await stdinReader.read();
    if (done) return null;
    pending += decoder.decode(value, { stream: true });
  }
}

while (true) {
  const req = await readNextRequest();
  if (req === null) break;
  const r = req as { op?: string };
  if (r.op === "shutdown") break;
  if (r.op === "lint") {
    if (typeof userMod.default === "function") {
      try {
        await userMod.default(req);
      } catch (e) {
        emit({ err: `viola-deno-runtime: user lint handler threw: ${e}` });
      }
    }
    emit({ done: true });
    continue;
  }
  emit({ err: `viola-deno-runtime: unknown op ${JSON.stringify(r.op)}` });
}

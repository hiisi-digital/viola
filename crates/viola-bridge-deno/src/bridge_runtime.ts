// viola-bridge-deno bridge runtime.
//
// This script runs inside the embedded deno_core JsRuntime hosted by
// the viola-bridge-deno plugin. It calls back into the host via a
// registered op (`op_emit_diagnostic`) to deliver diagnostics. The
// host drains the queued diagnostics and returns them to the viola
// pipeline as a v1 DiagnosticBatch.
//
// MVP scope: emit one hardcoded diagnostic so the embedding plumbing
// (cdylib -> JsRuntime -> op -> Rust collector -> DiagnosticBatch ->
// host) can be validated end-to-end. Real @hiisi/viola integration
// (loading the user's viola.config.ts and running the full TS
// pipeline) lands in a follow-up.

// Bridge runtime executed by the embedded JsRuntime. The bridge crate
// transpiles this with deno_ast before handing the resulting JS to
// execute_script, so TypeScript syntax (interfaces, type annotations,
// enums) is supported here.

interface BridgeDiagnostic {
  plugin_id: string;
  rule_id: string;
  severity: "info" | "warn" | "error";
  message: string;
  path: string;
  line: number;
  column: number;
}

const diag: BridgeDiagnostic = {
  plugin_id: "org.viola.bridge.deno",
  rule_id: "bridge-mvp",
  severity: "warn",
  message: "viola-bridge-deno embedded JsRuntime is alive",
  path: "<bridge>",
  line: 1,
  column: 0,
};

Deno.core.ops.op_emit_diagnostic(JSON.stringify(diag));

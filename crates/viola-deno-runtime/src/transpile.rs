//! TypeScript transpile helper used by the runtime + custom loader.

/// Transpile a TypeScript source string into JavaScript suitable for
/// `JsRuntime::execute_script` or for ES-module loading.
///
/// Uses `deno_ast::parse_module` + `transpile` with default options
/// that strip type annotations, lower TS syntax (enums, decorators,
/// type-only imports), and emit ES module JS. Returns `Err(String)`
/// on parse / transpile failure with a human-readable message.
pub fn transpile_ts(specifier: &str, source: &str) -> Result<String, String> {
    use deno_ast::{MediaType, ModuleSpecifier, ParseParams, SourceMapOption};

    // deno_ast only uses the specifier for source-map labelling; what
    // it requires is a parseable URL. If `specifier` already parses as
    // a URL (file://, viola-internal:, etc.), pass it through verbatim.
    // Otherwise wrap a bare path in a synthetic file:/// URL.
    let url = match ModuleSpecifier::parse(specifier) {
        Ok(u) => u,
        Err(_) => ModuleSpecifier::parse(&format!("file:///{}", specifier))
            .map_err(|e| format!("bad specifier: {e}"))?,
    };
    let parsed = deno_ast::parse_module(ParseParams {
        specifier: url,
        text: source.to_string().into(),
        media_type: MediaType::TypeScript,
        capture_tokens: false,
        scope_analysis: false,
        maybe_syntax: None,
    })
    .map_err(|e| format!("parse error: {e}"))?;
    let transpile_opts = deno_ast::TranspileOptions::default();
    let emit_opts = deno_ast::EmitOptions {
        source_map: SourceMapOption::None,
        ..Default::default()
    };
    let transpile_mod_opts = deno_ast::TranspileModuleOptions::default();
    let res = parsed
        .transpile(&transpile_opts, &transpile_mod_opts, &emit_opts)
        .map_err(|e| format!("transpile error: {e}"))?;
    Ok(res.into_source().text)
}

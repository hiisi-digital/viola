//! Custom `ModuleLoader` for the embedded V8 runtime.
//!
//! Wraps the standard file-system loading shape but transpiles
//! TypeScript on the fly via `deno_ast` so the user can author
//! `viola.config.ts` with full TS syntax. The loader also recognises
//! one synthetic specifier, `viola-internal:runtime.ts`, which serves
//! the embedded wrapper module that imports the user config; all other
//! specifiers must be `file://` URLs.

use deno_core::{
    ModuleLoadResponse, ModuleLoader, ModuleSource, ModuleSourceCode,
    ModuleSpecifier, ModuleType, ResolutionKind, resolve_import,
};
use deno_core::error::ModuleLoaderError;
use deno_error::JsErrorBox;

use crate::transpile;

pub const RUNTIME_INTERNAL_SPECIFIER: &str = "viola-internal:runtime.ts";

pub struct TsFsModuleLoader {
    pub embedded_runtime_ts: String,
}

impl ModuleLoader for TsFsModuleLoader {
    fn resolve(
        &self,
        specifier: &str,
        referrer: &str,
        _kind: ResolutionKind,
    ) -> Result<ModuleSpecifier, ModuleLoaderError> {
        resolve_import(specifier, referrer).map_err(|e| {
            JsErrorBox::generic(format!(
                "viola-deno-runtime: cannot resolve {specifier:?} from {referrer:?}: {e}"
            ))
            .into()
        })
    }

    fn load(
        &self,
        module_specifier: &ModuleSpecifier,
        _maybe_referrer: Option<&deno_core::ModuleLoadReferrer>,
        _options: deno_core::ModuleLoadOptions,
    ) -> ModuleLoadResponse {
        let spec_str = module_specifier.as_str();

        if spec_str == RUNTIME_INTERNAL_SPECIFIER {
            let code = match transpile::transpile_ts(
                RUNTIME_INTERNAL_SPECIFIER,
                &self.embedded_runtime_ts,
            ) {
                Ok(js) => js,
                Err(e) => {
                    return ModuleLoadResponse::Sync(Err(JsErrorBox::generic(
                        format!("viola-deno-runtime: embedded runtime transpile failed: {e}"),
                    )
                    .into()));
                }
            };
            let module = ModuleSource::new(
                ModuleType::JavaScript,
                ModuleSourceCode::String(code.into()),
                module_specifier,
                None,
            );
            return ModuleLoadResponse::Sync(Ok(module));
        }

        let path = match module_specifier.to_file_path() {
            Ok(p) => p,
            Err(_) => {
                return ModuleLoadResponse::Sync(Err(JsErrorBox::generic(
                    format!("viola-deno-runtime: only file:// URLs are supported, got {spec_str}"),
                )
                .into()));
            }
        };
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) => {
                return ModuleLoadResponse::Sync(Err(JsErrorBox::generic(
                    format!("viola-deno-runtime: failed to read {}: {e}", path.display()),
                )
                .into()));
            }
        };
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let is_ts = matches!(ext, "ts" | "tsx" | "mts" | "cts");
        let code = if is_ts {
            let src = match std::str::from_utf8(&bytes) {
                Ok(s) => s,
                Err(_) => {
                    return ModuleLoadResponse::Sync(Err(JsErrorBox::generic(
                        format!(
                            "viola-deno-runtime: non-UTF-8 TS source at {}",
                            path.display()
                        ),
                    )
                    .into()));
                }
            };
            match transpile::transpile_ts(spec_str, src) {
                Ok(js) => ModuleSourceCode::String(js.into()),
                Err(e) => {
                    return ModuleLoadResponse::Sync(Err(JsErrorBox::generic(
                        format!("viola-deno-runtime: transpile error: {e}"),
                    )
                    .into()));
                }
            }
        } else {
            ModuleSourceCode::Bytes(bytes.into_boxed_slice().into())
        };
        let module = ModuleSource::new(
            ModuleType::JavaScript,
            code,
            module_specifier,
            None,
        );
        ModuleLoadResponse::Sync(Ok(module))
    }
}

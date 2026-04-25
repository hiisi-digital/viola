//! Proc-macro companion to `viola-plugin-abi`.
//!
//! Ships `#[export_plugin]`, the attribute macro that emits the
//! `#[repr(C)] PluginDescriptor` static, the `__viola_plugin_descriptor`
//! exported fn, the capability table, and optional init / shutdown
//! trampolines on behalf of a plugin author.
//!
//! Emitted output references `::viola_plugin_abi::*` paths only.
//! Consumers add `viola-plugin-abi` as a regular dep alongside this
//! macro crate.
//!
//! Proc-macro crates run in the compiler host context and use `std`;
//! the emitted output remains `no_std`-compatible.

use proc_macro::TokenStream;
use proc_macro2::Span;
use quote::{format_ident, quote};
use syn::{
    parse::{Parse, ParseStream, Parser},
    parse_macro_input,
    punctuated::Punctuated,
    Expr, ExprArray, ExprLit, Ident, ItemStruct, Lit, LitStr, Path, Token,
};

/// `#[export_plugin]` attribute macro.
///
/// Attach to a plugin's top-level struct. Emits the descriptor, the
/// exported-fn the host resolves via `DESCRIPTOR_SYMBOL`, and the
/// capability table.
///
/// # Attribute parameters
///
/// - `id = "..."`: ASCII plugin id (e.g. `"org.viola.lint.no-yagni"`).
///   Defaults to the crate name from `CARGO_PKG_NAME`.
/// - `name = "..."`: human-readable display name. Defaults to `id`.
/// - `version = "MAJOR.MINOR.PATCH"`: explicit plugin version. Defaults
///   to `CARGO_PKG_VERSION` parsed at emission time.
/// - `manifest_version = "MAJOR.MINOR.PATCH"`: manifest schema version.
///   Defaults to `1.0.0`.
/// - `roles = [Runner | Grammar | Lint, ...]`: list of role variants
///   the plugin advertises. At least one is required.
/// - `capabilities = [TypePath, ...]`: type paths each implementing
///   `CapabilityExport`. Defaults to empty.
/// - `required_host_caps = [PATH, ...]`: const `CapabilityId`
///   expressions. Defaults to empty.
/// - `nam_produces = "MAJOR.MINOR.PATCH"`: NAM version this plugin
///   produces (runner role). Defaults to `0.0.0`.
/// - `nam_consumes = "MAJOR.MINOR.PATCH"`: NAM version this plugin
///   consumes (lint role). Defaults to `0.0.0`.
/// - `config_schema = "..."`: schema reference string. Defaults to `""`.
/// - `init = TypePath`: type implementing `InitHandler`. Optional.
/// - `shutdown = TypePath`: type implementing `ShutdownHandler`.
///   Optional.
///
/// See `docs/PLUGIN-ABI-V1-DESIGN.md` for the full descriptor shape.
#[proc_macro_attribute]
pub fn export_plugin(attr: TokenStream, item: TokenStream) -> TokenStream {
    let input = parse_macro_input!(item as ItemStruct);

    let attrs = match PluginAttrs::parse_from(attr.into()) {
        Ok(a) => a,
        Err(e) => return e.to_compile_error().into(),
    };

    let struct_ident = &input.ident;

    // id defaults to CARGO_PKG_NAME when attribute is absent.
    let id_bytes_tokens = match &attrs.id {
        Some(s) => {
            let lit =
                syn::LitByteStr::new(s.value().as_bytes(), Span::call_site());
            quote! { #lit }
        }
        None => quote! { env!("CARGO_PKG_NAME").as_bytes() },
    };

    // display_name defaults to id.
    let name_bytes_tokens = match &attrs.name {
        Some(s) => {
            let lit =
                syn::LitByteStr::new(s.value().as_bytes(), Span::call_site());
            quote! { #lit }
        }
        None => id_bytes_tokens.clone(),
    };

    let plugin_version_expr = match &attrs.version {
        Some(v) => match version_triple_from_lit(v) {
            Ok(t) => t,
            Err(e) => return e.to_compile_error().into(),
        },
        None => env_pkg_version_const(),
    };

    let manifest_version_expr = match &attrs.manifest_version {
        Some(v) => match version_triple_from_lit(v) {
            Ok(t) => t,
            Err(e) => return e.to_compile_error().into(),
        },
        None => quote! {
            ::viola_plugin_abi::VersionTriple {
                major: 1, minor: 0, patch: 0, _reserved: 0,
            }
        },
    };

    let nam_produces_expr = match &attrs.nam_produces {
        Some(v) => match version_triple_from_lit(v) {
            Ok(t) => t,
            Err(e) => return e.to_compile_error().into(),
        },
        None => zero_version_triple(),
    };
    let nam_consumes_expr = match &attrs.nam_consumes {
        Some(v) => match version_triple_from_lit(v) {
            Ok(t) => t,
            Err(e) => return e.to_compile_error().into(),
        },
        None => zero_version_triple(),
    };

    let roles_init = match build_role_set_expr(&attrs.roles) {
        Ok(t) => t,
        Err(e) => return e.to_compile_error().into(),
    };

    let required_caps_init = if attrs.required_host_caps.is_empty() {
        quote! {
            const __VIOLA_REQUIRED_HOST_CAPS:
                &[::viola_plugin_abi::CapabilityId] = &[];
        }
    } else {
        let caps = &attrs.required_host_caps;
        quote! {
            const __VIOLA_REQUIRED_HOST_CAPS:
                &[::viola_plugin_abi::CapabilityId] = &[
                #( #caps ),*
            ];
        }
    };

    let capabilities_init = if attrs.capabilities.is_empty() {
        quote! {
            const __VIOLA_CAPABILITIES:
                &[::viola_plugin_abi::CapabilityEntry] = &[];
        }
    } else {
        let caps = attrs.capabilities.iter().map(|ty| {
            quote! {
                ::viola_plugin_abi::CapabilityEntry {
                    id: <#ty as ::viola_plugin_abi::CapabilityExport>::ID,
                    vtable_ptr:
                        <#ty as ::viola_plugin_abi::CapabilityExport>
                            ::VTABLE_PTR,
                }
            }
        });
        quote! {
            const __VIOLA_CAPABILITIES:
                &[::viola_plugin_abi::CapabilityEntry] = &[
                #( #caps ),*
            ];
        }
    };

    let config_schema_bytes = match &attrs.config_schema {
        Some(s) => {
            let lit =
                syn::LitByteStr::new(s.value().as_bytes(), Span::call_site());
            quote! { #lit }
        }
        None => quote! { b"" },
    };

    let (init_trampoline, init_slot) = match &attrs.init {
        Some(path) => {
            let fn_ident =
                format_ident!("__viola_init_trampoline_{}", struct_ident);
            (
                quote! {
                    #[allow(non_snake_case)]
                    unsafe extern "C" fn #fn_ident(
                        host_ctx: *mut ::core::ffi::c_void,
                    ) -> ::viola_plugin_abi::AbiStatus {
                        // SAFETY: host owns host_ctx; stable until the
                        // matching shutdown returns.
                        unsafe {
                            <#path as ::viola_plugin_abi::InitHandler>
                                ::init(host_ctx)
                        }
                    }
                },
                quote! { Some(#fn_ident) },
            )
        }
        None => (quote! {}, quote! { None }),
    };

    let (shutdown_trampoline, shutdown_slot) = match &attrs.shutdown {
        Some(path) => {
            let fn_ident =
                format_ident!("__viola_shutdown_trampoline_{}", struct_ident);
            (
                quote! {
                    #[allow(non_snake_case)]
                    unsafe extern "C" fn #fn_ident(
                        host_ctx: *mut ::core::ffi::c_void,
                    ) -> ::viola_plugin_abi::AbiStatus {
                        // SAFETY: same opaque pointer threaded from init.
                        unsafe {
                            <#path as ::viola_plugin_abi::ShutdownHandler>
                                ::shutdown(host_ctx)
                        }
                    }
                },
                quote! { Some(#fn_ident) },
            )
        }
        None => (quote! {}, quote! { None }),
    };

    let expanded = quote! {
        #input

        const __VIOLA_PLUGIN_ID: &[u8] = #id_bytes_tokens;
        const __VIOLA_PLUGIN_DISPLAY_NAME: &[u8] = #name_bytes_tokens;
        const __VIOLA_PLUGIN_VERSION:
            ::viola_plugin_abi::VersionTriple = #plugin_version_expr;
        const __VIOLA_MANIFEST_VERSION:
            ::viola_plugin_abi::VersionTriple = #manifest_version_expr;
        const __VIOLA_NAM_PRODUCES:
            ::viola_plugin_abi::VersionTriple = #nam_produces_expr;
        const __VIOLA_NAM_CONSUMES:
            ::viola_plugin_abi::VersionTriple = #nam_consumes_expr;
        const __VIOLA_CONFIG_SCHEMA: &[u8] = #config_schema_bytes;

        #required_caps_init
        #capabilities_init
        #init_trampoline
        #shutdown_trampoline

        #[used]
        static __VIOLA_PLUGIN_DESCRIPTOR:
            ::viola_plugin_abi::PluginDescriptor =
        ::viola_plugin_abi::PluginDescriptor {
            abi_version: ::viola_plugin_abi::HOST_ABI_MAJOR,
            manifest_version:
                ::viola_plugin_abi::ManifestVersion(__VIOLA_MANIFEST_VERSION),
            identity: ::viola_plugin_abi::PluginIdentity {
                plugin_id: ::viola_plugin_abi::BytesRef {
                    data: __VIOLA_PLUGIN_ID.as_ptr(),
                    len: __VIOLA_PLUGIN_ID.len(),
                },
                display_name: ::viola_plugin_abi::BytesRef {
                    data: __VIOLA_PLUGIN_DISPLAY_NAME.as_ptr(),
                    len: __VIOLA_PLUGIN_DISPLAY_NAME.len(),
                },
                plugin_version:
                    ::viola_plugin_abi::PluginVersion(__VIOLA_PLUGIN_VERSION),
            },
            roles: #roles_init,
            capabilities_ptr: __VIOLA_CAPABILITIES.as_ptr(),
            capabilities_len: __VIOLA_CAPABILITIES.len(),
            nam_produces:
                ::viola_plugin_abi::NamVersion(__VIOLA_NAM_PRODUCES),
            nam_consumes:
                ::viola_plugin_abi::NamVersion(__VIOLA_NAM_CONSUMES),
            required_host_caps_ptr: __VIOLA_REQUIRED_HOST_CAPS.as_ptr(),
            required_host_caps_len: __VIOLA_REQUIRED_HOST_CAPS.len(),
            config_schema: ::viola_plugin_abi::BytesRef {
                data: __VIOLA_CONFIG_SCHEMA.as_ptr(),
                len: __VIOLA_CONFIG_SCHEMA.len(),
            },
            init_fn: #init_slot,
            shutdown_fn: #shutdown_slot,
        };

        #[unsafe(no_mangle)]
        pub extern "C" fn __viola_plugin_descriptor()
            -> *const ::viola_plugin_abi::PluginDescriptor
        {
            &__VIOLA_PLUGIN_DESCRIPTOR
        }
    };

    expanded.into()
}

fn version_triple_from_lit(
    v: &LitStr,
) -> Result<proc_macro2::TokenStream, syn::Error> {
    match parse_semver(&v.value()) {
        Ok((maj, min, pat)) => Ok(quote! {
            ::viola_plugin_abi::VersionTriple {
                major: #maj, minor: #min, patch: #pat, _reserved: 0,
            }
        }),
        Err(msg) => Err(syn::Error::new(v.span(), msg)),
    }
}

fn zero_version_triple() -> proc_macro2::TokenStream {
    quote! {
        ::viola_plugin_abi::VersionTriple {
            major: 0, minor: 0, patch: 0, _reserved: 0,
        }
    }
}

fn env_pkg_version_const() -> proc_macro2::TokenStream {
    quote! {
        {
            const fn __viola_parse_env_semver()
                -> ::viola_plugin_abi::VersionTriple
            {
                let bytes = env!("CARGO_PKG_VERSION").as_bytes();
                let mut i = 0usize;
                let mut major: u16 = 0;
                while i < bytes.len() && bytes[i] != b'.' {
                    major = major * 10 + (bytes[i] - b'0') as u16;
                    i += 1;
                }
                i += 1;
                let mut minor: u16 = 0;
                while i < bytes.len() && bytes[i] != b'.' {
                    minor = minor * 10 + (bytes[i] - b'0') as u16;
                    i += 1;
                }
                i += 1;
                let mut patch: u16 = 0;
                while i < bytes.len()
                    && bytes[i] != b'-'
                    && bytes[i] != b'+'
                {
                    patch = patch * 10 + (bytes[i] - b'0') as u16;
                    i += 1;
                }
                ::viola_plugin_abi::VersionTriple {
                    major, minor, patch, _reserved: 0,
                }
            }
            __viola_parse_env_semver()
        }
    }
}

fn build_role_set_expr(
    roles: &[Ident],
) -> Result<proc_macro2::TokenStream, syn::Error> {
    if roles.is_empty() {
        return Err(syn::Error::new(
            Span::call_site(),
            "#[export_plugin] requires at least one role: \
             roles = [Runner | Grammar | Lint]",
        ));
    }
    for r in roles {
        let s = r.to_string();
        if s != "Runner" && s != "Grammar" && s != "Lint" {
            return Err(syn::Error::new(
                r.span(),
                format!(
                    "unknown role `{}`. Supported roles: Runner, Grammar, Lint.",
                    s
                ),
            ));
        }
    }
    let entries = roles.iter().map(|r| {
        quote! { ::viola_plugin_abi::Role::#r }
    });
    let mut iter = entries.into_iter();
    let first = iter.next().unwrap();
    let rest = iter;
    Ok(quote! {
        {
            let mut set = ::viola_plugin_abi::RoleSet::single(#first);
            #( set = set.with(#rest); )*
            set
        }
    })
}

fn parse_semver(s: &str) -> Result<(u16, u16, u16), &'static str> {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 3 {
        return Err(
            "version must be MAJOR.MINOR.PATCH (three dot-separated integers)",
        );
    }
    let major = parts[0]
        .parse::<u16>()
        .map_err(|_| "major is not a u16 integer")?;
    let minor = parts[1]
        .parse::<u16>()
        .map_err(|_| "minor is not a u16 integer")?;
    let patch_raw = parts[2];
    let patch_num_end = patch_raw
        .find(|c: char| c == '-' || c == '+')
        .unwrap_or(patch_raw.len());
    let patch = patch_raw[..patch_num_end]
        .parse::<u16>()
        .map_err(|_| "patch is not a u16 integer")?;
    Ok((major, minor, patch))
}

struct PluginAttrs {
    id: Option<LitStr>,
    name: Option<LitStr>,
    version: Option<LitStr>,
    manifest_version: Option<LitStr>,
    roles: Vec<Ident>,
    capabilities: Vec<Path>,
    required_host_caps: Vec<Expr>,
    nam_produces: Option<LitStr>,
    nam_consumes: Option<LitStr>,
    config_schema: Option<LitStr>,
    init: Option<Path>,
    shutdown: Option<Path>,
}

impl PluginAttrs {
    fn parse_from(tokens: proc_macro2::TokenStream) -> syn::Result<Self> {
        let mut out = Self {
            id: None,
            name: None,
            version: None,
            manifest_version: None,
            roles: Vec::new(),
            capabilities: Vec::new(),
            required_host_caps: Vec::new(),
            nam_produces: None,
            nam_consumes: None,
            config_schema: None,
            init: None,
            shutdown: None,
        };

        if tokens.is_empty() {
            return Ok(out);
        }

        let entries: Punctuated<AttrEntry, Token![,]> =
            Punctuated::<AttrEntry, Token![,]>::parse_terminated
                .parse2(tokens)?;

        for entry in entries {
            let key_str = entry.key.to_string();
            match key_str.as_str() {
                "id" => out.id = Some(entry.expect_lit_str()?),
                "name" => out.name = Some(entry.expect_lit_str()?),
                "version" => out.version = Some(entry.expect_lit_str()?),
                "manifest_version" => {
                    out.manifest_version = Some(entry.expect_lit_str()?);
                }
                "roles" => out.roles = entry.expect_ident_array()?,
                "capabilities" => {
                    out.capabilities = entry.expect_path_array()?;
                }
                "required_host_caps" => {
                    out.required_host_caps = entry.expect_expr_array()?;
                }
                "nam_produces" => {
                    out.nam_produces = Some(entry.expect_lit_str()?);
                }
                "nam_consumes" => {
                    out.nam_consumes = Some(entry.expect_lit_str()?);
                }
                "config_schema" => {
                    out.config_schema = Some(entry.expect_lit_str()?);
                }
                "init" => out.init = Some(entry.expect_path()?),
                "shutdown" => out.shutdown = Some(entry.expect_path()?),
                _ => {
                    return Err(syn::Error::new(
                        entry.key.span(),
                        format!(
                            "unknown #[export_plugin] parameter `{}`. \
                             Supported keys: id, name, version, manifest_version, \
                             roles, capabilities, required_host_caps, \
                             nam_produces, nam_consumes, config_schema, \
                             init, shutdown.",
                            key_str
                        ),
                    ));
                }
            }
        }
        Ok(out)
    }
}

struct AttrEntry {
    key: Ident,
    _eq: Token![=],
    value: Expr,
}

impl Parse for AttrEntry {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let key: Ident = input.parse()?;
        let _eq: Token![=] = input.parse()?;
        let value: Expr = input.parse()?;
        Ok(Self { key, _eq, value })
    }
}

impl AttrEntry {
    fn expect_lit_str(self) -> syn::Result<LitStr> {
        match self.value {
            Expr::Lit(ExprLit { lit: Lit::Str(s), .. }) => Ok(s),
            other => Err(syn::Error::new_spanned(
                other,
                format!("expected string literal for `{}`", self.key),
            )),
        }
    }

    fn expect_path(self) -> syn::Result<Path> {
        match self.value {
            Expr::Path(p) => Ok(p.path),
            other => Err(syn::Error::new_spanned(
                other,
                format!("expected a type path for `{}`", self.key),
            )),
        }
    }

    fn expect_expr_array(self) -> syn::Result<Vec<Expr>> {
        match self.value {
            Expr::Array(ExprArray { elems, .. }) => {
                Ok(elems.into_iter().collect())
            }
            other => Err(syn::Error::new_spanned(
                other,
                format!("expected `[...]` array for `{}`", self.key),
            )),
        }
    }

    fn expect_path_array(self) -> syn::Result<Vec<Path>> {
        match self.value {
            Expr::Array(ExprArray { elems, .. }) => {
                let mut out = Vec::with_capacity(elems.len());
                for e in elems {
                    match e {
                        Expr::Path(p) => out.push(p.path),
                        other => {
                            return Err(syn::Error::new_spanned(
                                other,
                                "expected a type path inside `[...]`",
                            ));
                        }
                    }
                }
                Ok(out)
            }
            other => Err(syn::Error::new_spanned(
                other,
                format!("expected `[...]` array for `{}`", self.key),
            )),
        }
    }

    fn expect_ident_array(self) -> syn::Result<Vec<Ident>> {
        match self.value {
            Expr::Array(ExprArray { elems, .. }) => {
                let mut out = Vec::with_capacity(elems.len());
                for e in elems {
                    match e {
                        Expr::Path(p) if p.path.get_ident().is_some() => {
                            out.push(p.path.get_ident().unwrap().clone());
                        }
                        other => {
                            return Err(syn::Error::new_spanned(
                                other,
                                "expected a bare identifier inside `[...]`",
                            ));
                        }
                    }
                }
                Ok(out)
            }
            other => Err(syn::Error::new_spanned(
                other,
                format!("expected `[...]` array for `{}`", self.key),
            )),
        }
    }
}

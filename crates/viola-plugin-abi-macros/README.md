# `viola-plugin-abi-macros`

Proc-macro companion to [`viola-plugin-abi`](../viola-plugin-abi). Ships
the `#[export_plugin]` attribute macro that emits the `#[repr(C)]`
`PluginDescriptor` static, the `__viola_plugin_descriptor` exported
function, the capability table, and optional init / shutdown
trampolines on behalf of a plugin author.

## Usage

```rust,ignore
use viola_plugin_abi_macros::export_plugin;
use viola_plugin_abi::{CapabilityExport, CapabilityId, AbiStatus};

struct MyLintCap;
impl CapabilityExport for MyLintCap {
    const ID: CapabilityId =
        CapabilityId::from_name("viola.lint.evaluate.v1");
    const VTABLE_PTR: *const core::ffi::c_void = /* ... */;
}

#[export_plugin(
    id = "org.example.lint",
    version = "0.1.0",
    roles = [Lint],
    capabilities = [MyLintCap],
    nam_consumes = "1.0.0",
)]
struct MyPlugin;
```

The host opens the resulting `cdylib`, looks up the
`__viola_plugin_descriptor` symbol, calls it, and validates the
returned descriptor against `viola-plugin-abi`'s contract.

## Why a separate crate

`viola-plugin-abi` is `#![no_std]` and free of `syn`/`quote`/
proc-macro tooling. Proc-macro crates run in the compiler host context
and use `std`; keeping them apart preserves the contract crate's
embedded-friendly profile while still offering ergonomic plugin
authoring. Plugin authors who prefer to hand-implement the descriptor
can skip this crate entirely.

## Source of truth

`docs/PLUGIN-ABI-V1-DESIGN.md` at the repository root. Section 24
documents the macro-driven static monomorphization pattern this crate
implements.

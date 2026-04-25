#![no_std]
#![deny(unsafe_op_in_unsafe_fn)]

//! Viola.toml config schema + zero-copy no_alloc TOML subset parser.
//!
//! Per `docs/PLUGIN-ABI-V1-DESIGN.md` §8 / §16.3, the canonical viola
//! config artifact is TOML. This crate ships the v1 schema and a
//! minimal parser that handles exactly the shape v1 needs: top-level
//! `key = "string"` and `key = ["string", ...]` entries, line comments
//! starting with `#`, and ASCII whitespace between tokens. Datetimes,
//! multiline strings, dotted keys, sub-tables, and inline tables are
//! out of scope; the parser rejects them deterministically.
//!
//! Parser output is zero-copy: every string slot is a `&[u8]` slice
//! into the caller's input buffer. The parser allocates nothing and
//! requires no allocator. Caller-supplied storage geometry comes
//! through the [`ViolaConfig`] const-generic capacity.
//!
//! ## v1 schema
//!
//! ```toml
//! # Path to the runner role's cdylib.
//! runner = "plugins/viola-runner-rust.dylib"
//!
//! # Paths to grammar role cdylibs. Order is significant; runners may
//! # iterate in declaration order.
//! grammars = [
//!     "plugins/viola-grammar-ts.dylib",
//!     "plugins/viola-grammar-rust.dylib",
//! ]
//!
//! # Paths to lint role cdylibs. Order does not affect output (the
//! # host sorts diagnostics deterministically per §10).
//! lints = [
//!     "plugins/viola-lint-no-yagni.dylib",
//! ]
//!
//! # Optional TS plugin runtime. When present, viola-cli auto-loads
//! # viola-deno-runtime.dylib (sibling to the executable) as the deno-
//! # backed runner / grammar / lint and feeds the user's TS config in
//! # via `lint_config`. Triggers the embedded TS pipeline.
//! [ts]
//! config = "viola.config.ts"
//! ```
//!
//! Per-lint structured config and plugin-set scopes (include/exclude
//! globs) are deferred to a follow-up round; the v1 parser leaves the
//! corresponding fields empty when those keys are absent and rejects
//! them with [`ConfigError::UnknownKey`] when present.

use notko::{Maybe, Outcome};

mod parse;

pub use parse::{ConfigError, parse};

/// Resolved viola configuration with caller-provided fixed geometry.
///
/// `MAX_PLUGINS` bounds the number of grammar OR lint plugins (each
/// gets its own array of that size). Setting it to the larger of the
/// two expected counts is the simplest tuning. For the v1 lint
/// runtime where typical configurations carry under a dozen lints,
/// `MAX_PLUGINS = 16` is a comfortable starting point.
#[derive(Copy, Clone)]
pub struct ViolaConfig<'a, const MAX_PLUGINS: usize> {
    pub runner: Maybe<&'a [u8]>,
    pub grammars: [&'a [u8]; MAX_PLUGINS],
    pub grammar_len: arvo::USize,
    pub lints: [&'a [u8]; MAX_PLUGINS],
    pub lint_len: arvo::USize,
    /// Path to the user's `viola.config.ts`, if a `[ts]` section is
    /// present. When set, viola-cli auto-loads `viola-deno-runtime`
    /// (sibling to the executable) as runner / grammar / lint and
    /// passes this path through `lint_config` so the embedded TS
    /// runtime can resolve and execute the user's config.
    pub ts_config: Maybe<&'a [u8]>,
}

impl<const MAX_PLUGINS: usize> ViolaConfig<'_, MAX_PLUGINS> {
    /// Empty config. All slots are absent / zero-length.
    pub const fn empty() -> Self {
        Self {
            runner: Maybe::Isnt,
            grammars: [&[]; MAX_PLUGINS],
            grammar_len: arvo::USize(0),
            lints: [&[]; MAX_PLUGINS],
            lint_len: arvo::USize(0),
            ts_config: Maybe::Isnt,
        }
    }
}

impl<const MAX_PLUGINS: usize> ViolaConfig<'_, MAX_PLUGINS> {
    /// View the populated grammar slots as a slice.
    pub fn grammars_slice(&self) -> &[&[u8]] {
        &self.grammars[..self.grammar_len.0]
    }

    /// View the populated lint slots as a slice.
    pub fn lints_slice(&self) -> &[&[u8]] {
        &self.lints[..self.lint_len.0]
    }
}

impl<const MAX_PLUGINS: usize> Default for ViolaConfig<'_, MAX_PLUGINS> {
    fn default() -> Self {
        Self::empty()
    }
}

/// Convenience: parse into a default-sized [`ViolaConfig`].
pub fn parse_default<'a>(
    input: &'a [u8],
) -> Outcome<ViolaConfig<'a, 16>, ConfigError> {
    parse::<16>(input)
}

#![no_std]
#![no_main]

//! `viola-cli`: host executable.
//!
//! `#![no_std]` + `#![no_main]` libc entry. Reads `./viola.toml` (or
//! the path supplied as argv[1]), parses it via [`viola_config`],
//! loads the configured runner + lint plugins through
//! [`viola_core::ExtensionHost`], drives [`viola_core::pipeline::run`]
//! over a single empty `RunScope`, sorts the captured diagnostics per
//! `docs/PLUGIN-ABI-V1-DESIGN.md` §10, and emits one line per
//! diagnostic to stderr. Exit codes:
//!
//! - `0`: config parsed, plugins ran, zero diagnostics
//! - `1`: config parsed, plugins ran, at least one diagnostic
//! - `2`: config could not be read or parsed
//! - `3`: plugin load or pipeline invocation failed
//!
//! No `alloc`, no formatting infrastructure beyond [`fmt`]'s decimal
//! converter, no `core::fmt` machinery linked in. All buffers are
//! fixed-cap and allocated on the entry-frame stack.

use core::ffi::c_void;
use core::panic::PanicInfo;

mod fmt;
mod io;

use hilavitkutin_api::{Len, Push};
use viola_core::{
    BytesRef, PROVIDER_LINT_EVALUATE, PROVIDER_RUNNER_EXECUTE_SCOPE, ProviderId,
    Diagnostic, Extension, ExtensionHost, ExtensionRequirement, RunScope,
    RunSurface, Session,
    aggregate::sort_diagnostics,
    pipeline::run,
};

const MAX_PLUGINS: usize = 16;
const MAX_CONFIG_BYTES: usize = 64 * 1024;
const MAX_PATH_BYTES: usize = 4096;
const MAX_DIAGNOSTICS: usize = 256;
const CAPTURE_ARENA_BYTES: usize = 64 * 1024;

const EXIT_OK: i32 = 0;
const EXIT_DIAG: i32 = 1;
const EXIT_CONFIG: i32 = 2;
const EXIT_PLUGIN: i32 = 3;
/// Posix-conventional "command not found" exit code. Used when the
/// passthrough path cannot exec deno (typically because deno is not
/// on PATH). Distinct from EXIT_PLUGIN so tooling that inspects exit
/// codes can distinguish "missing runtime" from "plugin failed".
const EXIT_EXEC: i32 = 127;

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    #[cfg(unix)]
    unsafe {
        libc::abort();
    }
    #[cfg(not(unix))]
    loop {}
}

// no_std binary without panic-unwind still references the EH
// personality through the link table; provide an empty stub so the
// linker resolves on darwin.
#[cfg(not(test))]
#[unsafe(no_mangle)]
pub extern "C" fn rust_eh_personality() {}

#[cfg(not(unix))]
#[unsafe(no_mangle)]
pub extern "C" fn main(_argc: i32, _argv: *const *const u8) -> i32 {
    EXIT_CONFIG
}

#[cfg(unix)]
#[unsafe(no_mangle)]
pub extern "C" fn main(argc: i32, argv: *const *const u8) -> i32 {
    let args = parse_args(argc, argv);
    let config_path = args.config_path;

    let mut config_buf = [0u8; MAX_CONFIG_BYTES];
    let bytes_read = io::read_file(config_path, &mut config_buf);

    // Pure-TS path: no viola.toml means the user runs viola the way
    // the existing TS CLI does: point at a viola.config.ts in cwd.
    // Pass through to `deno run -A jsr:@hiisi/viola-cli` with the
    // user's argv so behaviour and output match the existing CLI
    // exactly. Returns only on exec failure.
    let bytes = match bytes_read {
        notko::Maybe::Is(b) => b,
        notko::Maybe::Isnt => {
            return passthrough_to_deno_cli(argc, argv);
        }
    };

    let cfg = match viola_config::parse::<MAX_PLUGINS>(bytes) {
        notko::Outcome::Ok(c) => c,
        notko::Outcome::Err(e) => {
            emit_config_error(&e);
            return EXIT_CONFIG;
        }
    };

    // v2 plugin loading: when `[viola] version = 2` is declared,
    // walk `plugins = [...]` and categorise each loaded plugin by
    // descriptor provider (runner / lint). v2 ignores the v1-only
    // `runner` / `grammars` / `lints` keys (the parser already
    // rejects them under version=2). `[gates]` / `[gates.<lint>]`
    // are evaluated when `--gate <name>` is supplied (PR-D-2);
    // `[[severity]]` and `[lint.<id>]` plugin-config wiring lands
    // in PR-D-3 / PR-D-4.
    if matches!(cfg.version, notko::Maybe::Is(arvo::USize(2))) {
        return run_v2(&cfg, args.gate);
    }

    // Pure-TS path with explicit viola.toml [ts] but no Rust plugins:
    // also pass through to the JSR CLI. The Rust v1 ABI plugin path
    // engages only when viola.toml configures a Rust runner or any
    // Rust grammars / lints. This matches the "drop-in replacement"
    // promise: TS users who never wrote a viola.toml or wrote one
    // with only [ts] see the existing TS CLI's behaviour byte-for-byte.
    let has_rust_plugins = matches!(cfg.runner, notko::Maybe::Is(_))
        || cfg.grammar_len.0 > 0
        || cfg.lint_len.0 > 0;
    if !has_rust_plugins {
        return passthrough_to_deno_cli(argc, argv);
    }

    // Resolve plugin loading strategy. When `[ts]` is present, the
    // user opts into the embedded deno runtime: it acts as runner +
    // grammar + lint, sourced from the sibling `viola-deno-runtime`
    // cdylib. The runtime stays opt-in so plain Rust-plugin setups do
    // not pay the V8 init cost.
    let ts_active = matches!(cfg.ts_config, notko::Maybe::Is(_));

    let runner_path: &[u8] = if ts_active {
        TS_RUNTIME_DYLIB
    } else {
        match cfg.runner {
            notko::Maybe::Is(p) => p,
            notko::Maybe::Isnt => {
                io::eprintln(
                    b"viola-cli: viola.toml is missing required `runner` key (or a `[ts]` section)",
                );
                return EXIT_CONFIG;
            }
        }
    };

    let host_caps: &'static [ProviderId] = &[];
    let host = ExtensionHost::new(host_caps);

    let runner = match load_plugin(&host, runner_path) {
        notko::Maybe::Is(ext) => ext,
        notko::Maybe::Isnt => {
            io::eprint(b"viola-cli: failed to load runner: ");
            io::eprintln(runner_path);
            return EXIT_PLUGIN;
        }
    };

    // Lint extensions live in a `viola_core::Session<MAX_PLUGINS>`,
    // which owns each `Extension` and drops them in reverse-insertion
    // order on scope exit (the §7.4 LIFO shutdown contract). The
    // runner is bound separately; because it was bound first, it
    // drops last (after the session), giving runner-shuts-down-after-
    // every-lint LIFO across the whole load set.
    //
    // When `[ts]` is active, the deno runtime is loaded once as the
    // runner and (here) once again as a lint slot. Two Extension
    // handles refer to the same dylib, but each gets its own
    // descriptor + provider lookup; this keeps the v1 dispatch path
    // uniform without giving the runner double duty.
    let ts_lint: [&[u8]; 1] = [TS_RUNTIME_DYLIB];
    let lint_paths: &[&[u8]] = if ts_active {
        &ts_lint[..]
    } else {
        cfg.lints_slice()
    };
    let lint_count = lint_paths.len();
    let mut lint_session: Session<MAX_PLUGINS> = Session::new();

    let mut load_failed = false;
    let mut i = 0;
    while i < lint_count {
        match load_plugin(&host, lint_paths[i]) {
            notko::Maybe::Is(ext) => {
                if matches!(lint_session.push(ext), notko::Maybe::Is(_)) {
                    io::eprintln(
                        b"viola-cli: too many lints loaded for MAX_PLUGINS",
                    );
                    load_failed = true;
                    break;
                }
            }
            notko::Maybe::Isnt => {
                io::eprint(b"viola-cli: failed to load lint: ");
                io::eprintln(lint_paths[i]);
                load_failed = true;
                break;
            }
        }
        i += 1;
    }

    let loaded_lints = *lint_session.len();

    let exit = if load_failed {
        EXIT_PLUGIN
    } else {
        // Build &[&Extension] over the session's resident slots.
        let mut lint_refs: [core::mem::MaybeUninit<&Extension>;
            MAX_PLUGINS] =
            [const { core::mem::MaybeUninit::uninit() }; MAX_PLUGINS];
        let mut k = 0;
        while k < loaded_lints {
            if let notko::Maybe::Is(ext) = lint_session.get(k) {
                lint_refs[k].write(ext);
            }
            k += 1;
        }
        // SAFETY: lint_refs[..loaded_lints] is fully initialised by
        // the session-walk above; the session pins those `Extension`
        // values for the rest of this scope.
        let lints: &[&Extension] = unsafe {
            core::slice::from_raw_parts(
                lint_refs.as_ptr() as *const &Extension,
                loaded_lints,
            )
        };

        let mut configs = [BytesRef::EMPTY; MAX_PLUGINS];
        let mut ts_resolve_buf = [0u8; MAX_PATH_BYTES];
        if ts_active && loaded_lints > 0 {
            // Pass the user's viola.config.ts path through the lint
            // config bytes. Pre-resolve relative paths against the
            // parent directory of viola.toml so that running
            // `viola /path/to/proj/viola.toml` from any cwd still
            // finds `[ts].config = "viola.config.ts"` next to the
            // toml file, not next to wherever the user happened to
            // be when they invoked viola.
            if let notko::Maybe::Is(ts_path) = cfg.ts_config {
                let resolved = resolve_ts_config_path(
                    config_path,
                    ts_path,
                    &mut ts_resolve_buf,
                );
                configs[0] = BytesRef {
                    data: resolved.as_ptr(),
                    len: arvo::USize(resolved.len()),
                };
            }
        }

        let scope = RunScope {
            workspace_root: BytesRef::EMPTY,
            files: core::ptr::null(),
            files_len: arvo::USize(0),
            surface: RunSurface::Cli,
            ci: 0,
            _reserved: [0; 3],
        };

        let mut sink = CaptureSink::new();
        let report = match run(
            &runner,
            lints,
            &configs[..loaded_lints],
            &scope,
            core::ptr::null_mut(),
            &mut sink,
        ) {
            notko::Outcome::Ok(r) => r,
            notko::Outcome::Err(_) => {
                io::eprintln(b"viola-cli: pipeline invocation failed");
                return EXIT_PLUGIN;
            }
        };

        sink.sort();
        sink.emit();

        if let notko::Maybe::Is(failure) = report.first_failure {
            let _ = failure;
            io::eprintln(b"viola-cli: one or more lints failed during run");
        }

        if *sink.count() > 0 { EXIT_DIAG } else { EXIT_OK }
    };

    // §7.4 LIFO drop ordering on scope exit is governed by RAII
    // declaration order: `runner` was declared before `lint_session`,
    // so `lint_session` drops first (lints LIFO inside the session),
    // then `runner`. No explicit `drop` calls or manual sequencing
    // needed; preserving declaration order is the entire contract.
    exit
}

/// Run the v2 schema pipeline. Walks `cfg.plugins[]` once, loads
/// each plugin, classifies by descriptor provider:
/// `PROVIDER_RUNNER_EXECUTE_SCOPE` -> runner role,
/// `PROVIDER_LINT_EVALUATE` -> lint role. A multi-role plugin (descriptor
/// exports both) appears in both categories; the same `Extension`
/// reference is passed twice to `pipeline::run`, mirroring the v1
/// `[ts]` shape where the deno cdylib was loaded twice.
///
/// Constraints:
/// - At most one plugin may export `PROVIDER_RUNNER_EXECUTE_SCOPE`. Two
///   runners is a config error (multi-runner is not yet a defined
///   composition in the v1 ABI).
/// - At least one runner is required. v2 may eventually permit
///   "lint-only" runs that auto-synthesise an empty NAM, but that is
///   #221 PR-D follow-up scope; today, no runner means no work.
///
/// `[gates]` / `[gates.<lint>]` are evaluated when `gate` is
/// `Maybe::Is(<name>)` (PR-D-2); without a `--gate` flag, exit-code
/// behaviour matches v1 (any captured diagnostic flips to
/// `EXIT_DIAG`). `[[severity]]` rules and `[lint.<id>]` plugin
/// configs are still parsed-only; PR-D-3 / PR-D-4 wire those.
#[cfg(unix)]
fn run_v2<'a>(
    cfg: &viola_config::ViolaConfig<'a, MAX_PLUGINS>,
    gate: notko::Maybe<&[u8]>,
) -> i32 {
    let host_caps: &'static [ProviderId] = &[];
    let host = ExtensionHost::new(host_caps);

    // All loaded plugins live in a single `Session<MAX_PLUGINS>`.
    // The session's Drop runs each plugin's `shutdown_fn` in reverse-
    // insertion order on scope exit, satisfying §7.4 LIFO without
    // any manual sequencing.
    let mut session: Session<MAX_PLUGINS> = Session::new();

    let mut runner_idx: notko::Maybe<arvo::USize> = notko::Maybe::Isnt;
    let mut lint_indices: [arvo::USize; MAX_PLUGINS] =
        [arvo::USize(0); MAX_PLUGINS];
    let mut lint_count = arvo::USize(0);

    let plugins = cfg.plugins_slice();
    if plugins.is_empty() {
        io::eprintln(
            b"viola-cli: viola.toml v2 has no plugins. Add `plugins = [...]` to load Rust plugins.",
        );
        return EXIT_CONFIG;
    }

    let mut load_failed = false;
    let mut i = 0;
    while i < plugins.len() {
        match load_plugin(&host, plugins[i]) {
            notko::Maybe::Is(ext) => {
                // Classify by descriptor provider presence. The
                // load is required-strict, so a missing provider
                // surface here is just role inference, not a load
                // failure.
                let has_runner = matches!(
                    ext.provider(PROVIDER_RUNNER_EXECUTE_SCOPE),
                    notko::Maybe::Is(_)
                );
                let has_lint = matches!(
                    ext.provider(PROVIDER_LINT_EVALUATE),
                    notko::Maybe::Is(_)
                );
                if matches!(session.push(ext), notko::Maybe::Is(_)) {
                    io::eprintln(
                        b"viola-cli: too many plugins loaded for MAX_PLUGINS",
                    );
                    load_failed = true;
                    break;
                }
                if has_runner {
                    if let notko::Maybe::Is(_) = runner_idx {
                        io::eprintln(
                            b"viola-cli: multiple plugins export PROVIDER_RUNNER_EXECUTE_SCOPE; only one runner per project",
                        );
                        load_failed = true;
                        break;
                    }
                    runner_idx = notko::Maybe::Is(arvo::USize(i));
                }
                if has_lint {
                    lint_indices[lint_count.0] = arvo::USize(i);
                    lint_count = arvo::USize(lint_count.0 + 1);
                }
                if !has_runner && !has_lint {
                    io::eprint(b"viola-cli: plugin has no runner or lint provider: ");
                    io::eprintln(plugins[i]);
                    load_failed = true;
                    break;
                }
            }
            notko::Maybe::Isnt => {
                io::eprint(b"viola-cli: failed to load plugin: ");
                io::eprintln(plugins[i]);
                load_failed = true;
                break;
            }
        }
        i += 1;
    }

    if load_failed {
        return EXIT_PLUGIN;
    }

    let runner_slot = match runner_idx {
        notko::Maybe::Is(idx) => idx,
        notko::Maybe::Isnt => {
            io::eprintln(
                b"viola-cli: viola.toml v2 has no runner-capable plugin (export PROVIDER_RUNNER_EXECUTE_SCOPE)",
            );
            return EXIT_CONFIG;
        }
    };
    let runner: &Extension = match session.get(runner_slot.0) {
        notko::Maybe::Is(ext) => ext,
        notko::Maybe::Isnt => {
            io::eprintln(b"viola-cli: internal error: runner slot vacated");
            return EXIT_PLUGIN;
        }
    };

    let mut lint_refs: [core::mem::MaybeUninit<&Extension>; MAX_PLUGINS] =
        [const { core::mem::MaybeUninit::uninit() }; MAX_PLUGINS];
    // Track refs actually written rather than reusing `lint_count`.
    // Defensive against any future Session shape that could vacate a
    // slot between push and read; today the session has no take/
    // remove API, so written == lint_count is invariant, but keying
    // the slice length to actual writes makes the unsafe contract
    // independent of that invariant.
    let mut written = 0usize;
    let mut k = 0;
    while k < lint_count.0 {
        if let notko::Maybe::Is(ext) = session.get(lint_indices[k].0) {
            lint_refs[written].write(ext);
            written += 1;
        }
        k += 1;
    }
    // SAFETY: lint_refs[..written] is fully initialised by the
    // session-walk above; the session pins those Extension values
    // for the rest of this scope.
    let lints: &[&Extension] = unsafe {
        core::slice::from_raw_parts(
            lint_refs.as_ptr() as *const &Extension,
            written,
        )
    };

    let configs = [BytesRef::EMPTY; MAX_PLUGINS];

        let scope = RunScope {
            workspace_root: BytesRef::EMPTY,
            files: core::ptr::null(),
            files_len: arvo::USize(0),
            surface: RunSurface::Cli,
            ci: 0,
            _reserved: [0; 3],
        };

    let mut sink = CaptureSink::new();
    let report = match run(
        runner,
        lints,
        // Size keyed to `written` to match `lints`; if Session ever
        // gains a vacate API, `written < lint_count.0` is possible
        // and the two slices must agree.
        &configs[..written],
        &scope,
        core::ptr::null_mut(),
        &mut sink,
    ) {
        notko::Outcome::Ok(r) => r,
        notko::Outcome::Err(_) => {
            io::eprintln(b"viola-cli: pipeline invocation failed");
            // `session` drops at function-frame exit, satisfying §7.4
            // LIFO across all loaded plugins. No manual cleanup.
            return EXIT_PLUGIN;
        }
    };

    sink.sort();
    sink.emit();

    if let notko::Maybe::Is(failure) = report.first_failure {
        let _ = failure;
        io::eprintln(b"viola-cli: one or more lints failed during run");
    }

    // Gate-threshold filtering (PR-D-2). When `--gate <name>` is
    // present, walk captured diagnostics and count how many block
    // the named gate per the resolution chain in
    // docs/VIOLA-TOML-V2-SCHEMA.md §"Gate resolution model":
    // `[gates.<plugin_id>].<gate>` -> `[gates].<gate>` -> built-in
    // "error" default. A diagnostic blocks iff its severity index
    // is <= the threshold's severity index (smaller = more
    // severe). Without `--gate`, fall back to v1 semantics: any
    // captured diagnostic flips the exit code.
    match gate {
        notko::Maybe::Is(g) => {
            if sink.count_blocking(cfg, g) > 0 { EXIT_DIAG } else { EXIT_OK }
        }
        notko::Maybe::Isnt => {
            if *sink.count() > 0 { EXIT_DIAG } else { EXIT_OK }
        }
    }
}

#[cfg(not(unix))]
fn run_v2<'a>(
    _cfg: &viola_config::ViolaConfig<'a, MAX_PLUGINS>,
    _gate: notko::Maybe<&[u8]>,
) -> i32 {
    io::eprintln(b"viola-cli: v2 plugin loading requires unix");
    EXIT_PLUGIN
}

/// Parsed CLI arguments. The host has exactly two flag-shaped inputs
/// today: a positional config-path (defaults to `./viola.toml`) and
/// `--gate <name>` (defaults to absent, meaning "no gate-threshold
/// filter; any captured diagnostic flips the exit code"). The flag
/// may appear before or after the positional argument.
struct ParsedArgs {
    config_path: &'static [u8],
    gate: notko::Maybe<&'static [u8]>,
}

#[cfg(unix)]
fn parse_args(argc: i32, argv: *const *const u8) -> ParsedArgs {
    let mut config_path: &'static [u8] = DEFAULT_CONFIG_PATH;
    let mut gate: notko::Maybe<&'static [u8]> = notko::Maybe::Isnt;
    let mut config_seen = false;

    if argc < 2 || argv.is_null() {
        return ParsedArgs { config_path, gate };
    }

    let n = argc as usize;
    let mut i = 1usize;
    while i < n {
        // SAFETY: argv[i] is a process-lifetime null-terminated
        // C-string for i in [0, argc). We resolve it to a borrowed
        // 'static slice. argv-resident strings are guaranteed to
        // outlive every borrow that escapes from main().
        let pi = unsafe { *argv.add(i) };
        if pi.is_null() {
            i += 1;
            continue;
        }
        let arg = match unsafe { c_str_with_nul(pi) } {
            Some(s) => s,
            None => {
                i += 1;
                continue;
            }
        };
        // c_str_with_nul includes the trailing NUL; strip it for the
        // flag-name comparison, but keep the NUL-terminated form for
        // anything that needs to feed back into libc later.
        let arg_no_nul = match arg.last() {
            Some(&0) => &arg[..arg.len() - 1],
            _ => arg,
        };

        if arg_no_nul == b"--gate" {
            // Next argv slot is the gate value. Keep it NUL-terminated
            // for symmetry, but strip on store (downstream comparisons
            // run against bare bytes).
            i += 1;
            if i >= n {
                io::eprintln(b"viola-cli: --gate requires a value");
                break;
            }
            let pj = unsafe { *argv.add(i) };
            if pj.is_null() {
                io::eprintln(b"viola-cli: --gate requires a value");
                i += 1;
                continue;
            }
            if let Some(s) = unsafe { c_str_with_nul(pj) } {
                let stripped = match s.last() {
                    Some(&0) => &s[..s.len() - 1],
                    _ => s,
                };
                gate = notko::Maybe::Is(stripped);
            }
            i += 1;
            continue;
        }

        // Anything else is the positional config path. First wins;
        // a second positional is silently ignored (matches typical
        // CLI behaviour and keeps the parser branch-free).
        if !config_seen {
            config_path = arg;
            config_seen = true;
        }
        i += 1;
    }

    ParsedArgs { config_path, gate }
}

#[cfg(not(unix))]
fn parse_args(_argc: i32, _argv: *const *const u8) -> ParsedArgs {
    ParsedArgs {
        config_path: DEFAULT_CONFIG_PATH,
        gate: notko::Maybe::Isnt,
    }
}

const DEFAULT_CONFIG_PATH: &[u8] = b"./viola.toml\0";

/// Resolve a `[ts].config` path against the parent directory of the
/// viola.toml file. Absolute paths (leading `/`) pass through
/// unchanged. Relative paths are joined with the parent of
/// `viola_toml_path`; the result is written into `buf` and a borrowed
/// sub-slice returned.
///
/// `viola_toml_path` may include a trailing NUL (the libc-supplied
/// shape from `c_str_with_nul`); this function strips it. If
/// `viola_toml_path` has no `/` (e.g. the default `./viola.toml`
/// already gets a `./` prefix; bare `viola.toml` would not), the
/// original `ts_config` slice is returned unchanged so the deno
/// runtime resolves it against process cwd, the historical
/// behaviour for that case.
///
/// If `buf` is smaller than `parent.len() + ts_config.len()`, the
/// original `ts_config` is returned (best-effort no-op fallback).
fn resolve_ts_config_path<'a>(
    viola_toml_path: &'a [u8],
    ts_config: &'a [u8],
    buf: &'a mut [u8],
) -> &'a [u8] {
    if ts_config.is_empty() {
        return ts_config;
    }
    if ts_config[0] == b'/' {
        return ts_config;
    }
    let toml_path = match viola_toml_path.last() {
        Some(&0) => &viola_toml_path[..viola_toml_path.len() - 1],
        _ => viola_toml_path,
    };
    let mut last_slash: notko::Maybe<arvo::USize> = notko::Maybe::Isnt;
    let mut i = 0;
    while i < toml_path.len() {
        if toml_path[i] == b'/' {
            last_slash = notko::Maybe::Is(arvo::USize(i));
        }
        i += 1;
    }
    let parent: &[u8] = match last_slash {
        notko::Maybe::Is(idx) => &toml_path[..=idx.0],
        notko::Maybe::Isnt => return ts_config,
    };
    let needed = parent.len() + ts_config.len();
    if needed > buf.len() {
        io::eprintln(
            b"viola-cli: ts config path too long to resolve against viola.toml parent; using as-is",
        );
        return ts_config;
    }
    buf[..parent.len()].copy_from_slice(parent);
    buf[parent.len()..needed].copy_from_slice(ts_config);
    &buf[..needed]
}

/// JSR coordinate for the existing TS viola CLI. Pass-through mode
/// execs `deno run -A jsr:@hiisi/viola-cli ...` and lets deno do the
/// rest, preserving byte-for-byte compatibility with the existing
/// distribution.
const PASSTHROUGH_DENO: &[u8] = b"deno\0";
const PASSTHROUGH_RUN: &[u8] = b"run\0";
const PASSTHROUGH_ALLOW_ALL: &[u8] = b"-A\0";
const PASSTHROUGH_JSR: &[u8] = b"jsr:@hiisi/viola-cli\0";

/// Maximum forwarded argv slots. Hosts argv[0] = "deno", argv[1] =
/// "run", argv[2] = "-A", argv[3] = "jsr:@hiisi/viola-cli", then up
/// to (MAX_PASSTHROUGH_ARGS - 5) user-supplied args, then a NULL
/// terminator. Real-world viola invocations stay well under this.
const MAX_PASSTHROUGH_ARGS: usize = 64;

/// Pass argv through to `deno run -A jsr:@hiisi/viola-cli ...` via
/// `execvp`. Returns only on failure (in which case viola-cli falls
/// back to its own error path). Successful exec replaces the
/// process image and never returns.
#[cfg(unix)]
fn passthrough_to_deno_cli(argc: i32, argv: *const *const u8) -> i32 {
    let mut new_argv: [*const u8; MAX_PASSTHROUGH_ARGS] =
        [core::ptr::null(); MAX_PASSTHROUGH_ARGS];
    // argv[0] is conventionally the program name as the OS resolved
    // it. For execvp, where the kernel does the PATH lookup against
    // the file argument, the right argv[0] is the bare program name
    // ("deno"), which is also what deno reads if it inspects argv[0]
    // for self-location.
    new_argv[0] = PASSTHROUGH_DENO.as_ptr();
    new_argv[1] = PASSTHROUGH_RUN.as_ptr();
    new_argv[2] = PASSTHROUGH_ALLOW_ALL.as_ptr();
    new_argv[3] = PASSTHROUGH_JSR.as_ptr();
    let prefix = 4;

    // Forward user args (skip argv[0], which is our binary's name).
    // Reserve one slot for the trailing NULL terminator. If the user
    // supplies more args than fit, fail loudly: silently truncating
    // would corrupt the invocation in a way the caller cannot detect.
    let user_count = if argc >= 1 { (argc - 1) as usize } else { 0 };
    let cap = MAX_PASSTHROUGH_ARGS - prefix - 1;
    if user_count > cap {
        io::eprint(b"viola-cli: too many passthrough args (max ");
        let mut buf = [0u8; 20];
        io::eprint(fmt::usize_to_dec(cap, &mut buf));
        io::eprintln(b" supported); refusing to truncate");
        return EXIT_CONFIG;
    }
    let mut i = 0;
    while i < user_count {
        // SAFETY: argv[i+1] is a process-lifetime null-terminated
        // C-string supplied by libc. We forward the pointer without
        // copying; execvp consumes the array before it returns
        // (failure case) or the process image is replaced (success).
        unsafe {
            new_argv[prefix + i] = *argv.add(i + 1);
        }
        i += 1;
    }
    // Trailing NULL is already in place from the zero-init.

    // SAFETY: new_argv is a NULL-terminated array of NULL-terminated
    // C strings, matching execvp's contract. The first entry is the
    // file argument (deno), looked up against PATH.
    unsafe {
        libc::execvp(
            PASSTHROUGH_DENO.as_ptr() as *const i8,
            new_argv.as_ptr() as *const *const i8,
        );
    }
    // Reached only on exec failure (e.g. deno not on PATH). 127 is
    // the POSIX-conventional "command not found" exit code; tooling
    // that inspects exit codes can distinguish this from a plugin or
    // diagnostic failure.
    io::eprintln(
        b"viola-cli: failed to exec `deno run jsr:@hiisi/viola-cli`. Is deno on PATH?",
    );
    EXIT_EXEC
}

#[cfg(not(unix))]
fn passthrough_to_deno_cli(_argc: i32, _argv: *const *const u8) -> i32 {
    io::eprintln(b"viola-cli: pass-through mode requires unix");
    EXIT_PLUGIN
}

/// Sibling dylib name viola-cli auto-loads when `[ts]` is present.
/// Resolved by the OS loader against rpath / DYLD_LIBRARY_PATH /
/// LD_LIBRARY_PATH; in a normal install this lives next to the
/// `viola` executable.
#[cfg(target_os = "macos")]
const TS_RUNTIME_DYLIB: &[u8] = b"libviola_deno_runtime.dylib\0";
#[cfg(all(unix, not(target_os = "macos")))]
const TS_RUNTIME_DYLIB: &[u8] = b"libviola_deno_runtime.so\0";
#[cfg(not(unix))]
const TS_RUNTIME_DYLIB: &[u8] = b"viola_deno_runtime.dll\0";

/// Convert a libc-supplied null-terminated C-string pointer into a
/// `'static` borrowed byte slice INCLUDING the trailing null. Returns
/// `None` if no null is found within [`MAX_PATH_BYTES`].
///
/// SAFETY: caller must ensure `p` points to a process-lifetime
/// null-terminated string.
unsafe fn c_str_with_nul(p: *const u8) -> Option<&'static [u8]> {
    // SAFETY (whole function): caller guarantees `p` points to a
    // process-lifetime null-terminated string. Reads through `p.add`
    // are in-bounds at least until the terminator. The returned slice
    // reuses that lifetime.
    let mut len = 0usize;
    while len < MAX_PATH_BYTES {
        let b = unsafe { *p.add(len) };
        if b == 0 {
            len += 1;
            return Some(unsafe { core::slice::from_raw_parts(p, len) });
        }
        len += 1;
    }
    None
}

fn load_plugin(
    host: &ExtensionHost,
    path: &[u8],
) -> notko::Maybe<viola_core::Extension> {
    let mut buf = [0u8; MAX_PATH_BYTES];
    let c_path = match io::write_to_buf_with_nul(path, &mut buf) {
        notko::Maybe::Is(s) => s,
        notko::Maybe::Isnt => return notko::Maybe::Isnt,
    };
    match host.load(
        c_path,
        ExtensionRequirement::Required,
        core::ptr::null_mut::<c_void>(),
    ) {
        notko::Outcome::Ok(notko::Maybe::Is(ext)) => notko::Maybe::Is(ext),
        _ => notko::Maybe::Isnt,
    }
}

fn emit_config_error(e: &viola_config::ConfigError) {
    use viola_config::ConfigError as E;
    let (label, offset) = match e {
        E::Unexpected { offset } => (&b"unexpected token"[..], offset.0),
        E::UnknownKey { offset } => (&b"unknown key"[..], offset.0),
        E::UnterminatedString { offset } => (&b"unterminated string"[..], offset.0),
        E::UnterminatedArray { offset } => (&b"unterminated array"[..], offset.0),
        E::DuplicateKey { offset } => (&b"duplicate key"[..], offset.0),
        E::Capacity { offset } => (&b"too many entries"[..], offset.0),
        E::TypeMismatch { offset } => (&b"value type mismatch"[..], offset.0),
        E::IncompatibleSchema { offset } => {
            (&b"v1 key not allowed under [viola] version = 2"[..], offset.0)
        }
        E::InvalidInteger { offset } => (&b"invalid integer literal"[..], offset.0),
        E::InvalidIssuePattern { offset, .. } => {
            (&b"invalid issue pattern"[..], offset.0)
        }
        E::MissingRequiredField { offset } => {
            (&b"missing required field"[..], offset.0)
        }
    };
    io::eprint(b"viola-cli: viola.toml: ");
    io::eprint(label);
    io::eprint(b" at byte ");
    let mut buf = [0u8; 20];
    io::eprint(fmt::usize_to_dec(offset, &mut buf));
    io::eprint(b"\n");
}

/// Diagnostic capture sink that honours the v1 plugin ABI contract:
/// "Buffer ownership is plugin-side; the host copies before the next
/// invocation."
///
/// On `push`, every [`BytesRef`] in the incoming [`Diagnostic`] is
/// deep-copied into an owned arena ([`Self::arena`]) and the stored
/// `Diagnostic` references the arena, not plugin memory. Sort and
/// emit therefore work even after plugins drop, and a host that
/// re-invokes `evaluate` on the same plugin in one run cannot trip a
/// use-after-free against the previous batch.
///
/// Bounded geometry: up to [`MAX_DIAGNOSTICS`] entries and
/// [`CAPTURE_ARENA_BYTES`] bytes of string data. Overflow on either
/// dimension drops the entry; the dropped count surfaces in the
/// summary line.
struct CaptureSink {
    items: [core::mem::MaybeUninit<Diagnostic>; MAX_DIAGNOSTICS],
    arena: [u8; CAPTURE_ARENA_BYTES],
    // Raw `usize` for the three accumulators is an implementation
    // detail: `arvo::USize` is Deref-to-usize but does not impl
    // arithmetic at the wrapper level, so `+=` / `>=` against an
    // index would force a `.0` peek at every read. The public
    // accessor `count()` and the `Len::len()` impl lift the count
    // to the typed `arvo::USize` at the API boundary, which is
    // where the substrate vocabulary actually lives.
    arena_used: usize,
    count: usize,
    dropped: usize,
}

impl CaptureSink {
    const fn new() -> Self {
        Self {
            items: [const { core::mem::MaybeUninit::uninit() }; MAX_DIAGNOSTICS],
            arena: [0u8; CAPTURE_ARENA_BYTES],
            arena_used: 0,
            count: 0,
            dropped: 0,
        }
    }

    fn count(&self) -> arvo::USize {
        arvo::USize(self.count)
    }

    /// Count diagnostics that block the named `gate` per the v2
    /// gate-resolution model. For each captured diagnostic, resolve
    /// its effective threshold via
    /// `[gates.<plugin_id>].<gate>` -> `[gates].<gate>` -> `"error"`,
    /// then compare the diagnostic's severity index to the threshold
    /// index (see [`severity_index`] / [`threshold_index`]). A
    /// diagnostic blocks iff its index is `<=` the threshold index.
    fn count_blocking<'a, const N: usize>(
        &self,
        cfg: &viola_config::ViolaConfig<'a, N>,
        gate: &[u8],
    ) -> usize {
        let n = self.count;
        let mut blocking = 0usize;
        let mut k = 0;
        while k < n {
            // SAFETY: slot k was populated; arena-borrowed BytesRefs
            // live as long as &self.
            let d: &Diagnostic = unsafe { self.items[k].assume_init_ref() };
            let plugin_id = bytes_ref_as_slice(&d.plugin_id);
            let threshold = cfg.resolve_gate_threshold(plugin_id, gate);
            if blocks_at_threshold(d.severity, threshold) {
                blocking += 1;
            }
            k += 1;
        }
        blocking
    }

    fn sort(&mut self) {
        let n = self.count;
        // SAFETY: slots [0..n) were populated via push. The Diagnostic
        // copies stored there carry BytesRef pointers into self.arena,
        // which is part of self and does not move while &mut self is
        // borrowed. Swapping entries during sort does not move the
        // arena bytes; pointers stay valid.
        let slice: &mut [Diagnostic] = unsafe {
            core::slice::from_raw_parts_mut(
                self.items.as_mut_ptr() as *mut Diagnostic,
                n,
            )
        };
        sort_diagnostics(slice);
    }

    fn emit(&self) {
        let n = self.count;
        let mut k = 0;
        while k < n {
            // SAFETY: slot k was populated; BytesRefs reference
            // self.arena which lives as long as &self.
            let d: &Diagnostic = unsafe { self.items[k].assume_init_ref() };
            emit_diagnostic(d);
            k += 1;
        }
        if self.dropped > 0 {
            io::eprint(b"viola-cli: ");
            let mut buf = [0u8; 20];
            io::eprint(fmt::usize_to_dec(self.dropped, &mut buf));
            io::eprintln(b" diagnostic(s) dropped due to capture buffer capacity");
        }
        io::eprint(b"viola-cli: ");
        let mut buf = [0u8; 20];
        io::eprint(fmt::usize_to_dec(n, &mut buf));
        io::eprintln(b" diagnostic(s) emitted");
    }

    /// Copy a plugin-owned [`BytesRef`] into the arena and return a
    /// new `BytesRef` pointing at the host-owned copy. Returns
    /// [`Maybe::Isnt`] if the arena cannot fit the bytes.
    fn copy_bytes_ref(&mut self, src: &BytesRef) -> notko::Maybe<BytesRef> {
        if src.data.is_null() || src.len.0 == 0 {
            return notko::Maybe::Is(BytesRef::EMPTY);
        }
        let len = src.len.0;
        if self.arena_used + len > self.arena.len() {
            return notko::Maybe::Isnt;
        }
        // SAFETY: src is a v1-contract BytesRef that the host promised
        // to copy bytes from before the next plugin invocation. The
        // pointer + len describe a valid plugin-owned slice for this
        // call. The destination is host-owned arena storage.
        let src_slice = unsafe { core::slice::from_raw_parts(src.data, len) };
        let start = self.arena_used;
        self.arena[start..start + len].copy_from_slice(src_slice);
        self.arena_used += len;
        // SAFETY: arena is part of self; the resulting pointer stays
        // valid until self is dropped.
        let data = unsafe { self.arena.as_ptr().add(start) };
        notko::Maybe::Is(BytesRef { data, len: arvo::USize(len) })
    }
}

impl Push<Diagnostic> for CaptureSink {
    fn push(&mut self, diag: Diagnostic) {
        if self.count >= MAX_DIAGNOSTICS {
            self.dropped += 1;
            return;
        }
        // Capture the pre-copy arena cursor so we can roll back on
        // partial-copy failure. Arena overflow on any field drops the
        // whole diagnostic rather than emitting half-populated bytes.
        let arena_checkpoint = self.arena_used;
        let plugin_id = match self.copy_bytes_ref(&diag.plugin_id) {
            notko::Maybe::Is(b) => b,
            notko::Maybe::Isnt => {
                self.arena_used = arena_checkpoint;
                self.dropped += 1;
                return;
            }
        };
        let rule_id = match self.copy_bytes_ref(&diag.rule_id) {
            notko::Maybe::Is(b) => b,
            notko::Maybe::Isnt => {
                self.arena_used = arena_checkpoint;
                self.dropped += 1;
                return;
            }
        };
        let message = match self.copy_bytes_ref(&diag.message) {
            notko::Maybe::Is(b) => b,
            notko::Maybe::Isnt => {
                self.arena_used = arena_checkpoint;
                self.dropped += 1;
                return;
            }
        };
        let path = match self.copy_bytes_ref(&diag.path) {
            notko::Maybe::Is(b) => b,
            notko::Maybe::Isnt => {
                self.arena_used = arena_checkpoint;
                self.dropped += 1;
                return;
            }
        };
        let suggestion = match self.copy_bytes_ref(&diag.suggestion) {
            notko::Maybe::Is(b) => b,
            notko::Maybe::Isnt => {
                self.arena_used = arena_checkpoint;
                self.dropped += 1;
                return;
            }
        };
        let owned = Diagnostic {
            plugin_id,
            rule_id,
            severity: diag.severity,
            message,
            path,
            range: diag.range,
            suggestion,
            metadata_schema: diag.metadata_schema,
            // metadata pointer is opaque; v1 host does not deep-copy
            // structured metadata yet (no concrete schema is defined).
            // Drop the pointer to avoid retaining plugin memory.
            metadata_ptr: core::ptr::null(),
            metadata_len: arvo::USize(0),
        };
        self.items[self.count].write(owned);
        self.count += 1;
    }
}

impl Len for CaptureSink {
    fn len(&self) -> arvo::USize {
        arvo::USize(self.count)
    }
}

fn emit_diagnostic(d: &Diagnostic) {
    emit_bytes_ref(&d.path);
    io::eprint(b":");
    let mut buf = [0u8; 10];
    io::eprint(fmt::u32_to_dec(d.range.start.line, &mut buf));
    io::eprint(b":");
    let mut buf2 = [0u8; 10];
    io::eprint(fmt::u32_to_dec(d.range.start.column, &mut buf2));
    io::eprint(b" [");
    emit_bytes_ref(&d.plugin_id);
    io::eprint(b"] ");
    io::eprint(severity_label(d.severity));
    io::eprint(b" ");
    emit_bytes_ref(&d.rule_id);
    io::eprint(b": ");
    emit_bytes_ref(&d.message);
    io::eprint(b"\n");
}

fn emit_bytes_ref(b: &BytesRef) {
    if b.data.is_null() || b.len.0 == 0 {
        return;
    }
    // SAFETY: by the time emit_bytes_ref runs, push() has deep-copied
    // the bytes into CaptureSink::arena. The BytesRef points at that
    // host-owned arena, which is part of CaptureSink and outlives
    // this &self borrow. No plugin-owned pointers reach this path.
    let slice = unsafe { core::slice::from_raw_parts(b.data, b.len.0) };
    io::eprint(slice);
}

fn severity_label(s: viola_core::DiagnosticSeverity) -> &'static [u8] {
    match s {
        viola_core::DiagnosticSeverity::Info => b"info",
        viola_core::DiagnosticSeverity::Warn => b"warn",
        viola_core::DiagnosticSeverity::Error => b"error",
    }
}

/// Borrow the bytes a [`BytesRef`] points at, as a `&[u8]`. Empty /
/// null-data refs return `&[]`.
fn bytes_ref_as_slice(b: &BytesRef) -> &[u8] {
    if b.data.is_null() || b.len.0 == 0 {
        return &[];
    }
    // SAFETY: BytesRef in CaptureSink slots is arena-backed (see
    // `copy_bytes_ref`); the pointer is valid for at least len bytes
    // for as long as the sink lives.
    unsafe { core::slice::from_raw_parts(b.data, b.len.0) }
}

/// Severity ordering per `docs/VIOLA-TOML-V2-SCHEMA.md`: smaller
/// index = more severe. The runtime today only emits `Info` / `Warn`
/// / `Error`; the threshold tokens add `hint` and `off` (and the
/// short-circuit-only `skip`). The 8-bit storage shape is
/// [`arvo_bits::Byte`]; comparisons drop to the inner `u8` because
/// `Bits<N>` does not implement `PartialOrd` (opaque-bit-pattern
/// identity, not arithmetic).
fn severity_index(s: viola_core::DiagnosticSeverity) -> arvo_bits::Byte {
    let raw: u8 = match s {
        viola_core::DiagnosticSeverity::Error => 0,
        viola_core::DiagnosticSeverity::Warn => 1,
        viola_core::DiagnosticSeverity::Info => 2,
    };
    arvo_bits::Byte::from_raw(raw)
}

/// Sentinel index used by [`threshold_index`] for the `"skip"`
/// threshold token, which the schema documents as "never blocks".
/// Any value larger than the largest real severity index works;
/// `u8::MAX` makes the "never blocks" branch obvious at the
/// comparison site.
const SKIP_SENTINEL: arvo_bits::Byte = arvo_bits::Byte::from_raw(u8::MAX);

/// Severity index for a threshold token (e.g. `b"warn"`). Unknown
/// tokens fall back to `error`'s index, which is the conservative
/// choice (a typo'd threshold lets the most severe issues through
/// rather than silently downgrading the gate). Returns
/// [`SKIP_SENTINEL`] for `"skip"`.
fn threshold_index(token: &[u8]) -> arvo_bits::Byte {
    let raw: u8 = match token {
        b"error" => 0,
        b"warn" => 1,
        b"info" => 2,
        b"hint" => 3,
        b"off" => 4,
        b"skip" => return SKIP_SENTINEL,
        _ => 0,
    };
    arvo_bits::Byte::from_raw(raw)
}

/// Decide whether a diagnostic at `sev` blocks given the threshold
/// `token`. Smaller index = more severe; blocks iff
/// `sev_idx <= threshold_idx`. The [`SKIP_SENTINEL`] case never
/// blocks.
fn blocks_at_threshold(
    sev: viola_core::DiagnosticSeverity,
    token: &[u8],
) -> bool {
    let t = threshold_index(token);
    if t == SKIP_SENTINEL {
        return false;
    }
    severity_index(sev).to_raw() <= t.to_raw()
}


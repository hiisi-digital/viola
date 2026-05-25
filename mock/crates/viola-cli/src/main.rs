#![no_std]
#![no_main]

//! `viola-cli`: host executable (Slice 8a transitional state).
//!
//! `#![no_std]` + `#![no_main]` libc entry. Reads `./viola.toml` (or
//! the path supplied as argv[1]), parses it via [`viola_config`].
//!
//! ## Slice 8a transitional state
//!
//! The pre-#254 viola-core surfaces (`pipeline::run`, `Session<N>`,
//! the local `CaptureSink`) are removed. Slice 8b ships the scheduler-
//! driven host wiring + concrete `EmitWriter` impl. Until then,
//! viola-cli's lint-running paths stub to `unimplemented!()`; the
//! libc entry compiles and the binary builds, but invoking the lint
//! flow panics with the documented message.
//!
//! Working paths in this transitional state:
//!
//! - `--version` / arg parsing reaches the config-load step.
//! - The pure-TS pass-through path (`passthrough_to_deno_cli`) works
//!   when no `viola.toml` is found; it execs the existing TS CLI via
//!   `deno run -A jsr:@hiisi/viola-cli ...`.
//! - Config parse-error reporting (`emit_config_error`) works for
//!   malformed `viola.toml`.
//!
//! Stubbed path:
//!
//! - The Rust-plugin lint flow (after a successful `viola.toml`
//!   parse with rust plugins or v2 config) panics with
//!   `unimplemented!("Slice 8b ships viola-cli scheduler rewire")`.
//!
//! Exit codes (when reachable):
//!
//! - `0`: config parsed, no work needed (zero plugins)
//! - `2`: config could not be read or parsed
//! - `3`: plugin load or invocation failed (transitional: not
//!   reachable today; the lint path panics before getting here)
//! - `127`: passthrough exec failed (deno not on PATH)

use core::ffi::c_void;
use core::panic::PanicInfo;

mod fmt;
mod io;

use viola_core::{
    BytesRef, Extension, ExtensionHost, ExtensionRequirement, ProviderId,
};

const MAX_PLUGINS: usize = 16;
const MAX_CONFIG_BYTES: usize = 64 * 1024;
const MAX_PATH_BYTES: usize = 4096;

const EXIT_OK: i32 = 0;
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
    // the existing TS CLI does. Pass through to deno; behaviour and
    // output match the existing CLI exactly.
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

    // Pure-TS path with explicit viola.toml [ts] but no Rust plugins:
    // pass through to the JSR CLI. The Rust-plugin lint path engages
    // only when viola.toml configures a Rust runner or any Rust
    // grammars / lints. This matches the "drop-in replacement"
    // promise: TS users who never wrote a viola.toml or wrote one
    // with only [ts] see the existing TS CLI's behaviour byte-for-byte.
    let _has_rust_plugins = matches!(cfg.runner, notko::Maybe::Is(_))
        || cfg.grammar_len.0 > 0
        || cfg.lint_len.0 > 0;
    if !_has_rust_plugins {
        return passthrough_to_deno_cli(argc, argv);
    }

    // Slice 8a transitional stub: viola-core's pre-#254 in-process
    // pipeline (pipeline::run + Session<N> + CaptureSink) is deleted.
    // Slice 8b ships the scheduler-driven host wiring + concrete
    // EmitWriter impl; until then the Rust-plugin lint path panics
    // here with this documented message. The libc entry, arg
    // parsing, config reading, and pure-TS passthrough above remain
    // functional in the transitional state.
    let _gate = args.gate;
    let _cfg_ref: &viola_config::ViolaConfig<'_, MAX_PLUGINS> = &cfg;
    unimplemented!(
        "Slice 8b ships viola-cli scheduler rewire; \
         viola-core's pre-#254 pipeline::run is deleted (Slice 8a)"
    )
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
            // Next argv slot is the gate value.
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
        // a second positional is silently ignored.
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
    new_argv[0] = PASSTHROUGH_DENO.as_ptr();
    new_argv[1] = PASSTHROUGH_RUN.as_ptr();
    new_argv[2] = PASSTHROUGH_ALLOW_ALL.as_ptr();
    new_argv[3] = PASSTHROUGH_JSR.as_ptr();
    let prefix = 4;

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

    // SAFETY: new_argv is a NULL-terminated array of NULL-terminated
    // C strings, matching execvp's contract. The first entry is the
    // file argument (deno), looked up against PATH.
    unsafe {
        libc::execvp(
            PASSTHROUGH_DENO.as_ptr() as *const i8,
            new_argv.as_ptr() as *const *const i8,
        );
    }
    // Reached only on exec failure (e.g. deno not on PATH).
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

/// Load one plugin from the given path. Used by Slice 8b's scheduler
/// wiring once it lands; preserved here so the helper does not need
/// to be re-derived. Currently `#[allow(dead_code)]` because the
/// stubbed run paths above do not call it.
#[allow(dead_code)]
fn load_plugin(
    host: &ExtensionHost,
    path: &[u8],
) -> notko::Maybe<Extension> {
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

/// `ProviderId` carrier used by Slice 8b's scheduler wiring to assert
/// the host's required capabilities. Marked `#[allow(dead_code)]`
/// because the stubbed run paths do not yet build the host.
#[allow(dead_code)]
const HOST_CAPS_EMPTY: &[ProviderId] = &[];

/// Re-exported `BytesRef` keeps the type addressable for the
/// transitional period; Slice 8b builds host shim Resources that
/// reference plugin-owned bytes via this carrier.
#[allow(dead_code)]
const _BYTES_REF_KEEPALIVE: BytesRef = BytesRef::EMPTY;

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

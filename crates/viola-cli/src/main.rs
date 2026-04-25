#![no_std]
#![no_main]

//! `viola-cli` — host executable.
//!
//! `#![no_std]` + `#![no_main]` libc entry. Reads `./viola.toml` (or
//! the path supplied as argv[1]), parses it via [`viola_config`],
//! loads the configured runner + lint plugins through
//! [`viola_core::ExtensionHost`], drives [`viola_core::pipeline::run`]
//! over a single empty `RunScope`, sorts the captured diagnostics per
//! `docs/PLUGIN-ABI-V1-DESIGN.md` §10, and emits one line per
//! diagnostic to stderr. Exit codes:
//!
//! - `0` — config parsed, plugins ran, zero diagnostics
//! - `1` — config parsed, plugins ran, at least one diagnostic
//! - `2` — config could not be read or parsed
//! - `3` — plugin load or pipeline invocation failed
//!
//! No `alloc`, no formatting infrastructure beyond [`fmt`]'s decimal
//! converter, no `core::fmt` machinery linked in. All buffers are
//! fixed-cap and allocated on the entry-frame stack.

use core::ffi::c_void;
use core::panic::PanicInfo;

mod fmt;
mod io;

use viola_core::{
    BytesRef, CapabilityId, Diagnostic, ExtensionHost, ExtensionRequirement,
    RunScope, RunSurface,
    aggregate::sort_diagnostics,
    pipeline::{DiagnosticSink, LintConfig, run},
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
    let config_path = resolve_config_path(argc, argv);

    let mut config_buf = [0u8; MAX_CONFIG_BYTES];
    let bytes_read = io::read_file(config_path, &mut config_buf);

    // Pure-TS path: no viola.toml means the user runs viola the way
    // the existing TS CLI does — point at a viola.config.ts in cwd.
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

    let host_caps: &'static [CapabilityId] = &[];
    let host = ExtensionHost::new(host_caps);

    let runner = match load_plugin(&host, runner_path) {
        notko::Maybe::Is(ext) => ext,
        notko::Maybe::Isnt => {
            io::eprint(b"viola-cli: failed to load runner: ");
            io::eprintln(runner_path);
            return EXIT_PLUGIN;
        }
    };

    // Lint extensions are kept in stack-allocated MaybeUninit slots,
    // populated up to lint_count, then borrowed as `[&Extension]` for
    // pipeline::run. We rely on Drop running in reverse-declaration
    // order at scope exit to honour shutdown LIFO.
    //
    // When `[ts]` is active, the deno runtime is loaded once as the
    // runner and (here) once again as a lint slot. Two Extension
    // handles refer to the same dylib, but each gets its own
    // descriptor + capability lookup; this keeps the v1 dispatch path
    // uniform without giving the runner double duty.
    let ts_lint: [&[u8]; 1] = [TS_RUNTIME_DYLIB];
    let lint_paths: &[&[u8]] = if ts_active {
        &ts_lint[..]
    } else {
        cfg.lints_slice()
    };
    let lint_count = lint_paths.len();
    let mut lint_holder: [core::mem::MaybeUninit<viola_core::Extension>;
        MAX_PLUGINS] =
        [const { core::mem::MaybeUninit::uninit() }; MAX_PLUGINS];
    let mut loaded_lints = 0usize;

    let mut load_failed = false;
    let mut i = 0;
    while i < lint_count {
        match load_plugin(&host, lint_paths[i]) {
            notko::Maybe::Is(ext) => {
                lint_holder[i].write(ext);
                loaded_lints += 1;
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

    let exit = if load_failed {
        EXIT_PLUGIN
    } else {
        // Build &Extension slice over the loaded lints.
        let mut lint_refs: [core::mem::MaybeUninit<&viola_core::Extension>;
            MAX_PLUGINS] =
            [const { core::mem::MaybeUninit::uninit() }; MAX_PLUGINS];
        let mut k = 0;
        while k < loaded_lints {
            // SAFETY: slot k was populated above via lint_holder[i].write.
            let ext_ref: &viola_core::Extension =
                unsafe { lint_holder[k].assume_init_ref() };
            lint_refs[k].write(ext_ref);
            k += 1;
        }
        // SAFETY: lint_refs[..loaded_lints] is fully initialised.
        let lints: &[&viola_core::Extension] = unsafe {
            core::slice::from_raw_parts(
                lint_refs.as_ptr() as *const &viola_core::Extension,
                loaded_lints,
            )
        };

        let mut configs = [LintConfig::EMPTY; MAX_PLUGINS];
        if ts_active && loaded_lints > 0 {
            // Pass the user's viola.config.ts path through the lint
            // config bytes. Deno runtime parses it inside V8 as the
            // module specifier to resolve and execute (PR-B/C).
            if let notko::Maybe::Is(ts_path) = cfg.ts_config {
                configs[0] = LintConfig {
                    data: ts_path.as_ptr(),
                    len: arvo::USize(ts_path.len()),
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

        if sink.count() > 0 { EXIT_DIAG } else { EXIT_OK }
    };

    // Manually drop the lint Extensions in reverse-insertion order to
    // honour the §7.4 LIFO shutdown convention. Runner drops last by
    // virtue of falling off the function frame after this block.
    let mut j = loaded_lints;
    while j > 0 {
        j -= 1;
        // SAFETY: slot j was populated; we drop exactly once.
        unsafe {
            lint_holder[j].assume_init_drop();
        }
    }
    drop(runner);

    exit
}

#[cfg(unix)]
fn resolve_config_path(argc: i32, argv: *const *const u8) -> &'static [u8] {
    if argc >= 2 && !argv.is_null() {
        // SAFETY: argv[1] points to a process-lifetime null-terminated
        // C-string when argc >= 2. We treat it as such and find the
        // length by scanning to the null byte (cap at MAX_PATH_BYTES).
        unsafe {
            let p1 = *argv.add(1);
            if !p1.is_null() {
                if let Some(slice) = c_str_with_nul(p1) {
                    return slice;
                }
            }
        }
    }
    DEFAULT_CONFIG_PATH
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

    fn count(&self) -> usize {
        self.count
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

impl DiagnosticSink for CaptureSink {
    fn push(&mut self, diag: &Diagnostic) {
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

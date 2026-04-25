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

const EXIT_OK: i32 = 0;
const EXIT_DIAG: i32 = 1;
const EXIT_CONFIG: i32 = 2;
const EXIT_PLUGIN: i32 = 3;

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
    let bytes = match io::read_file(config_path, &mut config_buf) {
        notko::Maybe::Is(b) => b,
        notko::Maybe::Isnt => {
            io::eprintln(b"viola-cli: failed to read config file");
            return EXIT_CONFIG;
        }
    };

    let cfg = match viola_config::parse::<MAX_PLUGINS>(bytes) {
        notko::Outcome::Ok(c) => c,
        notko::Outcome::Err(e) => {
            emit_config_error(&e);
            return EXIT_CONFIG;
        }
    };

    let runner_path = match cfg.runner {
        notko::Maybe::Is(p) => p,
        notko::Maybe::Isnt => {
            io::eprintln(b"viola-cli: viola.toml is missing required `runner` key");
            return EXIT_CONFIG;
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
    let lint_paths = cfg.lints_slice();
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

        let configs = [LintConfig::EMPTY; MAX_PLUGINS];

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

/// Diagnostic capture sink: stores up to [`MAX_DIAGNOSTICS`] entries
/// by-value and tracks an overflow count.
struct CaptureSink {
    items: [core::mem::MaybeUninit<Diagnostic>; MAX_DIAGNOSTICS],
    // Plain usize: the sink is single-threaded by `&mut self`
    // contract, so atomics would only obscure the actual invariant.
    count: usize,
    dropped: usize,
}

impl CaptureSink {
    const fn new() -> Self {
        Self {
            items: [const { core::mem::MaybeUninit::uninit() }; MAX_DIAGNOSTICS],
            count: 0,
            dropped: 0,
        }
    }

    fn count(&self) -> usize {
        self.count
    }

    fn sort(&mut self) {
        let n = self.count;
        // SAFETY: slots [0..n) were populated via push.
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
            // SAFETY: slot k was populated.
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
}

impl DiagnosticSink for CaptureSink {
    fn push(&mut self, diag: &Diagnostic) {
        if self.count >= MAX_DIAGNOSTICS {
            self.dropped += 1;
            return;
        }
        self.items[self.count].write(*diag);
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
    // SAFETY: BytesRef is valid for the duration of the loaded
    // plugins; emit happens before plugin teardown.
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

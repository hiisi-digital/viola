//! `viola-cli` — host executable.
//!
//! The full CLI surface (check / build / lint / explain / new) lands
//! in #195 and #169. The prior TS-port stub here referenced the sham
//! `PluginLoader` API that pre-dated the v1 host runtime; it has been
//! removed pending the real CLI design round.
//!
//! This binary currently prints a placeholder banner so the workspace
//! continues to build. Replace in #195.

fn main() {
    eprintln!(
        "viola-cli: host wiring scheduled for #195. Use `viola-core` from \
         a downstream embedder until then.",
    );
    std::process::exit(2);
}

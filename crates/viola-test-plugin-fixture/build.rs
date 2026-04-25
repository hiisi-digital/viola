fn main() {
    // Darwin: link libSystem so dyld_stub_binder resolves under the
    // -nodefaultlibs cdylib link line that no_std produces.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-lib=System");
    }
}

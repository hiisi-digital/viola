//! Resource value types for viola's hilavitkutin pipeline.
//!
//! Slice 2a ships the field-bearing shapes the body slices need.
//! `Workspace` carries the workspace path as a `Str` handle interned
//! in the host shim's long-lived interner. `CiState` carries CI flags
//! and the invoking-agent classification.
//!
//! Slice 3 adds `ExtensionHost`: a singleton fixed-cap store of loaded
//! `hilavitkutin_linking::Library` instances, indexed by `arvo::Cap`
//! from `Column<PluginEntry>` records. The host owns the dlopen
//! handles for the duration of the scheduler run.

/// Workspace-context Resource. The `path` is a `Str` handle into the
/// host shim's long-lived interner (registered at scheduler-builder
/// time; not exposed as a scheduler Resource per the Slice 2 DOC CL).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct Workspace {
    /// Absolute workspace root, interned by the host shim's long-lived
    /// string interner. The interner is registered at scheduler-builder
    /// time (not as a scheduler-side `Resource`); the `Str` handle is
    /// valid for the duration of the scheduler run.
    pub path: hilavitkutin_str::Str,
}

/// CI-invocation-context Resource. The host shim sets these fields at
/// scheduler-builder time based on environment detection.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct CiState {
    pub is_ci: arvo::Bool,
    pub agent: AgentKind,
}

impl Default for CiState {
    fn default() -> Self {
        Self {
            is_ci: arvo::Bool::FALSE,
            agent: AgentKind::Unknown,
        }
    }
}

/// Classifies the invoking actor behind a viola run. Detected from
/// environment by the host shim; absence of signal stays as `Unknown`.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum AgentKind {
    /// No detection signal yet (the safer default).
    #[default]
    Unknown,
    /// Host shim positively determined no agent is involved.
    None,
    /// A human invoked viola directly.
    Human,
    /// A bot or automation invoked viola.
    Bot,
}

/// Singleton store of loaded extension handles.
///
/// Fixed-cap array sized at `viola_config::MAX_PLUGINS`. `LoadPlugins`
/// is the sole producer (Slice 3); subsequent WUs (`RunRunner`,
/// `RunLint<L>`) declare `Resource<ExtensionHost>` in their Read sets
/// and resolve handles via `library_at(idx)`.
///
/// `libs` uses `MaybeUninit` because partially-populated arrays in
/// `no_std` cannot zero-init Drop types. The `Library` instances are
/// `!Copy` (they carry RAII dlopen cleanup); per-run `Drop` walks the
/// initialised prefix and drops each in place.
pub struct ExtensionHost {
    libs: core::cell::UnsafeCell<
        [core::mem::MaybeUninit<hilavitkutin_linking::Library>; viola_config::MAX_PLUGINS],
    >,
    loaded_len: core::cell::Cell<arvo::USize>,
}

// SAFETY: Four-invariant contract pinning the `unsafe impl Sync`. First,
// `LoadPlugins` is the only WU writing this Resource (declared in its
// Write set). Second, the scheduler serialises Write access to a
// Resource at AccessSet dispatch time. Third, downstream WUs
// (`RunRunner`, `RunLint<L>`) declare `Resource<ExtensionHost>` in
// their Read sets; the scheduler's phase-separation analysis proves
// no concurrent dispatch between `LoadPlugins` and the readers in
// the same scheduler run. Fourth, the interior mutability through
// `&self` is single-threaded per the scheduler's per-WU dispatch
// model.
unsafe impl Sync for ExtensionHost {}

impl ExtensionHost {
    /// Construct an empty host. Slots are `MaybeUninit::uninit()`;
    /// `loaded_len` is zero.
    pub fn new() -> Self {
        Self {
            libs: core::cell::UnsafeCell::new(
                [const { core::mem::MaybeUninit::uninit() }; viola_config::MAX_PLUGINS],
            ),
            loaded_len: core::cell::Cell::new(arvo::USize(0)), // lint:allow(no-bare-numeric) reason: zero literal for the empty-host counter; tracked: #72
        }
    }

    /// Read the library handle at slot `idx`.
    ///
    /// The bounds check is mandatory inside this body: reading an
    /// uninitialised `MaybeUninit<Library>` slot is undefined
    /// behaviour, not a logic bug. The `assert!` is release-retained
    /// so the soundness gap cannot survive a debug-disabled build.
    pub fn library_at(&self, idx: arvo::Cap) -> &hilavitkutin_linking::Library {
        let i: usize = *idx.0; // lint:allow(no-bare-numeric) reason: bridges arvo::Cap to slot indexing; tracked: #72
        let n: usize = *self.loaded_len.get(); // lint:allow(no-bare-numeric) reason: bridges arvo::USize to bound comparison; tracked: #72
        assert!(i < n, "ExtensionHost::library_at idx out of bounds");
        // SAFETY: `i < loaded_len` ensures the slot was initialised
        // by a prior `push` call. The bounds check above is the
        // load-bearing soundness step; the `MaybeUninit` read is
        // sound only because of it.
        unsafe {
            let libs = &*self.libs.get();
            libs[i].assume_init_ref()
        }
    }

    /// Append one library and return its slot index.
    ///
    /// # Safety
    ///
    /// Caller asserts `loaded_len < viola_config::MAX_PLUGINS`. The
    /// scheduler's AccessSet contract guarantees single-writer access
    /// to this Resource; no concurrent `push` call can race the
    /// interior `loaded_len` increment.
    pub(crate) unsafe fn push(
        &self,
        lib: hilavitkutin_linking::Library,
    ) -> arvo::Cap {
        let n: usize = *self.loaded_len.get(); // lint:allow(no-bare-numeric) reason: bridges arvo::USize to slot indexing; tracked: #72
        assert!(
            n < viola_config::MAX_PLUGINS,
            "ExtensionHost::push beyond MAX_PLUGINS",
        );
        // SAFETY: caller asserts `n < MAX_PLUGINS`; the body bounds-
        // checks defensively and panics on violation to avoid the
        // MaybeUninit write going out of bounds.
        unsafe {
            let libs = &mut *self.libs.get();
            libs[n].write(lib);
        }
        self.loaded_len.set(arvo::USize(n + 1)); // lint:allow(no-bare-numeric) reason: counter increment; tracked: #72
        arvo::Cap(arvo::USize(n))
    }
}

impl Default for ExtensionHost {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for ExtensionHost {
    fn drop(&mut self) {
        let n: usize = *self.loaded_len.get(); // lint:allow(no-bare-numeric) reason: bridges arvo::USize to slot count; tracked: #72
        // SAFETY: slots `[0..n)` were initialised by `push` calls.
        // Remaining slots are `MaybeUninit::uninit()` and must not be
        // touched. Walks the initialised prefix in order and drops
        // each `Library` in place via `assume_init_drop`.
        let mut i: usize = 0; // lint:allow(no-bare-numeric) reason: loop counter; tracked: #72
        let libs = self.libs.get_mut();
        while i < n {
            unsafe { libs[i].assume_init_drop(); }
            i += 1; // lint:allow(no-bare-numeric) reason: loop counter increment; tracked: #72
        }
    }
}

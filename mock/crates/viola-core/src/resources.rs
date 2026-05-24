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

    /// Current count of loaded library slots. Used by downstream WUs
    /// to bound iteration over the matching `Column<PluginEntry>` rows.
    pub fn loaded_count(&self) -> arvo::USize {
        self.loaded_len.get()
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

/// Workspace-default cap for the `DiscoveredFilePaths` Resource. Pre-1.0;
/// revisable once realistic viola runs surface average-case file counts.
pub const MAX_DISCOVERED_FILES: usize = 4096; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: ConstParamTy positions require bare usize; sibling MAX_PLUGINS pattern; tracked: #72

/// Workspace-default cap for the lint-plugin slot count. Pre-1.0;
/// revisable. Sits alongside `MAX_PLUGINS` (16) and
/// `MAX_DISCOVERED_FILES` (4096) as the third workspace-cap constant
/// viola-core exposes. The Slice 6 `RunLint<L>` const generic ranges
/// over `[0, MAX_LINTS)`.
pub const MAX_LINTS: usize = 32; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: ConstParamTy positions require bare usize; sibling MAX_PLUGINS pattern; tracked: #72

/// Workspace-default cap for per-`RunLint<L>` diagnostic output. Each
/// `RunLint<L>` writes to `[L * MAX_DIAGS_PER_LINT, (L + 1) *
/// MAX_DIAGS_PER_LINT)` of `Column<WuDiagnostic>`. Disjoint per-L row
/// ranges; parallel writes commute by construction under the
/// COMMUTATIVE flag. Consumers of `Column<WuDiagnostic>` MUST size
/// it to at least `MAX_LINTS * MAX_DIAGS_PER_LINT` slots. Pre-1.0;
/// revisable.
pub const MAX_DIAGS_PER_LINT: usize = 64; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: per-slot diagnostic cap; sibling MAX_PLUGINS pattern; tracked: #72

/// Sentinel for `LintSlots`: marks an unpopulated or explicitly-skipped
/// slot. `slot_at` returns `Maybe::Isnt` on this value.
const LINT_SLOT_SENTINEL: arvo::Cap = arvo::Cap(arvo::USize(usize::MAX)); // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: sentinel-value zero; tracked: #72

/// Singleton store of host-shim-populated lint-slot host_idx values.
///
/// The host shim or an IndexLints WU populates this Resource at
/// scheduler-builder time. Slot `L` holds the `host_idx` of the lint
/// plugin at that slot when populated; the sentinel
/// `LINT_SLOT_SENTINEL` marks "no plugin at this slot". `RunLint<L>`
/// reads slot `L` via `slot_at(L)`.
pub struct LintSlots {
    slots: core::cell::UnsafeCell<[arvo::Cap; MAX_LINTS]>,
    slots_len: core::cell::Cell<arvo::USize>,
}

// SAFETY: Same four-invariant contract as DiscoveredFilePaths /
// FileEntryBuffer. Host shim sole producer at scheduler-builder time;
// every WU declares Read only with no Write anywhere; interior
// mutability during build is single-threaded; cap-bounded push.
unsafe impl Sync for LintSlots {}

impl LintSlots {
    /// Construct an empty store. Every slot is `LINT_SLOT_SENTINEL`.
    pub fn new() -> Self {
        Self {
            slots: core::cell::UnsafeCell::new([LINT_SLOT_SENTINEL; MAX_LINTS]),
            slots_len: core::cell::Cell::new(arvo::USize(0)), // lint:allow(no-bare-numeric) reason: zero literal for empty-store counter; tracked: #72
        }
    }

    /// Append one lint-slot host_idx and return the slot index.
    ///
    /// # Safety
    ///
    /// Caller asserts four invariants per the `unsafe impl Sync`
    /// contract: builder-time call only, sole writer, no WU declares
    /// `Resource<LintSlots>` in Write, `slots_len < MAX_LINTS`.
    pub unsafe fn push(&self, host_idx: arvo::Cap) -> arvo::Cap {
        let n: usize = *self.slots_len.get(); // lint:allow(no-bare-numeric) reason: bridges arvo::USize to slot indexing; tracked: #72
        assert!(n < MAX_LINTS, "LintSlots::push beyond MAX_LINTS");
        // SAFETY: caller-asserted invariants; cap-bound checked.
        unsafe {
            let slots = &mut *self.slots.get();
            slots[n] = host_idx;
        }
        self.slots_len.set(arvo::USize(n + 1)); // lint:allow(no-bare-numeric) reason: counter increment; tracked: #72
        arvo::Cap(arvo::USize(n))
    }

    /// Populated-slot count.
    pub fn slots_len(&self) -> arvo::USize {
        self.slots_len.get()
    }

    /// Read the host_idx at slot `idx`. Returns `Maybe::Isnt` for the
    /// sentinel or for indices past `slots_len`.
    pub fn slot_at(&self, idx: arvo::Cap) -> notko::Maybe<arvo::Cap> {
        let i: usize = *idx.0; // lint:allow(no-bare-numeric) reason: bridges arvo::Cap to slot indexing; tracked: #72
        if i >= MAX_LINTS {
            return notko::Maybe::Isnt;
        }
        // SAFETY: Sync contract gives immutable access after build.
        let host_idx = unsafe {
            let slots = &*self.slots.get();
            slots[i]
        };
        if *host_idx.0 == usize::MAX { // lint:allow(no-bare-numeric) reason: sentinel comparison; tracked: #72
            notko::Maybe::Isnt
        } else {
            notko::Maybe::Is(host_idx)
        }
    }
}

impl Default for LintSlots {
    fn default() -> Self {
        Self::new()
    }
}

/// Singleton store of host-shim-built per-slot lint config bytes.
///
/// Slot `L` holds a `BytesRef` pointing into the ViolaCfg arena's
/// bytes for that lint's config block. `BytesRef::EMPTY` marks
/// "absent config" per the ABI "empty = absent" convention.
pub struct LintConfigBuffer {
    configs: core::cell::UnsafeCell<[viola_plugin_abi::BytesRef; MAX_LINTS]>,
    configs_len: core::cell::Cell<arvo::USize>,
}

// SAFETY: Same four-invariant contract as DiscoveredFilePaths /
// FileEntryBuffer / LintSlots.
unsafe impl Sync for LintConfigBuffer {}

impl LintConfigBuffer {
    /// Construct an empty store. Every slot is `BytesRef::EMPTY`.
    pub fn new() -> Self {
        Self {
            configs: core::cell::UnsafeCell::new(
                [viola_plugin_abi::BytesRef::EMPTY; MAX_LINTS],
            ),
            configs_len: core::cell::Cell::new(arvo::USize(0)), // lint:allow(no-bare-numeric) reason: zero literal for empty-store counter; tracked: #72
        }
    }

    /// Append one lint-config BytesRef and return the slot index.
    ///
    /// # Safety
    ///
    /// Caller asserts four invariants per the `unsafe impl Sync`
    /// contract: builder-time call only, sole writer, no WU declares
    /// `Resource<LintConfigBuffer>` in Write, `configs_len <
    /// MAX_LINTS`.
    pub unsafe fn push(&self, bytes: viola_plugin_abi::BytesRef) -> arvo::Cap {
        let n: usize = *self.configs_len.get(); // lint:allow(no-bare-numeric) reason: bridges arvo::USize to slot indexing; tracked: #72
        assert!(n < MAX_LINTS, "LintConfigBuffer::push beyond MAX_LINTS");
        // SAFETY: caller-asserted invariants; cap-bound checked.
        unsafe {
            let configs = &mut *self.configs.get();
            configs[n] = bytes;
        }
        self.configs_len.set(arvo::USize(n + 1)); // lint:allow(no-bare-numeric) reason: counter increment; tracked: #72
        arvo::Cap(arvo::USize(n))
    }

    /// Populated-slot count.
    pub fn configs_len(&self) -> arvo::USize {
        self.configs_len.get()
    }

    /// Read the BytesRef at slot `idx`. Returns `BytesRef::EMPTY` for
    /// indices past `configs_len` or for indices beyond `MAX_LINTS`.
    /// The empty-bytes value is the ABI "absent config" sentinel.
    pub fn config_at(&self, idx: arvo::Cap) -> viola_plugin_abi::BytesRef {
        let i: usize = *idx.0; // lint:allow(no-bare-numeric) reason: bridges arvo::Cap to slot indexing; tracked: #72
        if i >= MAX_LINTS {
            return viola_plugin_abi::BytesRef::EMPTY;
        }
        let n: usize = *self.configs_len.get(); // lint:allow(no-bare-numeric) reason: bridges arvo::USize to bound comparison; tracked: #72
        if i >= n {
            return viola_plugin_abi::BytesRef::EMPTY;
        }
        // SAFETY: Sync contract gives immutable access after build.
        unsafe {
            let configs = &*self.configs.get();
            configs[i]
        }
    }
}

impl Default for LintConfigBuffer {
    fn default() -> Self {
        Self::new()
    }
}

/// Singleton store of host-shim-discovered file paths.
///
/// The host shim walks the workspace filesystem at scheduler-builder
/// time and pushes each discovered path as a `Str` handle into this
/// Resource. `DiscoverFiles` (Slice 4) reads it via `Read` and projects
/// each entry into `Column<FileInfo>`.
///
/// Unlike `ExtensionHost` the slot type (`Str`) is `Copy` with a
/// well-defined default sentinel, so no `MaybeUninit` is needed. The
/// store initialises every slot to `Str::default()`; populated slots
/// carry the host-shim-interned handles up to `paths_len`.
pub struct DiscoveredFilePaths {
    paths: core::cell::UnsafeCell<[hilavitkutin_str::Str; MAX_DISCOVERED_FILES]>,
    paths_len: core::cell::Cell<arvo::USize>,
}

// SAFETY: Four-invariant contract pinning the `unsafe impl Sync`. First,
// the host shim is the sole producer; every `push` call happens between
// `Scheduler::builder()` and `Scheduler::build()` on the main host
// thread. Second, every WU declares `Resource<DiscoveredFilePaths>` in
// its `Read` set only; no WU declares it in `Write`, so the scheduler's
// AccessSet contract gives every consumer immutable access at dispatch
// time. Third, the interior mutability through `&self` during the build
// phase is single-threaded by construction (the host shim runs before
// scheduler dispatch begins; no parallel WU executes at that point).
// Fourth, post-build the Resource is effectively read-only because no
// WU's Write set names it; the `Cell` and `UnsafeCell` never see a
// second writer.
unsafe impl Sync for DiscoveredFilePaths {}

impl DiscoveredFilePaths {
    /// Construct an empty store. Every slot is `Str::default()`;
    /// `paths_len` is zero.
    pub fn new() -> Self {
        Self {
            paths: core::cell::UnsafeCell::new(
                [hilavitkutin_str::Str::default(); MAX_DISCOVERED_FILES],
            ),
            paths_len: core::cell::Cell::new(arvo::USize(0)), // lint:allow(no-bare-numeric) reason: zero literal for the empty-store counter; tracked: #72
        }
    }

    /// Append one discovered path and return its slot index.
    ///
    /// # Safety
    ///
    /// Caller asserts four invariants that pin the `unsafe impl Sync`
    /// contract:
    ///
    /// 1. This call happens between `Scheduler::builder()` and
    ///    `Scheduler::build()`. No WU has begun dispatching.
    /// 2. The caller is the sole writer for this Resource for the
    ///    duration of the scheduler-builder phase. No other thread or
    ///    code path calls `push` concurrently.
    /// 3. No WU declares `Resource<DiscoveredFilePaths>` in its `Write`
    ///    set anywhere in the scheduler. Read-only-after-builder is the
    ///    Sync contract; a Write declaration would invalidate it.
    /// 4. `paths_len < MAX_DISCOVERED_FILES`. The body defensively
    ///    asserts this before mutation.
    pub unsafe fn push(&self, path: hilavitkutin_str::Str) -> arvo::Cap {
        let n: usize = *self.paths_len.get(); // lint:allow(no-bare-numeric) reason: bridges arvo::USize to slot indexing; tracked: #72
        assert!(
            n < MAX_DISCOVERED_FILES,
            "DiscoveredFilePaths::push beyond MAX_DISCOVERED_FILES",
        );
        // SAFETY: caller-asserted invariants give single-writer access
        // and `n < MAX_DISCOVERED_FILES` is checked above; the write is
        // sound under the four caller-asserted conditions.
        unsafe {
            let paths = &mut *self.paths.get();
            paths[n] = path;
        }
        self.paths_len.set(arvo::USize(n + 1)); // lint:allow(no-bare-numeric) reason: counter increment; tracked: #72
        arvo::Cap(arvo::USize(n))
    }

    /// Current count of populated slots.
    pub fn paths_len(&self) -> arvo::Cap {
        arvo::Cap(self.paths_len.get())
    }

    /// Read the path handle at slot `idx`. Returns `Maybe::Isnt` when
    /// `idx` is past `paths_len`.
    pub fn path_at(&self, idx: arvo::Cap) -> notko::Maybe<hilavitkutin_str::Str> {
        let i: usize = *idx.0; // lint:allow(no-bare-numeric) reason: bridges arvo::Cap to slot indexing; tracked: #72
        let n: usize = *self.paths_len.get(); // lint:allow(no-bare-numeric) reason: bridges arvo::USize to bound comparison; tracked: #72
        if i >= n {
            return notko::Maybe::Isnt;
        }
        // SAFETY: `i < paths_len` ensures the slot was populated by a
        // prior `push` call. Read-only access via immutable reborrow of
        // the UnsafeCell is sound because no Write declaration on this
        // Resource exists in any WU's AccessSet.
        let path = unsafe {
            let paths = &*self.paths.get();
            paths[i]
        };
        notko::Maybe::Is(path)
    }
}

impl Default for DiscoveredFilePaths {
    fn default() -> Self {
        Self::new()
    }
}

/// Empty `FileEntry` constant for const-init of the `FileEntryBuffer`
/// slot array. Mirrors the `Str::default()` zero-init pattern used by
/// `DiscoveredFilePaths`.
const EMPTY_FILE_ENTRY: viola_plugin_abi::FileEntry = viola_plugin_abi::FileEntry {
    path: viola_plugin_abi::BytesRef::EMPTY,
    language: viola_plugin_abi::BytesRef::EMPTY,
    hash: viola_plugin_abi::BytesRef::EMPTY,
    size_bytes: 0, // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: FFI-shape ABI field; tracked: #207
};

/// Singleton store of host-shim-built FFI-shape `FileEntry` records.
///
/// The host shim walks the workspace filesystem at scheduler-builder
/// time and pushes each file's FFI-shape view here, paralleling the
/// `Str`-handle view in `DiscoveredFilePaths`. `RunRunner` (Slice 5b)
/// reads this Resource and points `RunScope.files` at the entries
/// array.
///
/// Unlike `ExtensionHost` the slot type (`FileEntry`) is `Copy` with a
/// well-defined zero value (`EMPTY_FILE_ENTRY`), so no `MaybeUninit` is
/// needed. The store initialises every slot to the empty value;
/// populated slots carry the host-shim-built FFI entries up to
/// `entries_len`.
pub struct FileEntryBuffer {
    entries: core::cell::UnsafeCell<
        [viola_plugin_abi::FileEntry; MAX_DISCOVERED_FILES],
    >,
    entries_len: core::cell::Cell<arvo::USize>,
}

// SAFETY: Four-invariant contract pinning the `unsafe impl Sync`. First,
// the host shim is the sole producer; every `push` call happens between
// `Scheduler::builder()` and `Scheduler::build()` on the main host
// thread. Second, every WU declares `Resource<FileEntryBuffer>` in its
// `Read` set only; no WU declares it in `Write`, so the scheduler's
// AccessSet contract gives every consumer immutable access at dispatch
// time. Third, the interior mutability through `&self` during the
// build phase is single-threaded by construction (the host shim runs
// before scheduler dispatch begins; no parallel WU executes at that
// point). Fourth, post-build the Resource is effectively read-only
// because no WU's Write set names it; the `Cell` and `UnsafeCell`
// never see a second writer. Same contract as DiscoveredFilePaths.
unsafe impl Sync for FileEntryBuffer {}

impl FileEntryBuffer {
    /// Construct an empty store. Every slot is `EMPTY_FILE_ENTRY`;
    /// `entries_len` is zero.
    pub fn new() -> Self {
        Self {
            entries: core::cell::UnsafeCell::new(
                [EMPTY_FILE_ENTRY; MAX_DISCOVERED_FILES],
            ),
            entries_len: core::cell::Cell::new(arvo::USize(0)), // lint:allow(no-bare-numeric) reason: zero literal for the empty-store counter; tracked: #72
        }
    }

    /// Append one FFI-shape file entry and return its slot index.
    ///
    /// # Safety
    ///
    /// Caller asserts four invariants that pin the `unsafe impl Sync`
    /// contract:
    ///
    /// 1. This call happens between `Scheduler::builder()` and
    ///    `Scheduler::build()`. No WU has begun dispatching.
    /// 2. The caller is the sole writer for this Resource for the
    ///    duration of the scheduler-builder phase. No other thread or
    ///    code path calls `push` concurrently.
    /// 3. No WU declares `Resource<FileEntryBuffer>` in its `Write`
    ///    set anywhere in the scheduler. Read-only-after-builder is the
    ///    Sync contract; a Write declaration would invalidate it.
    /// 4. `entries_len < MAX_DISCOVERED_FILES`. The body defensively
    ///    asserts this before mutation.
    pub unsafe fn push(&self, entry: viola_plugin_abi::FileEntry) -> arvo::Cap {
        let n: usize = *self.entries_len.get(); // lint:allow(no-bare-numeric) reason: bridges arvo::USize to slot indexing; tracked: #72
        assert!(
            n < MAX_DISCOVERED_FILES,
            "FileEntryBuffer::push beyond MAX_DISCOVERED_FILES",
        );
        // SAFETY: caller-asserted invariants give single-writer access
        // and `n < MAX_DISCOVERED_FILES` is checked above.
        unsafe {
            let entries = &mut *self.entries.get();
            entries[n] = entry;
        }
        self.entries_len.set(arvo::USize(n + 1)); // lint:allow(no-bare-numeric) reason: counter increment; tracked: #72
        arvo::Cap(arvo::USize(n))
    }

    /// Current count of populated slots.
    pub fn entries_len(&self) -> arvo::USize {
        self.entries_len.get()
    }

    /// Raw pointer to the first slot. Suitable for `RunScope.files`.
    /// Read-only-after-builder: the pointer addresses memory inside the
    /// `UnsafeCell`; the Sync contract guarantees no concurrent writer
    /// post-build, so the pointer is valid for the duration of the
    /// scheduler run.
    pub fn entries_ptr(&self) -> *const viola_plugin_abi::FileEntry {
        // SAFETY: same invariants as the `unsafe impl Sync` contract.
        // The exposed pointer is read-only by every WU consumer per the
        // AccessSet contract; no Write declaration means no concurrent
        // mutation can happen.
        unsafe { (*self.entries.get()).as_ptr() }
    }
}

impl Default for FileEntryBuffer {
    fn default() -> Self {
        Self::new()
    }
}

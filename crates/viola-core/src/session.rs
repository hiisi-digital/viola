//! Multi-extension session with reverse-insertion-order shutdown.
//!
//! `hilavitkutin_extensions::Extension::Drop` already drives that
//! single extension's `shutdown_fn`. The viola host owns the *order*
//! across multiple extensions: per `docs/PLUGIN-ABI-V1-DESIGN.md` §7.4
//! shutdown is deterministic, and the convention this crate ships is
//! LIFO (last loaded shuts down first). [`Session`] is a fixed-cap
//! container that enforces that order at drop time.
//!
//! The cap `N` is a const generic; sessions bound to a runner / one or
//! a few lints fit in N=8 or N=16 comfortably. Larger plugin sets
//! either bump N or compose multiple sessions sequentially.

use hilavitkutin_extensions::Extension;
use notko::Maybe;

/// Fixed-capacity LIFO container for [`Extension`] handles.
pub struct Session<const N: usize> {
    slots: [Maybe<Extension>; N],
    len: usize,
}

impl<const N: usize> Session<N> {
    /// Empty session.
    pub fn new() -> Self {
        Self {
            slots: [const { Maybe::Isnt }; N],
            len: 0,
        }
    }

    /// Push an extension. Returns the extension back as [`Maybe::Is`]
    /// when the session is full, [`Maybe::Isnt`] when accepted.
    pub fn push(&mut self, ext: Extension) -> Maybe<Extension> {
        if self.len >= N {
            return Maybe::Is(ext);
        }
        self.slots[self.len] = Maybe::Is(ext);
        self.len += 1;
        Maybe::Isnt
    }

    /// Number of resident extensions.
    pub fn len(&self) -> arvo::USize {
        arvo::USize(self.len)
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Borrow the i-th resident extension if any.
    pub fn get(&self, i: usize) -> Maybe<&Extension> {
        if i >= self.len {
            return Maybe::Isnt;
        }
        match &self.slots[i] {
            Maybe::Is(ext) => Maybe::Is(ext),
            Maybe::Isnt => Maybe::Isnt,
        }
    }
}

impl<const N: usize> Default for Session<N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const N: usize> Drop for Session<N> {
    fn drop(&mut self) {
        // Reverse-insertion-order. Each Maybe::Is(Extension) drop
        // drives shutdown_fn + library unload via the inner type's
        // own Drop; we just sequence the order here.
        let mut i = self.len;
        while i > 0 {
            i -= 1;
            self.slots[i] = Maybe::Isnt;
        }
        self.len = 0;
    }
}

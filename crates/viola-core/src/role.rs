//! Cap-derived role classification for viola extensions.
//!
//! Per `docs/PLUGIN-ABI-V1-DESIGN.md` §5, a viola extension's role set
//! is derived from its provider table, not declared separately. An
//! extension is a Runner iff its descriptor exports
//! [`PROVIDER_RUNNER_EXECUTE_SCOPE`], a Grammar iff it exports
//! [`PROVIDER_GRAMMAR_EXTRACT`], a Lint iff it exports
//! [`PROVIDER_LINT_EVALUATE`]. An extension MAY hold more than one role.
//!
//! Role bits are stored in a `Mask64` (a local alias for
//! `arvo_bitmask::Mask<arvo_bits::QWord>`, which lowers to
//! `Bits<64, Hot>` storage). The discriminant values on
//! [`Role`] are bit positions (0, 1, 2), not bit-flag values: the mask
//! exposes `insert(pos)` / `contains(pos)` / `is_empty()` over a
//! [`USize`]-typed position.

use arvo::USize;
use arvo_bitmask::Mask;
use arvo_bits::QWord;

/// 64-bit bitmask alias matching the prior `Mask64` shorthand.
///
/// arvo round 202605031748 (#313) deleted the `Mask64` shipping alias
/// from `arvo-bitmask`. The chassis-form spelling is what consumers
/// name now; this local alias keeps the `RoleSet` field type readable.
type Mask64 = Mask<QWord>;
use hilavitkutin_extensions::Extension;
use viola_plugin_abi::{
    PROVIDER_GRAMMAR_EXTRACT, PROVIDER_LINT_EVALUATE, PROVIDER_RUNNER_EXECUTE_SCOPE,
};

/// Single viola role tag.
///
/// The discriminant is the bit position the role occupies inside a
/// [`RoleSet`], not a bit-flag value. Three roles fit in a `Mask64`'s
/// first three bits with room to spare; future roles append further
/// positions.
#[repr(u32)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Role {
    Runner = 0,
    Grammar = 1,
    Lint = 2,
}

/// Bitset of roles an extension holds.
///
/// Domain alias over [`Mask64`]. Empty means the extension exports
/// none of the three v1 viola providers and is therefore not a viola
/// plugin (still a valid `hilavitkutin_extensions::Extension`, just
/// with a different downstream contract).
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub struct RoleSet(Mask64);

impl core::fmt::Debug for RoleSet {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("RoleSet")
            .field("runner", &self.contains(Role::Runner))
            .field("grammar", &self.contains(Role::Grammar))
            .field("lint", &self.contains(Role::Lint))
            .finish()
    }
}

impl RoleSet {
    pub const EMPTY: Self = Self(Mask::from_word(QWord::from_raw(0)));

    pub fn contains(self, role: Role) -> bool {
        *self.0.contains(USize(role as usize))
    }

    pub fn is_empty(self) -> bool {
        *self.0.is_empty()
    }

    pub fn insert(mut self, role: Role) -> Self {
        self.0.insert(USize(role as usize));
        self
    }
}

/// Classify an extension into the viola role set its provider table implies.
pub fn roles_of(ext: &Extension) -> RoleSet {
    let mut set = RoleSet::EMPTY;
    if has_cap(ext, PROVIDER_RUNNER_EXECUTE_SCOPE) {
        set = set.insert(Role::Runner);
    }
    if has_cap(ext, PROVIDER_GRAMMAR_EXTRACT) {
        set = set.insert(Role::Grammar);
    }
    if has_cap(ext, PROVIDER_LINT_EVALUATE) {
        set = set.insert(Role::Lint);
    }
    set
}

pub fn is_runner(ext: &Extension) -> bool {
    has_cap(ext, PROVIDER_RUNNER_EXECUTE_SCOPE)
}

pub fn is_grammar(ext: &Extension) -> bool {
    has_cap(ext, PROVIDER_GRAMMAR_EXTRACT)
}

pub fn is_lint(ext: &Extension) -> bool {
    has_cap(ext, PROVIDER_LINT_EVALUATE)
}

fn has_cap(
    ext: &Extension,
    id: hilavitkutin_extensions::ProviderId,
) -> bool {
    matches!(ext.provider(id), notko::Maybe::Is(_))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_set_contains_nothing() {
        let s = RoleSet::EMPTY;
        assert!(s.is_empty());
        assert!(!s.contains(Role::Runner));
        assert!(!s.contains(Role::Grammar));
        assert!(!s.contains(Role::Lint));
    }

    #[test]
    fn role_bits_are_independent() {
        let s = RoleSet::EMPTY
            .insert(Role::Runner)
            .insert(Role::Lint);
        assert!(s.contains(Role::Runner));
        assert!(s.contains(Role::Lint));
        assert!(!s.contains(Role::Grammar));
        assert!(!s.is_empty());
    }

    #[test]
    fn full_set_round_trip() {
        let s = RoleSet::EMPTY
            .insert(Role::Runner)
            .insert(Role::Grammar)
            .insert(Role::Lint);
        assert!(s.contains(Role::Runner));
        assert!(s.contains(Role::Grammar));
        assert!(s.contains(Role::Lint));
    }
}

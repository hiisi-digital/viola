//! Cap-derived role classification for viola extensions.
//!
//! Per `docs/PLUGIN-ABI-V1-DESIGN.md` §5, a viola extension's role set
//! is derived from its capability table, not declared separately. An
//! extension is a Runner iff its descriptor exports
//! [`CAP_RUNNER_EXECUTE_SCOPE`], a Grammar iff it exports
//! [`CAP_GRAMMAR_EXTRACT`], a Lint iff it exports
//! [`CAP_LINT_EVALUATE`]. An extension MAY hold more than one role.

use hilavitkutin_extensions::Extension;
use viola_plugin_abi::{
    CAP_GRAMMAR_EXTRACT, CAP_LINT_EVALUATE, CAP_RUNNER_EXECUTE_SCOPE,
};

/// Single viola role tag.
///
/// `#[repr(u32)]` so the value is stable at the FFI boundary if a future
/// host surface needs it; current consumers use it in-process only.
#[repr(u32)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Role {
    Runner = 1,
    Grammar = 2,
    Lint = 4,
}

/// Bitset of roles an extension holds.
///
/// Each role bit is the discriminant of [`Role`]. An empty set means the
/// extension exports none of the three v1 viola caps and is therefore
/// not a viola plugin (still a valid `hilavitkutin_extensions::Extension`,
/// just with a different downstream contract).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct RoleSet(u32); // lint:allow(arvo-types-only, no-bare-numeric, no-public-raw-field) tracked: #207

impl RoleSet {
    pub const EMPTY: Self = Self(0);

    pub const fn contains(self, role: Role) -> bool {
        (self.0 & role as u32) != 0
    }

    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    pub const fn insert(self, role: Role) -> Self {
        Self(self.0 | role as u32)
    }
}

/// Classify an extension into the viola role set its capability table implies.
pub fn roles_of(ext: &Extension) -> RoleSet {
    let mut set = RoleSet::EMPTY;
    if has_cap(ext, CAP_RUNNER_EXECUTE_SCOPE) {
        set = set.insert(Role::Runner);
    }
    if has_cap(ext, CAP_GRAMMAR_EXTRACT) {
        set = set.insert(Role::Grammar);
    }
    if has_cap(ext, CAP_LINT_EVALUATE) {
        set = set.insert(Role::Lint);
    }
    set
}

pub fn is_runner(ext: &Extension) -> bool {
    has_cap(ext, CAP_RUNNER_EXECUTE_SCOPE)
}

pub fn is_grammar(ext: &Extension) -> bool {
    has_cap(ext, CAP_GRAMMAR_EXTRACT)
}

pub fn is_lint(ext: &Extension) -> bool {
    has_cap(ext, CAP_LINT_EVALUATE)
}

fn has_cap(
    ext: &Extension,
    id: hilavitkutin_extensions::CapabilityId,
) -> bool {
    matches!(ext.capability(id), notko::Maybe::Is(_))
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

//! Plugin roles: `runner`, `grammar`, `lint`.
//!
//! A plugin MAY expose one or more roles. The descriptor reports the
//! set as a [`RoleSet`] bitflag. Each role corresponds to a contract on
//! the capability table: presence of a role bit promises that the
//! plugin's capability table contains the well-known capability ids
//! for that role's required operations.
//!
//! Role contracts are normative; see
//! `docs/PLUGIN-ABI-V1-DESIGN.md` section 5.

/// Single-role enum, used in diagnostic messages and at SDK ergonomics
/// boundaries. The wire-side representation is [`RoleSet`].
#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Role {
    /// Coordinates configured grammars to produce a NAM snapshot once
    /// per run scope.
    Runner = 1 << 0,
    /// Maps language-specific structure into NAM-conformant nodes.
    Grammar = 1 << 1,
    /// Consumes NAM + lint config; emits diagnostics.
    Lint = 1 << 2,
}

/// Set-of-roles bitfield.
///
/// `#[repr(transparent)]` over `u32` so it crosses the boundary as a
/// plain word. Bit positions match [`Role`] discriminants.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct RoleSet(pub u32);

impl RoleSet {
    /// Empty role set (a plugin with no advertised roles is rejected
    /// at load time; this constructor exists for builder ergonomics).
    pub const EMPTY: Self = Self(0);

    /// Construct from a single role.
    pub const fn single(role: Role) -> Self {
        Self(role as u32)
    }

    /// Whether this set includes `role`.
    pub const fn contains(self, role: Role) -> bool {
        (self.0 & (role as u32)) != 0
    }

    /// Add `role` to this set, returning the augmented set.
    pub const fn with(self, role: Role) -> Self {
        Self(self.0 | (role as u32))
    }

    /// Whether the set contains at least one role bit.
    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }
}

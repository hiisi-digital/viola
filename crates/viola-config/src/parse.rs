//! Zero-copy TOML subset parser.
//!
//! Grammar (informal):
//!
//! ```text
//! file        := { ws_or_comment | entry | section } eof
//! section     := "[" ws section_name { "." section_name } ws "]"
//!                ws_or_comment
//! section_name:= ascii_alpha { ascii_alphanum | "_" | "-" }
//! entry       := key ws "=" ws value ws_or_comment
//! key         := ascii_alpha { ascii_alphanum | "_" | "-" }
//! value       := string | array | integer
//! string      := '"' { byte except '"' or '\n' } '"'
//! array       := "[" ws { string ws "," ws } [ string ws ] "]"
//! integer     := digit { digit }
//! ws          := { space | tab | newline }
//! ws_or_comment := ws | "#" { byte except '\n' } '\n'
//! ```
//!
//! Recognised sections: `[ts]`, `[viola]`, `[gates]`, `[gates.<lint-id>]`.
//! Recognised top-level keys: `runner`, `grammars`, `lints`, `plugins`,
//! `inherit`. Anything outside this surface fails as
//! [`ConfigError::Unexpected`] / [`ConfigError::UnknownKey`] /
//! [`ConfigError::IncompatibleSchema`].
//!
//! v1 keys (`runner` / `grammars` / `lints`) remain accepted when the
//! file does not declare `[viola] version = 2`. With version 2 set,
//! these keys parse as [`ConfigError::IncompatibleSchema`] so users
//! who opt into the v2 schema cannot accidentally retain v1 holdovers.

use notko::{Maybe, Outcome};

use crate::{
    CompoundOp, GateOverride, GateThresholds, LintConfigBlock, PartialSeverityRule,
    SEVERITY_COMPOUND_CAP, SeverityRule, ViolaConfig,
    issue_pattern::{IssuePatternError, parse_issue_pattern},
};

/// Diagnostics for a parse failure.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ConfigError {
    Unexpected { offset: arvo::USize },
    UnknownKey { offset: arvo::USize },
    UnterminatedString { offset: arvo::USize },
    UnterminatedArray { offset: arvo::USize },
    DuplicateKey { offset: arvo::USize },
    Capacity { offset: arvo::USize },
    TypeMismatch { offset: arvo::USize },
    /// Key is grammar-valid but mixes v1 keys with explicit
    /// `[viola] version = 2`. The user opted into v2, so v1 holdovers
    /// surface as a hard error rather than silent drift.
    IncompatibleSchema { offset: arvo::USize },
    /// Integer literal did not parse (non-digit, overflow, or empty).
    InvalidInteger { offset: arvo::USize },
    /// `[[severity]]` rule's `issue` field carried a string that did
    /// not parse against the issue-pattern grammar (see
    /// `crate::issue_pattern`).
    InvalidIssuePattern {
        offset: arvo::USize,
        kind: IssuePatternError,
    },
    /// A required field was missing from a section that demands it
    /// (e.g. `[[severity]]` without `level`).
    MissingRequiredField { offset: arvo::USize },
}

const SCHEMA_V2: usize = 2;

/// Parse `input` into a [`ViolaConfig`] with capacity `MAX_PLUGINS`.
pub fn parse<'a, const MAX_PLUGINS: usize>(
    input: &'a [u8],
) -> Outcome<ViolaConfig<'a, MAX_PLUGINS>, ConfigError> {
    let mut cfg = ViolaConfig::<'a, MAX_PLUGINS>::empty();
    let mut seen = SeenFlags::<MAX_PLUGINS>::default();
    let mut current = Section::Root;

    let mut p = Parser::new(input);
    p.skip_ws_and_comments();
    while !p.at_end() {
        if p.peek() == b'[' {
            // Finalise the previous lint-config block's raw_body span
            // before transitioning to the new section. The body
            // ends just before the new section header's `[`.
            if let Section::Lint { idx, body_start } = current {
                cfg.lint_configs[idx].raw_body =
                    trim_trailing_ws(&input[body_start..p.offset]);
            }
            current = match parse_section_header::<MAX_PLUGINS>(&mut p, &mut cfg, &mut seen) {
                Outcome::Ok(s) => s,
                Outcome::Err(e) => return Outcome::Err(e),
            };
            p.skip_ws_and_comments();
            continue;
        }
        if let Outcome::Err(e) =
            parse_entry::<MAX_PLUGINS>(&mut p, &mut cfg, &mut seen, current)
        {
            return Outcome::Err(e);
        }
        p.skip_ws_and_comments();
    }
    // EOF transition: finalise any open lint-config block.
    if let Section::Lint { idx, body_start } = current {
        cfg.lint_configs[idx].raw_body =
            trim_trailing_ws(&input[body_start..input.len()]);
    }

    if cfg.version_is_v2() {
        if seen.runner {
            return Outcome::Err(ConfigError::IncompatibleSchema {
                offset: arvo::USize(seen.runner_offset),
            });
        }
        if seen.grammars {
            return Outcome::Err(ConfigError::IncompatibleSchema {
                offset: arvo::USize(seen.grammars_offset),
            });
        }
        if seen.lints {
            return Outcome::Err(ConfigError::IncompatibleSchema {
                offset: arvo::USize(seen.lints_offset),
            });
        }
    }

    // Severity rules: `level` is required. Run after the v1/v2
    // schema check so users see schema errors first.
    let mut i = 0;
    while i < cfg.severity_rules_len.0 {
        if matches!(cfg.severity_rules[i].level, Maybe::Isnt) {
            return Outcome::Err(ConfigError::MissingRequiredField {
                offset: arvo::USize(seen.severity_rule_offsets[i]),
            });
        }
        i += 1;
    }

    Outcome::Ok(cfg)
}

impl<const N: usize> ViolaConfig<'_, N> {
    fn version_is_v2(&self) -> bool {
        match self.version {
            Maybe::Is(arvo::USize(n)) => n == SCHEMA_V2,
            Maybe::Isnt => false,
        }
    }
}

struct SeenFlags<const N: usize> {
    runner: bool,
    grammars: bool,
    lints: bool,
    runner_offset: usize,
    grammars_offset: usize,
    lints_offset: usize,
    ts_section: bool,
    ts_config: bool,
    viola_section: bool,
    viola_version: bool,
    gates_section: bool,
    gates_commit: bool,
    gates_build: bool,
    gates_push: bool,
    plugins: bool,
    inherit: bool,
    /// Per-rule header offsets so the post-parse "level required"
    /// check can point at the rule whose `level` is missing.
    severity_rule_offsets: [usize; N],
}

impl<const N: usize> Default for SeenFlags<N> {
    fn default() -> Self {
        Self {
            runner: false,
            grammars: false,
            lints: false,
            runner_offset: 0,
            grammars_offset: 0,
            lints_offset: 0,
            ts_section: false,
            ts_config: false,
            viola_section: false,
            viola_version: false,
            gates_section: false,
            gates_commit: false,
            gates_build: false,
            gates_push: false,
            plugins: false,
            inherit: false,
            severity_rule_offsets: [0; N],
        }
    }
}

#[derive(Copy, Clone)]
enum Section {
    Root,
    Ts,
    Viola,
    Gates,
    /// Inside a `[gates.<lint-id>]` sub-table. The slot index points
    /// into `cfg.gate_overrides[idx]`.
    GateOverride {
        idx: usize,
    },
    /// Inside a `[lint.<lint-id>]` plugin-config sub-table. `idx`
    /// points into `cfg.lint_configs[idx]`; `body_start` is the byte
    /// offset just after the closing `]` of the section header,
    /// captured so the caller can record `raw_body` when the section
    /// closes.
    Lint {
        idx: usize,
        body_start: usize,
    },
    /// Inside a `[[severity]]` array-of-tables entry. `idx` points
    /// into `cfg.severity_rules[idx]`.
    Severity {
        idx: usize,
    },
}

fn parse_section_header<'a, const MAX_PLUGINS: usize>(
    p: &mut Parser<'a>,
    cfg: &mut ViolaConfig<'a, MAX_PLUGINS>,
    seen: &mut SeenFlags<MAX_PLUGINS>,
) -> Outcome<Section, ConfigError> {
    let header_offset = p.offset;
    p.advance(); // consume '['
    // `[[name]]` array-of-tables. Recognised array names: `severity`.
    if !p.at_end() && p.peek() == b'[' {
        p.advance();
        p.skip_ws();
        let name_offset = p.offset;
        let name = match p.parse_key() {
            Outcome::Ok(k) => k,
            Outcome::Err(e) => return Outcome::Err(e),
        };
        p.skip_ws();
        if !p.consume_byte(b']') || !p.consume_byte(b']') {
            return Outcome::Err(ConfigError::Unexpected {
                offset: arvo::USize(p.offset),
            });
        }
        match name {
            b"severity" => {
                if cfg.severity_rules_len.0 >= MAX_PLUGINS {
                    return Outcome::Err(ConfigError::Capacity {
                        offset: arvo::USize(header_offset),
                    });
                }
                let idx = cfg.severity_rules_len.0;
                cfg.severity_rules[idx] = SeverityRule::EMPTY;
                cfg.severity_rules_len = arvo::USize(idx + 1);
                seen.severity_rule_offsets[idx] = header_offset;
                return Outcome::Ok(Section::Severity { idx });
            }
            _ => {
                return Outcome::Err(ConfigError::UnknownKey {
                    offset: arvo::USize(name_offset),
                });
            }
        }
    }
    p.skip_ws();
    let parent_offset = p.offset;
    let parent = match p.parse_key() {
        Outcome::Ok(k) => k,
        Outcome::Err(e) => return Outcome::Err(e),
    };
    let child = if p.peek() == b'.' {
        p.advance();
        let child_offset = p.offset;
        let _ = child_offset;
        let c = match p.parse_key() {
            Outcome::Ok(k) => k,
            Outcome::Err(e) => return Outcome::Err(e),
        };
        Maybe::Is(c)
    } else {
        Maybe::Isnt
    };
    p.skip_ws();
    if !p.consume_byte(b']') {
        return Outcome::Err(ConfigError::Unexpected {
            offset: arvo::USize(p.offset),
        });
    }

    match (parent, child) {
        (b"ts", Maybe::Isnt) => {
            if seen.ts_section {
                return Outcome::Err(ConfigError::DuplicateKey {
                    offset: arvo::USize(header_offset),
                });
            }
            seen.ts_section = true;
            Outcome::Ok(Section::Ts)
        }
        (b"viola", Maybe::Isnt) => {
            if seen.viola_section {
                return Outcome::Err(ConfigError::DuplicateKey {
                    offset: arvo::USize(header_offset),
                });
            }
            seen.viola_section = true;
            Outcome::Ok(Section::Viola)
        }
        (b"gates", Maybe::Isnt) => {
            if seen.gates_section {
                return Outcome::Err(ConfigError::DuplicateKey {
                    offset: arvo::USize(header_offset),
                });
            }
            seen.gates_section = true;
            Outcome::Ok(Section::Gates)
        }
        (b"gates", Maybe::Is(lint_id)) => {
            // Reject duplicate sub-tables for the same lint id.
            let mut i = 0;
            while i < cfg.gate_overrides_len.0 {
                if cfg.gate_overrides[i].lint_id == lint_id {
                    return Outcome::Err(ConfigError::DuplicateKey {
                        offset: arvo::USize(header_offset),
                    });
                }
                i += 1;
            }
            if cfg.gate_overrides_len.0 >= MAX_PLUGINS {
                return Outcome::Err(ConfigError::Capacity {
                    offset: arvo::USize(header_offset),
                });
            }
            let idx = cfg.gate_overrides_len.0;
            cfg.gate_overrides[idx] = GateOverride {
                lint_id,
                thresholds: GateThresholds::EMPTY,
            };
            cfg.gate_overrides_len = arvo::USize(idx + 1);
            Outcome::Ok(Section::GateOverride { idx })
        }
        (b"lint", Maybe::Is(lint_id)) => {
            let mut i = 0;
            while i < cfg.lint_configs_len.0 {
                if cfg.lint_configs[i].lint_id == lint_id {
                    return Outcome::Err(ConfigError::DuplicateKey {
                        offset: arvo::USize(header_offset),
                    });
                }
                i += 1;
            }
            if cfg.lint_configs_len.0 >= MAX_PLUGINS {
                return Outcome::Err(ConfigError::Capacity {
                    offset: arvo::USize(header_offset),
                });
            }
            let idx = cfg.lint_configs_len.0;
            cfg.lint_configs[idx] = LintConfigBlock {
                lint_id,
                raw_body: &[],
            };
            cfg.lint_configs_len = arvo::USize(idx + 1);
            // body_start is the offset just past the `]` consumed
            // above. The end-of-section finaliser writes raw_body
            // when the next section header (or EOF) is reached.
            Outcome::Ok(Section::Lint { idx, body_start: p.offset })
        }
        _ => Outcome::Err(ConfigError::UnknownKey {
            offset: arvo::USize(parent_offset),
        }),
    }
}

/// Trim trailing ASCII whitespace from a byte slice. Used to strip
/// blank lines between a `[lint.<id>]` body and the next section
/// header so the captured `raw_body` does not carry trailing newlines.
fn trim_trailing_ws(s: &[u8]) -> &[u8] {
    let mut end = s.len();
    while end > 0 {
        let b = s[end - 1];
        if b == b' ' || b == b'\t' || b == b'\r' || b == b'\n' {
            end -= 1;
        } else {
            break;
        }
    }
    &s[..end]
}

fn parse_entry<'a, const MAX_PLUGINS: usize>(
    p: &mut Parser<'a>,
    cfg: &mut ViolaConfig<'a, MAX_PLUGINS>,
    seen: &mut SeenFlags<MAX_PLUGINS>,
    section: Section,
) -> Outcome<(), ConfigError> {
    let key_start = p.offset;
    let key = match p.parse_key() {
        Outcome::Ok(k) => k,
        Outcome::Err(e) => return Outcome::Err(e),
    };
    p.skip_ws();
    if !p.consume_byte(b'=') {
        return Outcome::Err(ConfigError::Unexpected {
            offset: arvo::USize(p.offset),
        });
    }
    p.skip_ws();

    match section {
        Section::Ts => parse_ts_entry(p, cfg, seen, key, key_start),
        Section::Viola => parse_viola_entry(p, cfg, seen, key, key_start),
        Section::Gates => {
            let dst = &mut cfg.gates;
            parse_gate_entry(p, dst, key, key_start, &mut seen.gates_commit, &mut seen.gates_build, &mut seen.gates_push)
        }
        Section::GateOverride { idx } => {
            // Per-override duplicate detection lives in-table.
            let mut commit_seen = matches!(cfg.gate_overrides[idx].thresholds.commit, Maybe::Is(_));
            let mut build_seen = matches!(cfg.gate_overrides[idx].thresholds.build, Maybe::Is(_));
            let mut push_seen = matches!(cfg.gate_overrides[idx].thresholds.push, Maybe::Is(_));
            let dst = &mut cfg.gate_overrides[idx].thresholds;
            parse_gate_entry(
                p, dst, key, key_start,
                &mut commit_seen, &mut build_seen, &mut push_seen,
            )
        }
        Section::Lint { .. } => {
            // The plugin owns this body. The parser only validates
            // that the value is structurally well-formed, then
            // discards the parsed result; raw_body is what the
            // plugin sees at runtime.
            let _ = key; // accept any key
            p.skip_value()
        }
        Section::Severity { idx } => parse_severity_entry(p, cfg, idx, key, key_start),
        Section::Root => parse_root_entry(p, cfg, seen, key, key_start),
    }
}

fn parse_severity_entry<'a, const N: usize>(
    p: &mut Parser<'a>,
    cfg: &mut ViolaConfig<'a, N>,
    idx: usize,
    key: &'a [u8],
    key_start: usize,
) -> Outcome<(), ConfigError> {
    // Flat-field handlers (issue/files/gate/min_confidence) refuse
    // to run after a compound key (all/any/not) was already set on
    // the same rule. set_compound enforces the reverse direction.
    let is_flat_condition = matches!(key, b"issue" | b"files" | b"gate" | b"min_confidence");
    if is_flat_condition && matches!(cfg.severity_rules[idx].compound, Maybe::Is(_)) {
        return Outcome::Err(ConfigError::Unexpected {
            offset: arvo::USize(key_start),
        });
    }
    match key {
        b"issue" => {
            if matches!(cfg.severity_rules[idx].issue, Maybe::Is(_)) {
                return Outcome::Err(ConfigError::DuplicateKey {
                    offset: arvo::USize(key_start),
                });
            }
            let value_offset = p.offset;
            let value = match p.parse_string() {
                Outcome::Ok(v) => v,
                Outcome::Err(e) => return Outcome::Err(e),
            };
            // Validate at parse time so typos surface here, not at
            // runtime against an unmatched diagnostic. The parsed
            // form is recomputed at match time; we store raw bytes.
            if let Outcome::Err(kind) = parse_issue_pattern(value) {
                return Outcome::Err(ConfigError::InvalidIssuePattern {
                    offset: arvo::USize(value_offset),
                    kind,
                });
            }
            cfg.severity_rules[idx].issue = Maybe::Is(value);
            Outcome::Ok(())
        }
        b"files" => {
            if cfg.severity_rules[idx].files_len.0 > 0 {
                return Outcome::Err(ConfigError::DuplicateKey {
                    offset: arvo::USize(key_start),
                });
            }
            // Single string or array of strings.
            if !p.at_end() && p.peek() == b'"' {
                let v = match p.parse_string() {
                    Outcome::Ok(v) => v,
                    Outcome::Err(e) => return Outcome::Err(e),
                };
                cfg.severity_rules[idx].files[0] = v;
                cfg.severity_rules[idx].files_len = arvo::USize(1);
                Outcome::Ok(())
            } else {
                // SAFETY of indexing: files has SEVERITY_FILES_CAP
                // slots; parse_string_array bounds-checks via
                // count.0 >= out.len().
                let count = match p.parse_string_array(
                    &mut cfg.severity_rules[idx].files,
                ) {
                    Outcome::Ok(n) => n,
                    Outcome::Err(e) => return Outcome::Err(e),
                };
                cfg.severity_rules[idx].files_len = count;
                Outcome::Ok(())
            }
        }
        b"gate" => {
            if matches!(cfg.severity_rules[idx].gate, Maybe::Is(_)) {
                return Outcome::Err(ConfigError::DuplicateKey {
                    offset: arvo::USize(key_start),
                });
            }
            let value_offset = p.offset;
            let value = match p.parse_string() {
                Outcome::Ok(v) => v,
                Outcome::Err(e) => return Outcome::Err(e),
            };
            if !is_gate_token(value) {
                return Outcome::Err(ConfigError::Unexpected {
                    offset: arvo::USize(value_offset),
                });
            }
            cfg.severity_rules[idx].gate = Maybe::Is(value);
            Outcome::Ok(())
        }
        b"level" => {
            if matches!(cfg.severity_rules[idx].level, Maybe::Is(_)) {
                return Outcome::Err(ConfigError::DuplicateKey {
                    offset: arvo::USize(key_start),
                });
            }
            let value_offset = p.offset;
            let value = match p.parse_string() {
                Outcome::Ok(v) => v,
                Outcome::Err(e) => return Outcome::Err(e),
            };
            if !is_severity_token(value) {
                return Outcome::Err(ConfigError::Unexpected {
                    offset: arvo::USize(value_offset),
                });
            }
            cfg.severity_rules[idx].level = Maybe::Is(value);
            Outcome::Ok(())
        }
        b"min_confidence" => {
            if matches!(cfg.severity_rules[idx].min_confidence, Maybe::Is(_)) {
                return Outcome::Err(ConfigError::DuplicateKey {
                    offset: arvo::USize(key_start),
                });
            }
            let value_offset = p.offset;
            let n = match p.parse_integer() {
                Outcome::Ok(n) => n,
                Outcome::Err(e) => return Outcome::Err(e),
            };
            if n > 100 {
                return Outcome::Err(ConfigError::InvalidInteger {
                    offset: arvo::USize(value_offset),
                });
            }
            cfg.severity_rules[idx].min_confidence = Maybe::Is(arvo::USize(n));
            Outcome::Ok(())
        }
        b"all" | b"any" => {
            let op = if key == b"all" { CompoundOp::All } else { CompoundOp::Any };
            parse_compound_array(p, &mut cfg.severity_rules[idx], op, key_start)
        }
        b"not" => parse_compound_not(p, &mut cfg.severity_rules[idx], key_start),
        _ => Outcome::Err(ConfigError::UnknownKey {
            offset: arvo::USize(key_start),
        }),
    }
}

/// Set the compound operator for a rule, rejecting both
/// double-compound (e.g. `all = ...` then `any = ...`) and the
/// flat-vs-compound mix (`issue = "..."` alongside `all = ...`).
fn set_compound<'a>(
    rule: &mut SeverityRule<'a>,
    op: CompoundOp,
    key_start: usize,
) -> Outcome<(), ConfigError> {
    if matches!(rule.compound, Maybe::Is(_)) {
        return Outcome::Err(ConfigError::DuplicateKey {
            offset: arvo::USize(key_start),
        });
    }
    if matches!(rule.issue, Maybe::Is(_))
        || rule.files_len.0 > 0
        || matches!(rule.gate, Maybe::Is(_))
        || matches!(rule.min_confidence, Maybe::Is(_))
    {
        // Flat fields and compound keys are mutually exclusive.
        // Surface as Unexpected at the compound key's offset so
        // the user sees where the violation was introduced.
        return Outcome::Err(ConfigError::Unexpected {
            offset: arvo::USize(key_start),
        });
    }
    rule.compound = Maybe::Is(op);
    Outcome::Ok(())
}

fn parse_compound_array<'a>(
    p: &mut Parser<'a>,
    rule: &mut SeverityRule<'a>,
    op: CompoundOp,
    key_start: usize,
) -> Outcome<(), ConfigError> {
    if let Outcome::Err(e) = set_compound(rule, op, key_start) {
        return Outcome::Err(e);
    }
    let opening = p.offset;
    if !p.consume_byte(b'[') {
        return Outcome::Err(ConfigError::TypeMismatch {
            offset: arvo::USize(p.offset),
        });
    }
    loop {
        p.skip_ws_and_comments();
        if p.at_end() {
            return Outcome::Err(ConfigError::UnterminatedArray {
                offset: arvo::USize(opening),
            });
        }
        if p.peek() == b']' {
            p.advance();
            return Outcome::Ok(());
        }
        if p.peek() != b'{' {
            return Outcome::Err(ConfigError::Unexpected {
                offset: arvo::USize(p.offset),
            });
        }
        if rule.partials_len.0 >= SEVERITY_COMPOUND_CAP {
            return Outcome::Err(ConfigError::Capacity {
                offset: arvo::USize(p.offset),
            });
        }
        let slot = rule.partials_len.0;
        rule.partials[slot] = PartialSeverityRule::EMPTY;
        if let Outcome::Err(e) = p.parse_inline_partial(&mut rule.partials[slot]) {
            return Outcome::Err(e);
        }
        rule.partials_len = arvo::USize(slot + 1);
        p.skip_ws_and_comments();
        if p.consume_byte(b',') {
            continue;
        }
        p.skip_ws_and_comments();
        if p.at_end() {
            return Outcome::Err(ConfigError::UnterminatedArray {
                offset: arvo::USize(opening),
            });
        }
        if p.peek() == b']' {
            p.advance();
            return Outcome::Ok(());
        }
        return Outcome::Err(ConfigError::Unexpected {
            offset: arvo::USize(p.offset),
        });
    }
}

fn parse_compound_not<'a>(
    p: &mut Parser<'a>,
    rule: &mut SeverityRule<'a>,
    key_start: usize,
) -> Outcome<(), ConfigError> {
    if let Outcome::Err(e) = set_compound(rule, CompoundOp::Not, key_start) {
        return Outcome::Err(e);
    }
    if p.at_end() || p.peek() != b'{' {
        return Outcome::Err(ConfigError::TypeMismatch {
            offset: arvo::USize(p.offset),
        });
    }
    rule.partials[0] = PartialSeverityRule::EMPTY;
    if let Outcome::Err(e) = p.parse_inline_partial(&mut rule.partials[0]) {
        return Outcome::Err(e);
    }
    rule.partials_len = arvo::USize(1);
    Outcome::Ok(())
}

fn is_gate_token(s: &[u8]) -> bool {
    matches!(s, b"commit" | b"build" | b"push")
}

fn is_severity_token(s: &[u8]) -> bool {
    matches!(s, b"error" | b"warn" | b"info" | b"hint" | b"off" | b"skip")
}

fn parse_ts_entry<'a, const N: usize>(
    p: &mut Parser<'a>,
    cfg: &mut ViolaConfig<'a, N>,
    seen: &mut SeenFlags<N>,
    key: &'a [u8],
    key_start: usize,
) -> Outcome<(), ConfigError> {
    match key {
        b"config" => {
            if seen.ts_config {
                return Outcome::Err(ConfigError::DuplicateKey {
                    offset: arvo::USize(key_start),
                });
            }
            let value = match p.parse_string() {
                Outcome::Ok(v) => v,
                Outcome::Err(e) => return Outcome::Err(e),
            };
            cfg.ts_config = Maybe::Is(value);
            seen.ts_config = true;
            Outcome::Ok(())
        }
        _ => Outcome::Err(ConfigError::UnknownKey {
            offset: arvo::USize(key_start),
        }),
    }
}

fn parse_viola_entry<'a, const N: usize>(
    p: &mut Parser<'a>,
    cfg: &mut ViolaConfig<'a, N>,
    seen: &mut SeenFlags<N>,
    key: &'a [u8],
    key_start: usize,
) -> Outcome<(), ConfigError> {
    match key {
        b"version" => {
            if seen.viola_version {
                return Outcome::Err(ConfigError::DuplicateKey {
                    offset: arvo::USize(key_start),
                });
            }
            let n = match p.parse_integer() {
                Outcome::Ok(n) => n,
                Outcome::Err(e) => return Outcome::Err(e),
            };
            cfg.version = Maybe::Is(arvo::USize(n));
            seen.viola_version = true;
            Outcome::Ok(())
        }
        // `plugins` and `inherit` are top-level concepts but accepting
        // them inside [viola] too lets users author the config in the
        // shape the design memo shows (where the keys sit visually
        // under the [viola] header). Both placements write to the
        // same struct fields, with cross-placement duplicate
        // detection so a user cannot declare `plugins` once at root
        // and again under [viola].
        b"plugins" | b"inherit" => parse_root_entry(p, cfg, seen, key, key_start),
        _ => Outcome::Err(ConfigError::UnknownKey {
            offset: arvo::USize(key_start),
        }),
    }
}

fn parse_gate_entry<'a>(
    p: &mut Parser<'a>,
    dst: &mut GateThresholds<'a>,
    key: &'a [u8],
    key_start: usize,
    commit_seen: &mut bool,
    build_seen: &mut bool,
    push_seen: &mut bool,
) -> Outcome<(), ConfigError> {
    let (slot, flag): (&mut Maybe<&'a [u8]>, &mut bool) = match key {
        b"commit" => (&mut dst.commit, commit_seen),
        b"build" => (&mut dst.build, build_seen),
        b"push" => (&mut dst.push, push_seen),
        _ => {
            return Outcome::Err(ConfigError::UnknownKey {
                offset: arvo::USize(key_start),
            });
        }
    };
    if *flag {
        return Outcome::Err(ConfigError::DuplicateKey {
            offset: arvo::USize(key_start),
        });
    }
    let value = match p.parse_string() {
        Outcome::Ok(v) => v,
        Outcome::Err(e) => return Outcome::Err(e),
    };
    *slot = Maybe::Is(value);
    *flag = true;
    Outcome::Ok(())
}

fn parse_root_entry<'a, const N: usize>(
    p: &mut Parser<'a>,
    cfg: &mut ViolaConfig<'a, N>,
    seen: &mut SeenFlags<N>,
    key: &'a [u8],
    key_start: usize,
) -> Outcome<(), ConfigError> {
    match key {
        b"runner" => {
            if seen.runner {
                return Outcome::Err(ConfigError::DuplicateKey {
                    offset: arvo::USize(key_start),
                });
            }
            let value = match p.parse_string() {
                Outcome::Ok(v) => v,
                Outcome::Err(e) => return Outcome::Err(e),
            };
            cfg.runner = Maybe::Is(value);
            seen.runner = true;
            seen.runner_offset = key_start;
            Outcome::Ok(())
        }
        b"grammars" => {
            if seen.grammars {
                return Outcome::Err(ConfigError::DuplicateKey {
                    offset: arvo::USize(key_start),
                });
            }
            let count = match p.parse_string_array(&mut cfg.grammars) {
                Outcome::Ok(n) => n,
                Outcome::Err(e) => return Outcome::Err(e),
            };
            cfg.grammar_len = count;
            seen.grammars = true;
            seen.grammars_offset = key_start;
            Outcome::Ok(())
        }
        b"lints" => {
            if seen.lints {
                return Outcome::Err(ConfigError::DuplicateKey {
                    offset: arvo::USize(key_start),
                });
            }
            let count = match p.parse_string_array(&mut cfg.lints) {
                Outcome::Ok(n) => n,
                Outcome::Err(e) => return Outcome::Err(e),
            };
            cfg.lint_len = count;
            seen.lints = true;
            seen.lints_offset = key_start;
            Outcome::Ok(())
        }
        b"plugins" => {
            if seen.plugins {
                return Outcome::Err(ConfigError::DuplicateKey {
                    offset: arvo::USize(key_start),
                });
            }
            let count = match p.parse_string_array(&mut cfg.plugins) {
                Outcome::Ok(n) => n,
                Outcome::Err(e) => return Outcome::Err(e),
            };
            cfg.plugin_len = count;
            seen.plugins = true;
            Outcome::Ok(())
        }
        b"inherit" => {
            if seen.inherit {
                return Outcome::Err(ConfigError::DuplicateKey {
                    offset: arvo::USize(key_start),
                });
            }
            let count = match p.parse_string_array(&mut cfg.inherit) {
                Outcome::Ok(n) => n,
                Outcome::Err(e) => return Outcome::Err(e),
            };
            cfg.inherit_len = count;
            seen.inherit = true;
            Outcome::Ok(())
        }
        _ => Outcome::Err(ConfigError::UnknownKey {
            offset: arvo::USize(key_start),
        }),
    }
}

struct Parser<'a> {
    input: &'a [u8],
    offset: usize,
}

impl<'a> Parser<'a> {
    fn new(input: &'a [u8]) -> Self {
        Self { input, offset: 0 }
    }

    fn at_end(&self) -> bool {
        self.offset >= self.input.len()
    }

    fn peek(&self) -> u8 {
        if self.offset < self.input.len() {
            self.input[self.offset]
        } else {
            0
        }
    }

    fn advance(&mut self) {
        if self.offset < self.input.len() {
            self.offset += 1;
        }
    }

    fn consume_byte(&mut self, byte: u8) -> bool {
        if !self.at_end() && self.input[self.offset] == byte {
            self.offset += 1;
            true
        } else {
            false
        }
    }

    fn skip_ws(&mut self) {
        while !self.at_end() {
            let b = self.input[self.offset];
            if b == b' ' || b == b'\t' || b == b'\r' {
                self.offset += 1;
            } else {
                break;
            }
        }
    }

    fn skip_ws_and_comments(&mut self) {
        loop {
            let before = self.offset;
            while !self.at_end() {
                let b = self.input[self.offset];
                if b == b' ' || b == b'\t' || b == b'\r' || b == b'\n' {
                    self.offset += 1;
                } else {
                    break;
                }
            }
            if !self.at_end() && self.input[self.offset] == b'#' {
                while !self.at_end() && self.input[self.offset] != b'\n' {
                    self.offset += 1;
                }
                continue;
            }
            if self.offset == before {
                return;
            }
        }
    }

    fn parse_key(&mut self) -> Outcome<&'a [u8], ConfigError> {
        let start = self.offset;
        if self.at_end() || !is_key_start(self.input[self.offset]) {
            return Outcome::Err(ConfigError::Unexpected {
                offset: arvo::USize(self.offset),
            });
        }
        while !self.at_end() && is_key_byte(self.input[self.offset]) {
            self.offset += 1;
        }
        Outcome::Ok(&self.input[start..self.offset])
    }

    fn parse_string(&mut self) -> Outcome<&'a [u8], ConfigError> {
        let opening = self.offset;
        if !self.consume_byte(b'"') {
            return Outcome::Err(ConfigError::TypeMismatch {
                offset: arvo::USize(self.offset),
            });
        }
        let start = self.offset;
        while !self.at_end() {
            let b = self.input[self.offset];
            if b == b'"' {
                let end = self.offset;
                self.offset += 1;
                return Outcome::Ok(&self.input[start..end]);
            }
            if b == b'\n' {
                return Outcome::Err(ConfigError::UnterminatedString {
                    offset: arvo::USize(opening),
                });
            }
            self.offset += 1;
        }
        Outcome::Err(ConfigError::UnterminatedString {
            offset: arvo::USize(opening),
        })
    }

    fn parse_integer(&mut self) -> Outcome<usize, ConfigError> {
        let start = self.offset;
        if self.at_end() || !self.input[self.offset].is_ascii_digit() {
            return Outcome::Err(ConfigError::InvalidInteger {
                offset: arvo::USize(start),
            });
        }
        let mut value: usize = 0;
        while !self.at_end() && self.input[self.offset].is_ascii_digit() {
            let digit = (self.input[self.offset] - b'0') as usize;
            value = match value.checked_mul(10).and_then(|v| v.checked_add(digit)) {
                Some(v) => v,
                None => {
                    return Outcome::Err(ConfigError::InvalidInteger {
                        offset: arvo::USize(start),
                    });
                }
            };
            self.offset += 1;
        }
        // Reject trailing non-terminator junk (e.g. `2abc`) so a typo
        // does not silently coerce. Accept whitespace, comment start,
        // and the inline-table terminators `}` and `,` so integers
        // inside an inline partial parse without requiring a space
        // before the closing brace.
        if !self.at_end() {
            let b = self.input[self.offset];
            if !(b == b' '
                || b == b'\t'
                || b == b'\r'
                || b == b'\n'
                || b == b'#'
                || b == b'}'
                || b == b',')
            {
                return Outcome::Err(ConfigError::InvalidInteger {
                    offset: arvo::USize(start),
                });
            }
        }
        Outcome::Ok(value)
    }

    /// Parse one inline partial-rule table `{ key = value, ... }`
    /// into the supplied `dst`. Recognised keys: `issue`, `files`
    /// (string or array), `gate`, `min_confidence`. `level` is not
    /// permitted in a partial: the parent rule carries the level.
    fn parse_inline_partial<'b>(
        &mut self,
        dst: &'b mut PartialSeverityRule<'a>,
    ) -> Outcome<(), ConfigError> {
        let opening = self.offset;
        if !self.consume_byte(b'{') {
            return Outcome::Err(ConfigError::TypeMismatch {
                offset: arvo::USize(self.offset),
            });
        }
        loop {
            self.skip_ws();
            // Inline tables disallow newlines per TOML spec; bare
            // skip_ws (no newline) is the right choice.
            if self.at_end() {
                return Outcome::Err(ConfigError::UnterminatedArray {
                    offset: arvo::USize(opening),
                });
            }
            if self.peek() == b'}' {
                self.advance();
                return Outcome::Ok(());
            }
            let key_start = self.offset;
            let key = match self.parse_key() {
                Outcome::Ok(k) => k,
                Outcome::Err(e) => return Outcome::Err(e),
            };
            self.skip_ws();
            if !self.consume_byte(b'=') {
                return Outcome::Err(ConfigError::Unexpected {
                    offset: arvo::USize(self.offset),
                });
            }
            self.skip_ws();
            match key {
                b"issue" => {
                    if matches!(dst.issue, Maybe::Is(_)) {
                        return Outcome::Err(ConfigError::DuplicateKey {
                            offset: arvo::USize(key_start),
                        });
                    }
                    let value_offset = self.offset;
                    let v = match self.parse_string() {
                        Outcome::Ok(v) => v,
                        Outcome::Err(e) => return Outcome::Err(e),
                    };
                    if let Outcome::Err(kind) = parse_issue_pattern(v) {
                        return Outcome::Err(ConfigError::InvalidIssuePattern {
                            offset: arvo::USize(value_offset),
                            kind,
                        });
                    }
                    dst.issue = Maybe::Is(v);
                }
                b"files" => {
                    if dst.files_len.0 > 0 {
                        return Outcome::Err(ConfigError::DuplicateKey {
                            offset: arvo::USize(key_start),
                        });
                    }
                    if !self.at_end() && self.peek() == b'"' {
                        let v = match self.parse_string() {
                            Outcome::Ok(v) => v,
                            Outcome::Err(e) => return Outcome::Err(e),
                        };
                        dst.files[0] = v;
                        dst.files_len = arvo::USize(1);
                    } else {
                        let count = match self.parse_string_array(&mut dst.files) {
                            Outcome::Ok(n) => n,
                            Outcome::Err(e) => return Outcome::Err(e),
                        };
                        dst.files_len = count;
                    }
                }
                b"gate" => {
                    if matches!(dst.gate, Maybe::Is(_)) {
                        return Outcome::Err(ConfigError::DuplicateKey {
                            offset: arvo::USize(key_start),
                        });
                    }
                    let value_offset = self.offset;
                    let v = match self.parse_string() {
                        Outcome::Ok(v) => v,
                        Outcome::Err(e) => return Outcome::Err(e),
                    };
                    if !is_gate_token(v) {
                        return Outcome::Err(ConfigError::Unexpected {
                            offset: arvo::USize(value_offset),
                        });
                    }
                    dst.gate = Maybe::Is(v);
                }
                b"min_confidence" => {
                    if matches!(dst.min_confidence, Maybe::Is(_)) {
                        return Outcome::Err(ConfigError::DuplicateKey {
                            offset: arvo::USize(key_start),
                        });
                    }
                    let value_offset = self.offset;
                    let n = match self.parse_integer() {
                        Outcome::Ok(n) => n,
                        Outcome::Err(e) => return Outcome::Err(e),
                    };
                    if n > 100 {
                        return Outcome::Err(ConfigError::InvalidInteger {
                            offset: arvo::USize(value_offset),
                        });
                    }
                    dst.min_confidence = Maybe::Is(arvo::USize(n));
                }
                _ => {
                    return Outcome::Err(ConfigError::UnknownKey {
                        offset: arvo::USize(key_start),
                    });
                }
            }
            self.skip_ws();
            if self.consume_byte(b',') {
                continue;
            }
            self.skip_ws();
            if self.at_end() {
                return Outcome::Err(ConfigError::UnterminatedArray {
                    offset: arvo::USize(opening),
                });
            }
            if self.peek() == b'}' {
                self.advance();
                return Outcome::Ok(());
            }
            return Outcome::Err(ConfigError::Unexpected {
                offset: arvo::USize(self.offset),
            });
        }
    }

    /// Consume one value (string / array of strings / integer) and
    /// discard it. Used for `[lint.<id>]` body entries where the
    /// parser only validates structure; the plugin reads `raw_body`
    /// to extract its own typed values.
    fn skip_value(&mut self) -> Outcome<(), ConfigError> {
        if self.at_end() {
            return Outcome::Err(ConfigError::Unexpected {
                offset: arvo::USize(self.offset),
            });
        }
        match self.peek() {
            b'"' => {
                let _ = match self.parse_string() {
                    Outcome::Ok(v) => v,
                    Outcome::Err(e) => return Outcome::Err(e),
                };
                Outcome::Ok(())
            }
            b'[' => {
                // Array of strings; reuse parse_string_array against
                // a stack-local discard buffer. 32 entries is more
                // than any plugin config has any business expressing
                // per key in v1; raise if a plugin needs more.
                let mut discard: [&[u8]; 32] = [&[]; 32];
                match self.parse_string_array(&mut discard) {
                    Outcome::Ok(_) => Outcome::Ok(()),
                    Outcome::Err(e) => Outcome::Err(e),
                }
            }
            b => {
                if b.is_ascii_digit() {
                    match self.parse_integer() {
                        Outcome::Ok(_) => Outcome::Ok(()),
                        Outcome::Err(e) => Outcome::Err(e),
                    }
                } else {
                    Outcome::Err(ConfigError::Unexpected {
                        offset: arvo::USize(self.offset),
                    })
                }
            }
        }
    }

    fn parse_string_array(
        &mut self,
        out: &mut [&'a [u8]],
    ) -> Outcome<arvo::USize, ConfigError> {
        let opening = self.offset;
        if !self.consume_byte(b'[') {
            return Outcome::Err(ConfigError::TypeMismatch {
                offset: arvo::USize(self.offset),
            });
        }
        let mut count = arvo::USize(0);
        loop {
            self.skip_ws_and_comments();
            if self.at_end() {
                return Outcome::Err(ConfigError::UnterminatedArray {
                    offset: arvo::USize(opening),
                });
            }
            if self.peek() == b']' {
                self.advance();
                return Outcome::Ok(count);
            }
            if self.peek() != b'"' {
                return Outcome::Err(ConfigError::Unexpected {
                    offset: arvo::USize(self.offset),
                });
            }
            if count.0 >= out.len() {
                return Outcome::Err(ConfigError::Capacity {
                    offset: arvo::USize(self.offset),
                });
            }
            let value = match self.parse_string() {
                Outcome::Ok(v) => v,
                Outcome::Err(e) => return Outcome::Err(e),
            };
            out[count.0] = value;
            count = arvo::USize(count.0 + 1);
            self.skip_ws_and_comments();
            if self.consume_byte(b',') {
                continue;
            }
            self.skip_ws_and_comments();
            if self.at_end() {
                return Outcome::Err(ConfigError::UnterminatedArray {
                    offset: arvo::USize(opening),
                });
            }
            if self.peek() == b']' {
                self.advance();
                return Outcome::Ok(count);
            }
            return Outcome::Err(ConfigError::Unexpected {
                offset: arvo::USize(self.offset),
            });
        }
    }
}

fn is_key_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_'
}

fn is_key_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse16<'a>(s: &'a [u8]) -> Outcome<ViolaConfig<'a, 16>, ConfigError> {
        parse::<16>(s)
    }

    fn contains_seq(haystack: &[u8], needle: &[u8]) -> bool {
        if needle.is_empty() {
            return true;
        }
        if needle.len() > haystack.len() {
            return false;
        }
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    // ----- v1 regressions -----

    #[test]
    fn empty_input_yields_empty_config() {
        let cfg = match parse16(b"") {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("unexpected err: {e:?}"),
        };
        assert!(matches!(cfg.runner, Maybe::Isnt));
        assert_eq!(cfg.grammar_len.0, 0);
        assert_eq!(cfg.lint_len.0, 0);
        assert!(matches!(cfg.version, Maybe::Isnt));
        assert_eq!(cfg.plugin_len.0, 0);
    }

    #[test]
    fn full_v1_schema_unchanged() {
        let input = b"\
runner = \"runner.dylib\"
grammars = [\"g1.dylib\", \"g2.dylib\"]
lints = [\"l1.dylib\", \"l2.dylib\", \"l3.dylib\"]
[ts]
config = \"viola.config.ts\"
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert_eq!(cfg.grammar_len.0, 2);
        assert_eq!(cfg.lint_len.0, 3);
        assert!(matches!(cfg.ts_config, Maybe::Is(b"viola.config.ts")));
    }

    #[test]
    fn unterminated_string_fails() {
        let err = match parse16(b"runner = \"open\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::UnterminatedString { .. }));
    }

    #[test]
    fn duplicate_runner_fails() {
        let err = match parse16(b"runner = \"a\"\nrunner = \"b\"\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::DuplicateKey { .. }));
    }

    // ----- v2 schema marker -----

    #[test]
    fn viola_section_with_version() {
        let cfg = match parse16(b"[viola]\nversion = 2\n") {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert!(matches!(cfg.version, Maybe::Is(arvo::USize(2))));
    }

    #[test]
    fn version_one_does_not_reject_v1_keys() {
        let cfg = match parse16(b"runner = \"r\"\n[viola]\nversion = 1\n") {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert!(matches!(cfg.runner, Maybe::Is(b"r")));
    }

    #[test]
    fn version_two_rejects_runner_key() {
        let err = match parse16(b"runner = \"r\"\n[viola]\nversion = 2\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::IncompatibleSchema { .. }));
    }

    #[test]
    fn version_two_rejects_grammars_key() {
        let err = match parse16(b"grammars = [\"g\"]\n[viola]\nversion = 2\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::IncompatibleSchema { .. }));
    }

    #[test]
    fn version_two_rejects_lints_key() {
        let err = match parse16(b"lints = [\"l\"]\n[viola]\nversion = 2\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::IncompatibleSchema { .. }));
    }

    #[test]
    fn version_two_rejects_v1_keys_declared_before_marker() {
        // Order independence: v1 key first, then version=2 still
        // surfaces IncompatibleSchema (end-of-parse check).
        let err = match parse16(b"runner = \"r\"\n[viola]\nversion = 2\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::IncompatibleSchema { .. }));
    }

    #[test]
    fn integer_with_garbage_suffix_rejected() {
        let err = match parse16(b"[viola]\nversion = 2abc\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::InvalidInteger { .. }));
    }

    #[test]
    fn duplicate_version_fails() {
        let err = match parse16(b"[viola]\nversion = 2\nversion = 2\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::DuplicateKey { .. }));
    }

    #[test]
    fn unknown_key_in_viola_section_fails() {
        let err = match parse16(b"[viola]\nbogus = 1\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::UnknownKey { .. }));
    }

    // ----- plugins / inherit -----

    #[test]
    fn plugins_and_inherit_under_viola_section() {
        // Memo-following placement: keys sit visually under [viola].
        // TOML semantics put them inside [viola]; the parser routes
        // these two specific keys back to the same root-level
        // storage so memo-verbatim configs work.
        let input = b"\
[viola]
version = 2

plugins = [\"a.dylib\", \"jsr:@hiisi/viola-default-lints\"]
inherit = [\"@hiisi/recommended\"]
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert_eq!(cfg.plugin_len.0, 2);
        assert_eq!(cfg.plugins_slice()[0], b"a.dylib");
        assert_eq!(cfg.inherit_len.0, 1);
    }

    #[test]
    fn plugins_and_inherit_at_root() {
        let input = b"\
plugins = [\"a.dylib\", \"jsr:@hiisi/viola-default-lints\"]
inherit = [\"@hiisi/recommended\"]

[viola]
version = 2
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert_eq!(cfg.plugin_len.0, 2);
        assert_eq!(cfg.plugins_slice()[0], b"a.dylib");
        assert_eq!(cfg.plugins_slice()[1], b"jsr:@hiisi/viola-default-lints");
        assert_eq!(cfg.inherit_len.0, 1);
        assert_eq!(cfg.inherit_slice()[0], b"@hiisi/recommended");
    }

    #[test]
    fn plugins_declared_twice_across_placements_fails() {
        let input = b"\
plugins = [\"a.dylib\"]
[viola]
version = 2
plugins = [\"b.dylib\"]
";
        let err = match parse16(input) {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::DuplicateKey { .. }));
    }

    // ----- gates -----

    #[test]
    fn gates_global_defaults() {
        let input = b"\
[viola]
version = 2

[gates]
commit = \"warn\"
build = \"error\"
push = \"error\"
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert!(matches!(cfg.gates.commit, Maybe::Is(b"warn")));
        assert!(matches!(cfg.gates.build, Maybe::Is(b"error")));
        assert!(matches!(cfg.gates.push, Maybe::Is(b"error")));
        assert_eq!(cfg.gate_overrides_len.0, 0);
    }

    #[test]
    fn gates_per_lint_override() {
        let input = b"\
[viola]
version = 2

[gates]
commit = \"warn\"

[gates.no-bare-numeric]
commit = \"warn\"
build = \"error\"
push = \"error\"

[gates.duplicate-logic]
commit = \"off\"
build = \"warn\"
push = \"error\"
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert_eq!(cfg.gate_overrides_len.0, 2);
        let o0 = &cfg.gate_overrides_slice()[0];
        assert_eq!(o0.lint_id, b"no-bare-numeric");
        assert!(matches!(o0.thresholds.commit, Maybe::Is(b"warn")));
        assert!(matches!(o0.thresholds.build, Maybe::Is(b"error")));
        let o1 = &cfg.gate_overrides_slice()[1];
        assert_eq!(o1.lint_id, b"duplicate-logic");
        assert!(matches!(o1.thresholds.commit, Maybe::Is(b"off")));
        assert!(matches!(o1.thresholds.build, Maybe::Is(b"warn")));
    }

    #[test]
    fn duplicate_gates_subtable_fails() {
        let input = b"\
[viola]
version = 2

[gates.foo]
commit = \"warn\"

[gates.foo]
commit = \"error\"
";
        let err = match parse16(input) {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::DuplicateKey { .. }));
    }

    #[test]
    fn unknown_key_in_gates_section_fails() {
        let err = match parse16(b"[viola]\nversion = 2\n[gates]\nbogus = \"x\"\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::UnknownKey { .. }));
    }

    // ----- [[severity]] rules -----

    #[test]
    fn severity_rule_flat() {
        let input = b"\
[[severity]]
issue = \"duplicate-logic/*\"
files = \"src/**\"
gate = \"commit\"
level = \"warn\"
min_confidence = 80
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert_eq!(cfg.severity_rules_len.0, 1);
        let r = &cfg.severity_rules_slice()[0];
        assert!(matches!(r.issue, Maybe::Is(b"duplicate-logic/*")));
        assert_eq!(r.files_len.0, 1);
        assert_eq!(r.files_slice()[0], b"src/**");
        assert!(matches!(r.gate, Maybe::Is(b"commit")));
        assert!(matches!(r.level, Maybe::Is(b"warn")));
        assert!(matches!(r.min_confidence, Maybe::Is(arvo::USize(80))));
    }

    #[test]
    fn severity_rule_files_array() {
        let input = b"\
[[severity]]
issue = \"*\"
files = [\"src/**\", \"lib/**\"]
level = \"error\"
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        let r = &cfg.severity_rules_slice()[0];
        assert_eq!(r.files_len.0, 2);
        assert_eq!(r.files_slice()[0], b"src/**");
        assert_eq!(r.files_slice()[1], b"lib/**");
    }

    #[test]
    fn severity_rule_multiple() {
        let input = b"\
[[severity]]
issue = \"*\"
files = \"**/*_test.ts\"
level = \"off\"

[[severity]]
issue = \"duplicate-logic/*\"
level = \"warn\"
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert_eq!(cfg.severity_rules_len.0, 2);
    }

    #[test]
    fn severity_missing_level_fails() {
        let err = match parse16(b"[[severity]]\nissue = \"*\"\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::MissingRequiredField { .. }));
    }

    #[test]
    fn severity_invalid_issue_pattern_fails() {
        let err = match parse16(b"[[severity]]\nissue = \"bogus\"\nlevel = \"warn\"\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::InvalidIssuePattern { .. }));
    }

    #[test]
    fn severity_unknown_level_fails() {
        let err = match parse16(b"[[severity]]\nissue = \"*\"\nlevel = \"bogus\"\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::Unexpected { .. }));
    }

    #[test]
    fn severity_unknown_gate_fails() {
        let err = match parse16(
            b"[[severity]]\nissue = \"*\"\ngate = \"runtime\"\nlevel = \"warn\"\n",
        ) {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::Unexpected { .. }));
    }

    #[test]
    fn severity_min_confidence_above_100_fails() {
        let err = match parse16(
            b"[[severity]]\nissue = \"*\"\nlevel = \"warn\"\nmin_confidence = 250\n",
        ) {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::InvalidInteger { .. }));
    }

    #[test]
    fn severity_unknown_field_fails() {
        let err = match parse16(
            b"[[severity]]\nissue = \"*\"\nbogus = \"x\"\nlevel = \"warn\"\n",
        ) {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::UnknownKey { .. }));
    }

    #[test]
    fn unknown_array_table_name_fails() {
        let err = match parse16(b"[[bogus]]\nfoo = \"x\"\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::UnknownKey { .. }));
    }

    // ----- [[severity]] compound rules -----

    #[test]
    fn severity_compound_all() {
        let input = b"\
[[severity]]
level = \"warn\"
all = [
  { issue = \"duplicate-logic/*\" },
  { files = \"src/**\" },
]
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        let r = &cfg.severity_rules_slice()[0];
        assert!(matches!(r.compound, Maybe::Is(crate::CompoundOp::All)));
        assert_eq!(r.partials_len.0, 2);
        assert!(matches!(r.partials[0].issue, Maybe::Is(b"duplicate-logic/*")));
        assert_eq!(r.partials[1].files_len.0, 1);
        assert_eq!(r.partials[1].files_slice()[0], b"src/**");
    }

    #[test]
    fn severity_compound_any() {
        let input = b"\
[[severity]]
level = \"off\"
any = [
  { files = \"**/*_test.ts\" },
  { files = \"**/fixtures/**\" },
]
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        let r = &cfg.severity_rules_slice()[0];
        assert!(matches!(r.compound, Maybe::Is(crate::CompoundOp::Any)));
        assert_eq!(r.partials_len.0, 2);
    }

    #[test]
    fn severity_compound_not() {
        let input = b"\
[[severity]]
level = \"off\"
not = { files = \"**/*.generated.ts\" }
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        let r = &cfg.severity_rules_slice()[0];
        assert!(matches!(r.compound, Maybe::Is(crate::CompoundOp::Not)));
        assert_eq!(r.partials_len.0, 1);
        assert_eq!(r.partials[0].files_slice()[0], b"**/*.generated.ts");
    }

    #[test]
    fn severity_compound_with_min_confidence_inside_partial() {
        let input = b"\
[[severity]]
level = \"warn\"
all = [
  { issue = \"*::correctness>=major\", min_confidence = 80 },
]
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        let r = &cfg.severity_rules_slice()[0];
        assert!(matches!(r.partials[0].min_confidence, Maybe::Is(arvo::USize(80))));
    }

    #[test]
    fn severity_compound_partial_files_array() {
        let input = b"\
[[severity]]
level = \"warn\"
all = [
  { files = [\"src/**\", \"lib/**\"] },
]
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        let r = &cfg.severity_rules_slice()[0];
        assert_eq!(r.partials[0].files_len.0, 2);
    }

    #[test]
    fn severity_flat_then_compound_fails() {
        let err = match parse16(
            b"[[severity]]\nlevel = \"warn\"\nissue = \"*\"\nall = [{ files = \"x\" }]\n",
        ) {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::Unexpected { .. }));
    }

    #[test]
    fn severity_compound_then_flat_fails() {
        let err = match parse16(
            b"[[severity]]\nlevel = \"warn\"\nall = [{ files = \"x\" }]\nissue = \"*\"\n",
        ) {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::Unexpected { .. }));
    }

    #[test]
    fn severity_double_compound_fails() {
        let err = match parse16(
            b"[[severity]]\nlevel = \"warn\"\nall = [{ files = \"x\" }]\nany = [{ files = \"y\" }]\n",
        ) {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::DuplicateKey { .. }));
    }

    #[test]
    fn severity_compound_unknown_partial_key_fails() {
        let err = match parse16(
            b"[[severity]]\nlevel = \"warn\"\nall = [{ bogus = \"x\" }]\n",
        ) {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::UnknownKey { .. }));
    }

    #[test]
    fn severity_compound_capacity_exhausted() {
        // SEVERITY_COMPOUND_CAP = 4; five entries triggers Capacity.
        let err = match parse16(
            b"[[severity]]\nlevel = \"warn\"\nall = [\
              { files = \"a\" }, { files = \"b\" }, { files = \"c\" },\
              { files = \"d\" }, { files = \"e\" }]\n",
        ) {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::Capacity { .. }));
    }

    #[test]
    fn severity_compound_integer_no_space_before_brace() {
        // Regression: `{ min_confidence = 80 }` parsed; `{
        // min_confidence = 80}` (no space before `}`) used to fail
        // with InvalidInteger because parse_integer's terminator
        // set did not include `}`.
        let cfg = match parse16(
            b"[[severity]]\nlevel = \"warn\"\nall = [{ min_confidence = 80}]\n",
        ) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert!(matches!(
            cfg.severity_rules_slice()[0].partials[0].min_confidence,
            Maybe::Is(arvo::USize(80))
        ));
    }

    #[test]
    fn severity_compound_integer_no_space_before_comma() {
        let cfg = match parse16(
            b"[[severity]]\nlevel = \"warn\"\nall = [{ min_confidence = 80,issue = \"*\" }]\n",
        ) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        let p = &cfg.severity_rules_slice()[0].partials[0];
        assert!(matches!(p.min_confidence, Maybe::Is(arvo::USize(80))));
        assert!(matches!(p.issue, Maybe::Is(b"*")));
    }

    #[test]
    fn severity_compound_invalid_issue_pattern_fails() {
        let err = match parse16(
            b"[[severity]]\nlevel = \"warn\"\nall = [{ issue = \"bogus\" }]\n",
        ) {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::InvalidIssuePattern { .. }));
    }

    // ----- ts section still works under v2 -----

    // ----- [lint.<id>] plugin config blocks -----

    #[test]
    fn lint_block_captures_raw_body() {
        let input = b"\
[lint.duplicate-logic]
ignoreFunctions = [\"impactCond\", \"categoryCond\"]
threshold = 80
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert_eq!(cfg.lint_configs_len.0, 1);
        let block = &cfg.lint_configs_slice()[0];
        assert_eq!(block.lint_id, b"duplicate-logic");
        // raw_body is the slice from after the `]` of the section
        // header through to EOF, trimmed of trailing whitespace.
        assert!(block.raw_body.starts_with(b"\nignoreFunctions"));
        assert!(block.raw_body.ends_with(b"threshold = 80"));
    }

    #[test]
    fn lint_block_terminates_on_next_section_header() {
        let input = b"\
[lint.first]
a = \"x\"

[lint.second]
b = \"y\"
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert_eq!(cfg.lint_configs_len.0, 2);
        let first = &cfg.lint_configs_slice()[0];
        assert_eq!(first.lint_id, b"first");
        assert!(contains_seq(first.raw_body, b"a = \"x\""));
        assert!(!contains_seq(first.raw_body, b"b = \"y\""));
        let second = &cfg.lint_configs_slice()[1];
        assert_eq!(second.lint_id, b"second");
        assert!(contains_seq(second.raw_body, b"b = \"y\""));
    }

    #[test]
    fn lint_block_alongside_gates_and_ts() {
        let input = b"\
[viola]
version = 2

[gates]
commit = \"warn\"

[lint.foo]
opt = \"bar\"

[ts]
config = \"viola.config.ts\"
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert_eq!(cfg.lint_configs_len.0, 1);
        assert_eq!(cfg.lint_configs_slice()[0].lint_id, b"foo");
        assert!(matches!(cfg.gates.commit, Maybe::Is(b"warn")));
        assert!(matches!(cfg.ts_config, Maybe::Is(b"viola.config.ts")));
    }

    #[test]
    fn duplicate_lint_block_fails() {
        let input = b"\
[lint.foo]
a = \"x\"

[lint.foo]
b = \"y\"
";
        let err = match parse16(input) {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::DuplicateKey { .. }));
    }

    #[test]
    fn lint_block_validates_value_shape() {
        // A bare token (not a string / array / integer) is rejected.
        let input = b"[lint.foo]\nbogus = bareword\n";
        let err = match parse16(input) {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::Unexpected { .. }));
    }

    #[test]
    fn lint_block_accepts_integer_value() {
        let cfg = match parse16(b"[lint.foo]\nthreshold = 42\n") {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert_eq!(cfg.lint_configs_slice()[0].lint_id, b"foo");
    }

    #[test]
    fn ts_section_compatible_with_v2() {
        let input = b"\
[viola]
version = 2

[ts]
config = \"viola.config.ts\"
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert!(matches!(cfg.ts_config, Maybe::Is(b"viola.config.ts")));
    }
}

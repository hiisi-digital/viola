//! Zero-copy TOML subset parser.
//!
//! Grammar (informal):
//!
//! ```text
//! file        := { ws_or_comment | entry | section } eof
//! section     := "[" ws section_name ws "]" ws_or_comment
//! section_name:= "ts"   (only this one in v1)
//! entry       := key ws "=" ws value ws_or_comment
//! key         := ascii_alpha { ascii_alphanum | "_" | "-" }
//! value       := string | array
//! string      := '"' { byte except '"' or '\n' } '"'
//! array       := "[" ws { string ws "," ws } [ string ws ] "]"
//! ws          := { space | tab | newline }
//! ws_or_comment := ws | "#" { byte except '\n' } '\n'
//! ```
//!
//! Anything outside this grammar surfaces as
//! [`ConfigError::Unexpected`] or [`ConfigError::UnknownKey`]. The
//! parser does NOT support: dotted keys, arbitrary sub-tables (only
//! the well-known `[ts]` section is recognised), inline tables
//! (`{ ... }`), datetimes, integers, floats, booleans, literal strings
//! (`'...'`), multiline strings, or escape sequences. These are
//! off-scope for v1; they fail loudly rather than silently.

use notko::{Maybe, Outcome};

use crate::ViolaConfig;

/// Diagnostics for a parse failure.
///
/// Each variant carries the byte offset into the input where the error
/// was detected, so a CLI can render a useful position pointer.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ConfigError {
    /// A character outside the supported grammar appeared at this offset.
    Unexpected { offset: arvo::USize },
    /// A key the schema does not define. Per v1 strictness, unknown
    /// keys fail loudly so config drift surfaces immediately.
    UnknownKey { offset: arvo::USize },
    /// String literal opened but not closed before EOF or newline.
    UnterminatedString { offset: arvo::USize },
    /// Array literal opened but not closed before EOF.
    UnterminatedArray { offset: arvo::USize },
    /// Key appeared more than once at top level.
    DuplicateKey { offset: arvo::USize },
    /// Array contains more entries than the [`ViolaConfig`] capacity.
    Capacity { offset: arvo::USize },
    /// Value type mismatch (e.g. array where string expected).
    TypeMismatch { offset: arvo::USize },
}

/// Parse `input` into a [`ViolaConfig`] with capacity `MAX_PLUGINS`.
pub fn parse<'a, const MAX_PLUGINS: usize>(
    input: &'a [u8],
) -> Outcome<ViolaConfig<'a, MAX_PLUGINS>, ConfigError> {
    let mut cfg = ViolaConfig::<'a, MAX_PLUGINS>::empty();
    let mut runner_seen = false;
    let mut grammars_seen = false;
    let mut lints_seen = false;
    let mut ts_section_seen = false;
    let mut ts_config_seen = false;
    let mut current_section = Section::Root;

    let mut p = Parser::new(input);
    p.skip_ws_and_comments();
    while !p.at_end() {
        // Section header.
        if p.peek() == b'[' {
            let section_offset = p.offset;
            p.advance();
            p.skip_ws();
            let name_start = p.offset;
            let name = match p.parse_key() {
                Outcome::Ok(k) => k,
                Outcome::Err(e) => return Outcome::Err(e),
            };
            p.skip_ws();
            if !p.consume_byte(b']') {
                return Outcome::Err(ConfigError::Unexpected {
                    offset: arvo::USize(p.offset),
                });
            }
            match name {
                b"ts" => {
                    if ts_section_seen {
                        return Outcome::Err(ConfigError::DuplicateKey {
                            offset: arvo::USize(section_offset),
                        });
                    }
                    ts_section_seen = true;
                    current_section = Section::Ts;
                }
                _ => {
                    return Outcome::Err(ConfigError::UnknownKey {
                        offset: arvo::USize(name_start),
                    });
                }
            }
            p.skip_ws_and_comments();
            continue;
        }

        let key_start = p.offset;
        let key = match p.parse_key() {
            Outcome::Ok(k) => k,
            Outcome::Err(e) => return Outcome::Err(e),
        };
        p.skip_ws();
        if !p.consume_byte(b'=') {
            return Outcome::Err(ConfigError::Unexpected { offset: arvo::USize(p.offset) });
        }
        p.skip_ws();

        if let Section::Ts = current_section {
            match key {
                b"config" => {
                    if ts_config_seen {
                        return Outcome::Err(ConfigError::DuplicateKey {
                            offset: arvo::USize(key_start),
                        });
                    }
                    let value = match p.parse_string() {
                        Outcome::Ok(v) => v,
                        Outcome::Err(e) => return Outcome::Err(e),
                    };
                    cfg.ts_config = Maybe::Is(value);
                    ts_config_seen = true;
                }
                _ => {
                    return Outcome::Err(ConfigError::UnknownKey {
                        offset: arvo::USize(key_start),
                    });
                }
            }
            p.skip_ws_and_comments();
            continue;
        }

        match key {
            b"runner" => {
                if runner_seen {
                    return Outcome::Err(ConfigError::DuplicateKey {
                        offset: arvo::USize(key_start),
                    });
                }
                let value = match p.parse_string() {
                    Outcome::Ok(v) => v,
                    Outcome::Err(e) => return Outcome::Err(e),
                };
                cfg.runner = Maybe::Is(value);
                runner_seen = true;
            }
            b"grammars" => {
                if grammars_seen {
                    return Outcome::Err(ConfigError::DuplicateKey {
                        offset: arvo::USize(key_start),
                    });
                }
                let count = match p.parse_string_array(&mut cfg.grammars) {
                    Outcome::Ok(n) => n,
                    Outcome::Err(e) => return Outcome::Err(e),
                };
                cfg.grammar_len = count;
                grammars_seen = true;
            }
            b"lints" => {
                if lints_seen {
                    return Outcome::Err(ConfigError::DuplicateKey {
                        offset: arvo::USize(key_start),
                    });
                }
                let count = match p.parse_string_array(&mut cfg.lints) {
                    Outcome::Ok(n) => n,
                    Outcome::Err(e) => return Outcome::Err(e),
                };
                cfg.lint_len = count;
                lints_seen = true;
            }
            _ => {
                return Outcome::Err(ConfigError::UnknownKey {
                    offset: arvo::USize(key_start),
                });
            }
        }

        p.skip_ws_and_comments();
    }

    Outcome::Ok(cfg)
}

/// Which TOML section the parser is currently reading entries into.
#[derive(Copy, Clone)]
enum Section {
    /// Top-level keys (`runner`, `grammars`, `lints`).
    Root,
    /// Inside `[ts]`. Accepts `config = "..."`.
    Ts,
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
            // Inside array context the only valid value is a string;
            // anything else is a syntax error, not a type mismatch.
            // Surface as Unexpected so the variant matches the
            // user-facing meaning ("garbage where a string was
            // expected").
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

    #[test]
    fn empty_input_yields_empty_config() {
        let cfg = match parse16(b"") {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("unexpected err: {e:?}"),
        };
        assert!(matches!(cfg.runner, Maybe::Isnt));
        assert_eq!(cfg.grammar_len.0, 0);
        assert_eq!(cfg.lint_len.0, 0);
    }

    #[test]
    fn single_runner_key() {
        let input = b"runner = \"plugins/runner.dylib\"\n";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        match cfg.runner {
            Maybe::Is(s) => assert_eq!(s, b"plugins/runner.dylib"),
            Maybe::Isnt => panic!("runner missing"),
        }
    }

    #[test]
    fn full_v1_schema() {
        let input = b"\
# Comment line above the runner key.
runner = \"runner.dylib\"

# Two grammars, one with a trailing comma.
grammars = [
    \"g1.dylib\",
    \"g2.dylib\",
]

lints = [\"l1.dylib\", \"l2.dylib\", \"l3.dylib\"]
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        match cfg.runner {
            Maybe::Is(s) => assert_eq!(s, b"runner.dylib"),
            Maybe::Isnt => panic!("runner missing"),
        }
        assert_eq!(cfg.grammar_len.0, 2);
        assert_eq!(cfg.grammars_slice()[0], b"g1.dylib");
        assert_eq!(cfg.grammars_slice()[1], b"g2.dylib");
        assert_eq!(cfg.lint_len.0, 3);
        assert_eq!(cfg.lints_slice()[0], b"l1.dylib");
        assert_eq!(cfg.lints_slice()[1], b"l2.dylib");
        assert_eq!(cfg.lints_slice()[2], b"l3.dylib");
    }

    #[test]
    fn unknown_key_fails() {
        let err = match parse16(b"unknown = \"x\"\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::UnknownKey { .. }));
    }

    #[test]
    fn duplicate_runner_fails() {
        let err = match parse16(b"runner = \"a\"\nrunner = \"b\"\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::DuplicateKey { .. }));
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
    fn unterminated_array_fails() {
        let err = match parse16(b"lints = [\"a\", \"b\"") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::UnterminatedArray { .. }));
    }

    #[test]
    fn type_mismatch_array_for_runner() {
        let err = match parse16(b"runner = [\"a\"]\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::TypeMismatch { .. }));
    }

    #[test]
    fn capacity_exhausted_returns_error() {
        let cfg: Outcome<ViolaConfig<2>, _> =
            parse::<2>(b"lints = [\"a\", \"b\", \"c\"]\n");
        let err = match cfg {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::Capacity { .. }));
    }

    #[test]
    fn comments_and_blank_lines_skipped() {
        let input = b"\
# leading comment
\t
runner = \"r\" # trailing comment

# trailing
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        match cfg.runner {
            Maybe::Is(s) => assert_eq!(s, b"r"),
            Maybe::Isnt => panic!("runner missing"),
        }
    }

    #[test]
    fn empty_array_is_zero_count() {
        let cfg = match parse16(b"lints = []\n") {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert_eq!(cfg.lint_len.0, 0);
    }

    #[test]
    fn trailing_comment_no_newline_terminates_cleanly() {
        // Regression: skip_ws_and_comments must not infinite-loop when
        // a comment runs to EOF without a trailing newline.
        let cfg = match parse16(b"runner = \"r\"\n# trailing no newline") {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        match cfg.runner {
            Maybe::Is(s) => assert_eq!(s, b"r"),
            Maybe::Isnt => panic!("runner missing"),
        }
    }

    #[test]
    fn cr_only_line_endings_in_comment_consume_to_eof() {
        // Documented behaviour: comments terminate on \n only. \r in
        // a comment body is consumed as part of the comment. Lock
        // the behaviour so a future change is intentional.
        let cfg = match parse16(b"runner = \"r\"\n# a\r b\n") {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        match cfg.runner {
            Maybe::Is(s) => assert_eq!(s, b"r"),
            Maybe::Isnt => panic!("runner missing"),
        }
    }

    #[test]
    fn double_comma_in_array_surfaces_as_unexpected() {
        let err = match parse16(b"lints = [\"a\",,\"b\"]\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(
            matches!(err, ConfigError::Unexpected { .. }),
            "got {err:?}, expected Unexpected",
        );
    }

    #[test]
    fn leading_comma_in_array_surfaces_as_unexpected() {
        let err = match parse16(b"lints = [,\"a\"]\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::Unexpected { .. }));
    }

    #[test]
    fn equals_inside_string_value_is_preserved() {
        let cfg = match parse16(b"runner = \"path/with=equals.dylib\"\n") {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        match cfg.runner {
            Maybe::Is(s) => assert_eq!(s, b"path/with=equals.dylib"),
            Maybe::Isnt => panic!("runner missing"),
        }
    }

    #[test]
    fn ts_section_with_config_key() {
        let input = b"\
runner = \"r.dylib\"

[ts]
config = \"viola.config.ts\"
";
        let cfg = match parse16(input) {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        match cfg.ts_config {
            Maybe::Is(s) => assert_eq!(s, b"viola.config.ts"),
            Maybe::Isnt => panic!("ts_config missing"),
        }
    }

    #[test]
    fn ts_section_alone() {
        let cfg = match parse16(b"[ts]\nconfig = \"x.ts\"\n") {
            Outcome::Ok(c) => c,
            Outcome::Err(e) => panic!("err {e:?}"),
        };
        assert!(matches!(cfg.runner, Maybe::Isnt));
        match cfg.ts_config {
            Maybe::Is(s) => assert_eq!(s, b"x.ts"),
            Maybe::Isnt => panic!("ts_config missing"),
        }
    }

    #[test]
    fn unknown_section_fails() {
        let err = match parse16(b"[grammar]\nfoo = \"x\"\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::UnknownKey { .. }));
    }

    #[test]
    fn duplicate_ts_section_fails() {
        let err = match parse16(b"[ts]\nconfig = \"a\"\n[ts]\nconfig = \"b\"\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::DuplicateKey { .. }));
    }

    #[test]
    fn unknown_key_in_ts_section_fails() {
        let err = match parse16(b"[ts]\nbogus = \"x\"\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::UnknownKey { .. }));
    }

    #[test]
    fn duplicate_ts_config_key_fails() {
        let err = match parse16(b"[ts]\nconfig = \"a\"\nconfig = \"b\"\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::DuplicateKey { .. }));
    }

    #[test]
    fn empty_key_position_fails() {
        let err = match parse16(b"= \"x\"\n") {
            Outcome::Ok(_) => panic!("expected err"),
            Outcome::Err(e) => e,
        };
        assert!(matches!(err, ConfigError::Unexpected { .. }));
    }
}

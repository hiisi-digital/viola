//! Issue pattern grammar.
//!
//! ```text
//! pattern   ::= head selector?
//! head      ::= "*" | linter "/*" | linter "/" issue
//! selector  ::= "::" category
//!             | ">=" impact
//!             | "::" category ">=" impact
//! linter    ::= ident
//! issue     ::= ident
//! category  ::= "correctness" | "maintainability" | "consistency"
//!             | "performance" | "style"
//! impact    ::= "critical" | "major" | "minor" | "trivial"
//! ident     ::= ascii_alpha { ascii_alphanum | "_" | "-" }
//! ```
//!
//! Use [`parse_issue_pattern`] to turn a raw issue-pattern byte
//! slice into the structured [`IssuePattern`]. The runtime calls
//! this when matching diagnostics against `[[severity]]` rules; the
//! config parser also calls it at parse time so typos surface as
//! [`ConfigError::InvalidIssuePattern`](crate::ConfigError).

use notko::{Maybe, Outcome};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum IssuePatternError {
    /// Empty pattern.
    Empty,
    /// Linter component contains an invalid character or is empty
    /// after splitting on `/`.
    InvalidLinter,
    /// Issue component (after `linter/`) is missing or invalid.
    InvalidIssue,
    /// Category selector token does not match a known category.
    UnknownCategory,
    /// Impact selector token does not match a known impact.
    UnknownImpact,
    /// Selector chained in the wrong order or missing the value
    /// after `::` or `>=`.
    MalformedSelector,
    /// Trailing junk after the final selector.
    TrailingJunk,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Category {
    Correctness,
    Maintainability,
    Consistency,
    Performance,
    Style,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Impact {
    Critical,
    Major,
    Minor,
    Trivial,
}

/// Resolved issue pattern. `linter == None && issue == None`
/// represents the wildcard `"*"`. `linter == Some(...) && issue ==
/// None` represents `linter/*`. Both `Some` is `linter/issue`.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct IssuePattern<'a> {
    pub linter: Maybe<&'a [u8]>,
    pub issue: Maybe<&'a [u8]>,
    pub category: Maybe<Category>,
    pub impact_at_least: Maybe<Impact>,
}

pub fn parse_issue_pattern<'a>(input: &'a [u8]) -> Outcome<IssuePattern<'a>, IssuePatternError> {
    if input.is_empty() {
        return Outcome::Err(IssuePatternError::Empty);
    }
    let mut p = 0usize;
    let (linter, issue) = match parse_head(input, &mut p) {
        Outcome::Ok(t) => t,
        Outcome::Err(e) => return Outcome::Err(e),
    };
    let mut category: Maybe<Category> = Maybe::Isnt;
    let mut impact_at_least: Maybe<Impact> = Maybe::Isnt;
    // Selectors: `::category`, `>=impact`. Either may appear; if
    // both, `::category` first then `>=impact`.
    if p + 1 < input.len() && input[p] == b':' && input[p + 1] == b':' {
        p += 2;
        category = match parse_category(input, &mut p) {
            Outcome::Ok(c) => Maybe::Is(c),
            Outcome::Err(e) => return Outcome::Err(e),
        };
    }
    if p + 1 < input.len() && input[p] == b'>' && input[p + 1] == b'=' {
        p += 2;
        impact_at_least = match parse_impact(input, &mut p) {
            Outcome::Ok(i) => Maybe::Is(i),
            Outcome::Err(e) => return Outcome::Err(e),
        };
    }
    if p < input.len() {
        return Outcome::Err(IssuePatternError::TrailingJunk);
    }
    Outcome::Ok(IssuePattern { linter, issue, category, impact_at_least })
}

fn parse_head<'a>(
    input: &'a [u8],
    p: &mut usize,
) -> Outcome<(Maybe<&'a [u8]>, Maybe<&'a [u8]>), IssuePatternError> {
    if *p < input.len() && input[*p] == b'*' {
        *p += 1;
        return Outcome::Ok((Maybe::Isnt, Maybe::Isnt));
    }
    let linter_start = *p;
    while *p < input.len() && is_ident_byte(input[*p]) {
        *p += 1;
    }
    if *p == linter_start {
        return Outcome::Err(IssuePatternError::InvalidLinter);
    }
    let linter = &input[linter_start..*p];
    if *p >= input.len() || input[*p] != b'/' {
        return Outcome::Err(IssuePatternError::InvalidLinter);
    }
    *p += 1;
    if *p < input.len() && input[*p] == b'*' {
        *p += 1;
        return Outcome::Ok((Maybe::Is(linter), Maybe::Isnt));
    }
    let issue_start = *p;
    while *p < input.len() && is_ident_byte(input[*p]) {
        *p += 1;
    }
    if *p == issue_start {
        return Outcome::Err(IssuePatternError::InvalidIssue);
    }
    Outcome::Ok((Maybe::Is(linter), Maybe::Is(&input[issue_start..*p])))
}

fn parse_category(
    input: &[u8],
    p: &mut usize,
) -> Outcome<Category, IssuePatternError> {
    let start = *p;
    while *p < input.len() && is_ident_byte(input[*p]) {
        *p += 1;
    }
    if *p == start {
        return Outcome::Err(IssuePatternError::MalformedSelector);
    }
    let token = &input[start..*p];
    match token {
        b"correctness" => Outcome::Ok(Category::Correctness),
        b"maintainability" => Outcome::Ok(Category::Maintainability),
        b"consistency" => Outcome::Ok(Category::Consistency),
        b"performance" => Outcome::Ok(Category::Performance),
        b"style" => Outcome::Ok(Category::Style),
        _ => Outcome::Err(IssuePatternError::UnknownCategory),
    }
}

fn parse_impact(
    input: &[u8],
    p: &mut usize,
) -> Outcome<Impact, IssuePatternError> {
    let start = *p;
    while *p < input.len() && is_ident_byte(input[*p]) {
        *p += 1;
    }
    if *p == start {
        return Outcome::Err(IssuePatternError::MalformedSelector);
    }
    let token = &input[start..*p];
    match token {
        b"critical" => Outcome::Ok(Impact::Critical),
        b"major" => Outcome::Ok(Impact::Major),
        b"minor" => Outcome::Ok(Impact::Minor),
        b"trivial" => Outcome::Ok(Impact::Trivial),
        _ => Outcome::Err(IssuePatternError::UnknownImpact),
    }
}

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(s: &[u8]) -> IssuePattern<'_> {
        match parse_issue_pattern(s) {
            Outcome::Ok(p) => p,
            Outcome::Err(e) => panic!("expected ok, got {e:?}"),
        }
    }
    fn err(s: &[u8]) -> IssuePatternError {
        match parse_issue_pattern(s) {
            Outcome::Ok(p) => panic!("expected err, got {p:?}"),
            Outcome::Err(e) => e,
        }
    }

    #[test]
    fn star() {
        let p = ok(b"*");
        assert!(matches!(p.linter, Maybe::Isnt));
        assert!(matches!(p.issue, Maybe::Isnt));
    }

    #[test]
    fn linter_star() {
        let p = ok(b"duplicate-logic/*");
        assert!(matches!(p.linter, Maybe::Is(b"duplicate-logic")));
        assert!(matches!(p.issue, Maybe::Isnt));
    }

    #[test]
    fn linter_issue() {
        let p = ok(b"duplicate-logic/lambda-too-similar");
        assert!(matches!(p.linter, Maybe::Is(b"duplicate-logic")));
        assert!(matches!(p.issue, Maybe::Is(b"lambda-too-similar")));
    }

    #[test]
    fn star_category() {
        let p = ok(b"*::correctness");
        assert!(matches!(p.category, Maybe::Is(Category::Correctness)));
    }

    #[test]
    fn star_impact() {
        let p = ok(b"*>=major");
        assert!(matches!(p.impact_at_least, Maybe::Is(Impact::Major)));
    }

    #[test]
    fn category_and_impact() {
        let p = ok(b"style-guide/*::style>=minor");
        assert!(matches!(p.linter, Maybe::Is(b"style-guide")));
        assert!(matches!(p.issue, Maybe::Isnt));
        assert!(matches!(p.category, Maybe::Is(Category::Style)));
        assert!(matches!(p.impact_at_least, Maybe::Is(Impact::Minor)));
    }

    #[test]
    fn empty_pattern_fails() {
        assert_eq!(err(b""), IssuePatternError::Empty);
    }

    #[test]
    fn missing_slash_fails() {
        assert_eq!(err(b"duplicate-logic"), IssuePatternError::InvalidLinter);
    }

    #[test]
    fn unknown_category_fails() {
        assert_eq!(err(b"*::bogus"), IssuePatternError::UnknownCategory);
    }

    #[test]
    fn unknown_impact_fails() {
        assert_eq!(err(b"*>=enormous"), IssuePatternError::UnknownImpact);
    }

    #[test]
    fn impact_before_category_fails() {
        // `>=` before `::` is malformed: the category branch never
        // runs to consume `::cat`, so the trailing-junk check fires.
        assert_eq!(err(b"*>=major::style"), IssuePatternError::TrailingJunk);
    }

    #[test]
    fn trailing_junk_fails() {
        assert_eq!(err(b"*::correctness extra"), IssuePatternError::TrailingJunk);
    }

    #[test]
    fn single_trailing_colon_is_trailing_junk() {
        // `*:` has exactly one colon; the `::` guard requires two,
        // so the lone colon falls through and the trailing-junk
        // check fires. Locks the path to the right diagnostic.
        assert_eq!(err(b"*:"), IssuePatternError::TrailingJunk);
    }
}

//! Hand-rolled JSON parser for the worker-to-host direction. Handles
//! three flat message kinds (`done`, `err`, `diag`) via a key-scan over
//! the line, with per-field stack buffers for the diag payload.
//! Replaces `serde_json::from_str` with a no-alloc decoder.

use crate::error::DenoRuntimeError;
use crate::{
    MESSAGE_CAP, PATH_CAP, PLUGIN_ID_CAP, RULE_ID_CAP, SEVERITY_CAP,
};
use notko::{Maybe, Outcome};
use std::io::BufRead;                                                // lint:allow(forbidden-imports, no-std) -- BufRead is std; read_line_into wraps a ChildStdout BufReader. tracked: #197

pub(crate) struct ParsedDiag {
    pub(crate) plugin_id: [u8; PLUGIN_ID_CAP],
    pub(crate) plugin_id_len: usize,
    pub(crate) rule_id: [u8; RULE_ID_CAP],
    pub(crate) rule_id_len: usize,
    pub(crate) severity: [u8; SEVERITY_CAP],
    pub(crate) severity_len: usize,
    pub(crate) message: [u8; MESSAGE_CAP],
    pub(crate) message_len: usize,
    pub(crate) path: [u8; PATH_CAP],
    pub(crate) path_len: usize,
    pub(crate) line: u32,
    pub(crate) column: u32,
}

pub(crate) enum ParsedMessage {
    Done,
    Err,
    Diag(ParsedDiag),
}

/// Find a `"<key>":` marker in the buffer; returns the index of the
/// first byte after the colon. Tolerates whitespace between the
/// closing quote and the colon. Linear scan, suitable for the small
/// fixed protocol.
///
/// The scan is structure-aware: it tracks JSON string-context so a
/// quoted key character inside a value-string body does not match,
/// and it tracks `{` / `[` nesting so the caller can constrain
/// matches to a specific nesting depth.
///
/// Returns the position of every `"<key>":` whose opening quote sits
/// at the named `target_depth`. Pass `target_depth = 0` for top-level
/// keys of the outer object (the worker emits `{"done":true,...}` so
/// depth-0 is the outer object's key position). Pass `target_depth = 1`
/// when scanning inside an already-extracted nested object such as the
/// diag payload's body (the caller in this module slices the inner
/// object's bytes before scanning, so depth-1 there becomes depth-0).
fn find_key_at_depth(buf: &[u8], key: &[u8], target_depth: u32) -> Maybe<usize> {
    if buf.len() < key.len() + 4 { return Maybe::Isnt; }
    let mut idx = 0;
    let kl = key.len();
    let mut depth: u32 = 0;
    let mut in_string = false;
    while idx < buf.len() {
        let b = buf[idx];
        if in_string {
            // Inside a string body. Skip escaped chars; close on unescaped `"`.
            if b == b'\\' {
                idx = idx.saturating_add(2);
                continue;
            }
            if b == b'"' {
                in_string = false;
                idx += 1;
                continue;
            }
            idx += 1;
            continue;
        }
        // Outside any string.
        if b == b'{' || b == b'[' {
            depth = depth.saturating_add(1);
            idx += 1;
            continue;
        }
        if b == b'}' || b == b']' {
            depth = depth.saturating_sub(1);
            idx += 1;
            continue;
        }
        if b == b'"' {
            // A `"` outside any string opens a new string. Check whether
            // the next bytes form `<key>":` and whether we are at the
            // requested nesting depth. We want to match keys that sit at
            // depth `target_depth + 1` after the opening `{` increments
            // the depth, so test against `depth == target_depth + 1`.
            if depth == target_depth + 1
                && idx + 1 + kl < buf.len()
                && &buf[idx + 1..idx + 1 + kl] == key
                && buf[idx + 1 + kl] == b'"'
            {
                let mut j = idx + 2 + kl;
                while j < buf.len() && (buf[j] == b' ' || buf[j] == b'\t') {
                    j += 1;
                }
                if j < buf.len() && buf[j] == b':' {
                    return Maybe::Is(j + 1);
                }
            }
            // Not the target key. Enter string-skipping mode.
            in_string = true;
            idx += 1;
            continue;
        }
        idx += 1;
    }
    Maybe::Isnt
}

/// Shorthand for top-level key lookup. The outer protocol object
/// opens at byte 0, so its keys sit at depth 1 internally; the
/// `find_key_at_depth(..., 0)` call counts that depth as the target.
fn find_key(buf: &[u8], key: &[u8]) -> Maybe<usize> {
    find_key_at_depth(buf, key, 0)
}

fn skip_ws(buf: &[u8], mut idx: usize) -> usize {
    while idx < buf.len() && matches!(buf[idx], b' ' | b'\t' | b'\n' | b'\r') {
        idx += 1;
    }
    idx
}

/// Parse a JSON string literal starting at `idx` (where `buf[idx] == '"'`).
/// Returns `(decoded_byte_count, position_after_closing_quote)`.
fn parse_json_string(
    buf: &[u8],
    idx: usize,
    out: &mut [u8],
) -> Outcome<(usize, usize), DenoRuntimeError> {
    if idx >= buf.len() || buf[idx] != b'"' {
        return Outcome::Err(DenoRuntimeError::DecodeMalformed);
    }
    let mut i = idx + 1;
    let mut o: usize = 0;
    while i < buf.len() {
        let b = buf[i];
        if b == b'"' {
            return Outcome::Ok((o, i + 1));
        }
        if b == b'\\' {
            i += 1;
            if i >= buf.len() {
                return Outcome::Err(DenoRuntimeError::DecodeMalformed);
            }
            let esc_byte = match buf[i] {
                b'"' => b'"',
                b'\\' => b'\\',
                b'/' => b'/',
                b'n' => b'\n',
                b'r' => b'\r',
                b't' => b'\t',
                b'b' => 0x08,
                b'f' => 0x0c,
                b'u' => {
                    // Decode `\uXXXX` into UTF-8. `JSON.stringify` emits
                    // this form for control chars and for U+2028/U+2029
                    // line separators. Silently mapping to `?` would
                    // corrupt user-authored identifiers; decode instead.
                    // Supplementary planes require a `\uHHHH\uLLLL`
                    // surrogate pair; we hard-fail on a lone surrogate.
                    if i + 4 >= buf.len() {
                        return Outcome::Err(DenoRuntimeError::DecodeMalformed);
                    }
                    let high = match decode_hex4(&buf[i + 1..i + 5]) {
                        Maybe::Is(v) => v,
                        Maybe::Isnt => {
                            return Outcome::Err(DenoRuntimeError::DecodeMalformed);
                        }
                    };
                    i += 5;
                    let cp: u32 = if (0xD800..=0xDBFF).contains(&high) {
                        // High surrogate — expect `\uLLLL` low surrogate.
                        if i + 5 >= buf.len() || buf[i] != b'\\' || buf[i + 1] != b'u' {
                            return Outcome::Err(DenoRuntimeError::DecodeMalformed);
                        }
                        let low = match decode_hex4(&buf[i + 2..i + 6]) {
                            Maybe::Is(v) => v,
                            Maybe::Isnt => {
                                return Outcome::Err(DenoRuntimeError::DecodeMalformed);
                            }
                        };
                        if !(0xDC00..=0xDFFF).contains(&low) {
                            return Outcome::Err(DenoRuntimeError::DecodeMalformed);
                        }
                        i += 6;
                        0x10000
                            + (((high as u32) - 0xD800) << 10)
                            + ((low as u32) - 0xDC00)
                    } else if (0xDC00..=0xDFFF).contains(&high) {
                        // Lone low surrogate.
                        return Outcome::Err(DenoRuntimeError::DecodeMalformed);
                    } else {
                        high as u32
                    };
                    match encode_utf8(cp, out, o) {
                        Maybe::Is(n) => o = n,
                        Maybe::Isnt => {
                            return Outcome::Err(DenoRuntimeError::DecodeMalformed);
                        }
                    }
                    continue;
                }
                _ => return Outcome::Err(DenoRuntimeError::DecodeMalformed),
            };
            if o >= out.len() {
                return Outcome::Err(DenoRuntimeError::DecodeMalformed);
            }
            out[o] = esc_byte;
            o += 1;
            i += 1;
            continue;
        }
        if o >= out.len() {
            return Outcome::Err(DenoRuntimeError::DecodeMalformed);
        }
        out[o] = b;
        o += 1;
        i += 1;
    }
    Outcome::Err(DenoRuntimeError::DecodeMalformed)
}

/// Decode four ASCII hex digits into a u16. Returns `Isnt` if any
/// byte is not a hex digit.
fn decode_hex4(buf: &[u8]) -> Maybe<u16> {
    if buf.len() < 4 {
        return Maybe::Isnt;
    }
    let mut v: u16 = 0;
    for &b in &buf[..4] {
        let d = match b {
            b'0'..=b'9' => (b - b'0') as u16,
            b'a'..=b'f' => (b - b'a' + 10) as u16,
            b'A'..=b'F' => (b - b'A' + 10) as u16,
            _ => return Maybe::Isnt,
        };
        v = (v << 4) | d;
    }
    Maybe::Is(v)
}

/// Encode a Unicode code point into `out` starting at `pos`, returning
/// the new write position. Emits 1-4 UTF-8 bytes per the standard.
/// Returns `Isnt` on out-of-range code point or out-of-capacity.
fn encode_utf8(cp: u32, out: &mut [u8], pos: usize) -> Maybe<usize> {
    if cp <= 0x7F {
        if pos >= out.len() {
            return Maybe::Isnt;
        }
        out[pos] = cp as u8;
        Maybe::Is(pos + 1)
    } else if cp <= 0x7FF {
        if pos + 1 >= out.len() {
            return Maybe::Isnt;
        }
        out[pos] = 0xC0 | ((cp >> 6) as u8);
        out[pos + 1] = 0x80 | ((cp & 0x3F) as u8);
        Maybe::Is(pos + 2)
    } else if cp <= 0xFFFF {
        if pos + 2 >= out.len() {
            return Maybe::Isnt;
        }
        out[pos] = 0xE0 | ((cp >> 12) as u8);
        out[pos + 1] = 0x80 | (((cp >> 6) & 0x3F) as u8);
        out[pos + 2] = 0x80 | ((cp & 0x3F) as u8);
        Maybe::Is(pos + 3)
    } else if cp <= 0x10FFFF {
        if pos + 3 >= out.len() {
            return Maybe::Isnt;
        }
        out[pos] = 0xF0 | ((cp >> 18) as u8);
        out[pos + 1] = 0x80 | (((cp >> 12) & 0x3F) as u8);
        out[pos + 2] = 0x80 | (((cp >> 6) & 0x3F) as u8);
        out[pos + 3] = 0x80 | ((cp & 0x3F) as u8);
        Maybe::Is(pos + 4)
    } else {
        Maybe::Isnt
    }
}

/// Parse a JSON unsigned integer starting at `idx`. Returns
/// `(value, position_after_last_digit)`.
fn parse_json_u32(buf: &[u8], idx: usize) -> Outcome<(u32, usize), DenoRuntimeError> {
    let mut i = idx;
    let mut n: u32 = 0;
    let mut any = false;
    while i < buf.len() && buf[i].is_ascii_digit() {
        let d = (buf[i] - b'0') as u32;
        n = match n.checked_mul(10).and_then(|x| x.checked_add(d)) {
            Some(v) => v,
            None => return Outcome::Err(DenoRuntimeError::DecodeMalformed),
        };
        i += 1;
        any = true;
    }
    if !any {
        return Outcome::Err(DenoRuntimeError::DecodeMalformed);
    }
    Outcome::Ok((n, i))
}

pub(crate) fn trim_ws(buf: &[u8]) -> &[u8] {
    let mut start = 0;
    while start < buf.len() && matches!(buf[start], b' ' | b'\t' | b'\n' | b'\r') {
        start += 1;
    }
    let mut end = buf.len();
    while end > start && matches!(buf[end - 1], b' ' | b'\t' | b'\n' | b'\r') {
        end -= 1;
    }
    &buf[start..end]
}

pub(crate) fn parse_message(line: &[u8]) -> Outcome<ParsedMessage, DenoRuntimeError> {
    let buf = trim_ws(line);

    // Detect message kind by the leftmost top-level key marker.
    let done_at = find_key(buf, b"done");
    let err_at = find_key(buf, b"err");
    let diag_at = find_key(buf, b"diag");

    let mut best: Maybe<(usize, u8)> = Maybe::Isnt;
    if let Maybe::Is(i) = done_at {
        best = Maybe::Is((i, 0));
    }
    if let Maybe::Is(i) = err_at {
        best = match best {
            Maybe::Is((j, _)) if i >= j => best,
            _ => Maybe::Is((i, 1)),
        };
    }
    if let Maybe::Is(i) = diag_at {
        best = match best {
            Maybe::Is((j, _)) if i >= j => best,
            _ => Maybe::Is((i, 2)),
        };
    }

    let (idx, kind) = match best {
        Maybe::Is(v) => v,
        Maybe::Isnt => return Outcome::Err(DenoRuntimeError::DecodeMalformed),
    };
    let after_colon = skip_ws(buf, idx);

    match kind {
        0 => {
            if after_colon + 4 <= buf.len()
                && &buf[after_colon..after_colon + 4] == b"true"
            {
                Outcome::Ok(ParsedMessage::Done)
            } else {
                Outcome::Err(DenoRuntimeError::DecodeMalformed)
            }
        }
        1 => {
            // Surface the worker error without decoding it in detail; the
            // host has nowhere to put the message bytes (no String) and
            // the error category is what matters.
            Outcome::Ok(ParsedMessage::Err)
        }
        2 => {
            let inner_start = skip_ws(buf, after_colon);
            if inner_start >= buf.len() || buf[inner_start] != b'{' {
                return Outcome::Err(DenoRuntimeError::DecodeMalformed);
            }
            let inner = &buf[inner_start..];

            let mut diag = ParsedDiag {
                plugin_id: [0; PLUGIN_ID_CAP],
                plugin_id_len: 0,
                rule_id: [0; RULE_ID_CAP],
                rule_id_len: 0,
                severity: [0; SEVERITY_CAP],
                severity_len: 0,
                message: [0; MESSAGE_CAP],
                message_len: 0,
                path: [0; PATH_CAP],
                path_len: 0,
                line: 0,
                column: 0,
            };

            if let Maybe::Is(at) = find_key(inner, b"plugin_id") {
                let p = skip_ws(inner, at);
                match parse_json_string(inner, p, &mut diag.plugin_id) {
                    Outcome::Ok((l, _)) => diag.plugin_id_len = l,
                    Outcome::Err(e) => return Outcome::Err(e),
                }
            }
            if let Maybe::Is(at) = find_key(inner, b"rule_id") {
                let p = skip_ws(inner, at);
                match parse_json_string(inner, p, &mut diag.rule_id) {
                    Outcome::Ok((l, _)) => diag.rule_id_len = l,
                    Outcome::Err(e) => return Outcome::Err(e),
                }
            }
            if let Maybe::Is(at) = find_key(inner, b"severity") {
                let p = skip_ws(inner, at);
                match parse_json_string(inner, p, &mut diag.severity) {
                    Outcome::Ok((l, _)) => diag.severity_len = l,
                    Outcome::Err(e) => return Outcome::Err(e),
                }
            }
            if let Maybe::Is(at) = find_key(inner, b"message") {
                let p = skip_ws(inner, at);
                match parse_json_string(inner, p, &mut diag.message) {
                    Outcome::Ok((l, _)) => diag.message_len = l,
                    Outcome::Err(e) => return Outcome::Err(e),
                }
            }
            if let Maybe::Is(at) = find_key(inner, b"path") {
                let p = skip_ws(inner, at);
                match parse_json_string(inner, p, &mut diag.path) {
                    Outcome::Ok((l, _)) => diag.path_len = l,
                    Outcome::Err(e) => return Outcome::Err(e),
                }
            }
            if let Maybe::Is(at) = find_key(inner, b"line") {
                let p = skip_ws(inner, at);
                match parse_json_u32(inner, p) {
                    Outcome::Ok((v, _)) => diag.line = v,
                    Outcome::Err(e) => return Outcome::Err(e),
                }
            }
            if let Maybe::Is(at) = find_key(inner, b"column") {
                let p = skip_ws(inner, at);
                match parse_json_u32(inner, p) {
                    Outcome::Ok((v, _)) => diag.column = v,
                    Outcome::Err(e) => return Outcome::Err(e),
                }
            }

            Outcome::Ok(ParsedMessage::Diag(diag))
        }
        _ => Outcome::Err(DenoRuntimeError::DecodeMalformed),
    }
}

/// Read bytes from `reader` into `buf` up to and including the next
/// newline. Replaces `BufReader::read_line` which writes into a
/// heap-allocated `String`. Returns the number of bytes written, or
/// 0 on EOF before any byte is consumed.
///
/// On `LineTooLong`, the function drains the rest of the over-length
/// line up to and including its terminating newline before returning,
/// so the next call sees a clean stream position. Without this drain
/// a single oversized worker line would split-desync the stream and
/// every subsequent line would be parsed against partial leftovers.
pub(crate) fn read_line_into<R: BufRead>(
    reader: &mut R,
    buf: &mut [u8],
) -> Outcome<usize, DenoRuntimeError> {
    let mut written = 0;
    loop {
        let consumed_n;
        let saw_newline;
        let overflowed;
        {
            let available = match reader.fill_buf() {
                Ok(b) => b,
                Err(_) => return Outcome::Err(DenoRuntimeError::ReadWorkerFailed),
            };
            if available.is_empty() {
                return Outcome::Ok(written);
            }
            let mut consumed = 0;
            let mut found_nl = false;
            let mut overflowed_inner = false;
            for (i, &b) in available.iter().enumerate() {
                consumed = i + 1;
                if written >= buf.len() {
                    // Step back one — we did NOT write this byte. The
                    // drain loop below will consume it (and the rest
                    // of the line) so the next call starts cleanly.
                    consumed = i;
                    overflowed_inner = true;
                    break;
                }
                buf[written] = b;
                written += 1;
                if b == b'\n' {
                    found_nl = true;
                    break;
                }
            }
            consumed_n = consumed;
            saw_newline = found_nl;
            overflowed = overflowed_inner;
        }
        reader.consume(consumed_n);
        if overflowed {
            // Drain to end-of-line (or EOF) so the next read starts
            // on the first byte of the following line.
            drain_to_newline(reader);
            return Outcome::Err(DenoRuntimeError::LineTooLong);
        }
        if saw_newline {
            return Outcome::Ok(written);
        }
    }
}

/// Consume bytes from `reader` until a newline has been observed
/// (and consumed), or the stream ends. Errors are swallowed: the
/// caller has already decided the current line is unrecoverable;
/// this function exists only to advance the cursor.
fn drain_to_newline<R: BufRead>(reader: &mut R) {
    loop {
        let consumed_n;
        let saw_newline;
        {
            let available = match reader.fill_buf() {
                Ok(b) => b,
                Err(_) => return,
            };
            if available.is_empty() {
                return;
            }
            let mut consumed = 0;
            let mut found_nl = false;
            for (i, &b) in available.iter().enumerate() {
                consumed = i + 1;
                if b == b'\n' {
                    found_nl = true;
                    break;
                }
            }
            consumed_n = consumed;
            saw_newline = found_nl;
        }
        reader.consume(consumed_n);
        if saw_newline {
            return;
        }
    }
}

//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Glob matching.
 *
 * Lived in `src/config/pattern.ts` beside the config-specific pattern parsing,
 * which meant conditions and grammars reached into the config module for it.
 * It is a utility and nothing about it is config, so it is here and everything
 * imports it from one place.
 *
 * `matchesFilePattern` used to sit alongside `matchesGlob` and its whole body
 * was `return matchesGlob(...)`. There is one function now.
 *
 * @module
 */

/**
 * Compiled patterns, kept because the same handful of globs is tested against
 * every file in a run and compiling a regex per test is real work. Patterns
 * come from config, so the set is small and bounded by it.
 */
const compiled = new Map<string, RegExp>();

/** Stands in for `**` while the `*` rule runs, so it cannot eat half of one. */
const DOUBLE_STAR = "\u0000";

/** Stands in for `/**​/`, which spans zero directories as well as many. */
const SPANNING = "\u0001";

/**
 * Turn a glob into the regex that matches it.
 *
 * `*` matches anything except a separator, `**` matches anything at all, and
 * `?` matches one character.
 */
export function globToRegex(pattern: string): RegExp {
  const known = compiled.get(pattern);
  if (known !== undefined) return known;

  const source = pattern
    // Everything regex treats specially, except the glob operators below.
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // `a/**/b` matches `a/b` as well as `a/x/b`, which is what every other
    // glob means by it. Held aside first, because the bare `**` rule below
    // would leave the surrounding slashes as literals and require a directory.
    .replaceAll("/**/", SPANNING)
    .replaceAll("**", DOUBLE_STAR)
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replaceAll(DOUBLE_STAR, ".*")
    .replaceAll(SPANNING, "/(?:.*/)?");

  const regex = new RegExp(`^${source}$`);
  compiled.set(pattern, regex);
  return regex;
}

/**
 * Whether a string matches one glob.
 */
export function matchesGlob(value: string, pattern: string): boolean {
  if (pattern === "*") return true;
  return globToRegex(pattern).test(value);
}

/**
 * Whether a string matches any of several globs.
 */
export function matchesAnyGlob(
  value: string,
  patterns: readonly string[],
): boolean {
  return patterns.some((p) => matchesGlob(value, p));
}

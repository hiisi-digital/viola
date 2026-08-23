//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * A greeting.
 */
export function greet(name: string): string {
  return `hello ${name}`;
}

// Undocumented and exported, which `missing-docs` has an opinion about.
export function shout(name: string): string {
  return `HELLO ${name}`;
}

//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * A different bar for different parts of a tree.
 *
 * `when.in` takes globs, and a later rule wins, so the file the last matching
 * rule names is the one whose level applies.
 */

import defaultLints from "jsr:@hiisi/viola-default-lints@^0.3.2";
import typescript from "jsr:@hiisi/viola-grammar-ts@^0.3.2";
import { report, viola, when } from "../../mod.ts";

export default viola()
  .use(defaultLints)
  .add(typescript).as("ts")
  .rule(report.error, when.confidence.atLeast(1))
  // Generated code is not ours to fix, so it is not reported at all.
  .rule(report.off, when.in("src/generated/**"))
  // Scripts are held to a lower bar than the library they support.
  .rule(report.warn, when.in("src/scripts/**"));

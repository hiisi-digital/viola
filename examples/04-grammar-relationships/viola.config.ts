//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Two grammars matching one file, and which of them answers.
 *
 * A `.ts` file matches the TypeScript grammar. Where a project also registers
 * a grammar that claims `.ts` (a stricter dialect, a superset, a
 * project-specific one), both match and something has to decide.
 *
 * `overrides` says the primary answers and the secondary is dropped for that
 * file. `supplements` says the secondary answers first and the primary fills
 * in what it did not find, merged by position so nothing is counted twice.
 *
 * This example exists because the feature was in the readme and did nothing.
 * The rules were collected by the config builder and read by no one, so a
 * project writing this got no error and no effect. Nothing caught it: the
 * resolver behind it had five hundred lines of passing tests, all of which
 * built a resolver directly and never asked whether a config reached one.
 */

import defaultLints from "jsr:@hiisi/viola-default-lints@^0.3.2";
import typescript from "jsr:@hiisi/viola-grammar-ts@^0.3.2";
import { grammar, report, viola, when } from "../../mod.ts";

export default viola()
  .use(defaultLints)
  // The same grammar under two aliases. A real project would register two
  // different ones; what is being shown is the resolution, and using one
  // grammar twice keeps the example about that rather than about a second
  // grammar's dependencies.
  .add(typescript).as("strict")
  .add(typescript).as("loose")
  .rule(report.error, when.confidence.atLeast(1))
  // For anything under `src/`, `strict` answers and `loose` is suppressed.
  .rule(grammar("strict").overrides("loose"), when.in("src/**"))
  // Everywhere else `loose` answers first and `strict` fills the gaps.
  .rule(grammar("strict").supplements("loose"), when.in("tools/**"));

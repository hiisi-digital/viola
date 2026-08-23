//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Report level from how sure the linter is.
 *
 * Rules read last to first and the first that matches decides, so the narrow
 * rule goes after the broad one. The same shape as a stylesheet.
 */

import defaultLints from "jsr:@hiisi/viola-default-lints@^0.3.2";
import typescript from "jsr:@hiisi/viola-grammar-ts@^0.3.2";
import { report, viola, when } from "../../mod.ts";

export default viola()
  .use(defaultLints)
  .add(typescript).as("ts")
  // Everything a linter suspects is worth seeing.
  .rule(report.info, when.confidence.atLeast(1))
  // What it is fairly sure of is a warning.
  .rule(report.warn, when.confidence.atLeast(60))
  // What it is certain of stops the run.
  .rule(report.error, when.confidence.atLeast(90));

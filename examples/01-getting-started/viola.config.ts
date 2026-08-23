//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * The smallest config that does something.
 *
 * A plugin supplies the lints, a grammar makes files readable, and one rule
 * says what to do with what turns up. Without the grammar viola loads, finds
 * nothing, and reports nothing, which reads exactly like a clean project.
 */

import defaultLints from "jsr:@hiisi/viola-default-lints@^0.3.2";
import typescript from "jsr:@hiisi/viola-grammar-ts@^0.3.2";
import { report, viola, when } from "../../mod.ts";

export default viola()
  .use(defaultLints)
  .add(typescript).as("ts")
  // Anything a linter is at all sure of is an error. A gate that warns is not
  // a gate.
  .rule(report.error, when.confidence.atLeast(1));

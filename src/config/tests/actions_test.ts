/**
 * Tests for report actions.
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import { isReportAction, report } from "../actions.ts";
import { ReportLevel } from "../enums.ts";

// =============================================================================
// Report Action Creation Tests
// =============================================================================

Deno.test("report.error creates error action", () => {
  assertEquals(report.error.type, "report");
  assertEquals(report.error.level, ReportLevel.Error);
});

Deno.test("report.warn creates warn action", () => {
  assertEquals(report.warn.type, "report");
  assertEquals(report.warn.level, ReportLevel.Warn);
});

Deno.test("report.info creates info action", () => {
  assertEquals(report.info.type, "report");
  assertEquals(report.info.level, ReportLevel.Info);
});

Deno.test("report.hint creates hint action", () => {
  assertEquals(report.hint.type, "report");
  assertEquals(report.hint.level, ReportLevel.Hint);
});

Deno.test("report.off creates off action", () => {
  assertEquals(report.off.type, "report");
  assertEquals(report.off.level, ReportLevel.Off);
});

Deno.test("report.skip creates skip action", () => {
  assertEquals(report.skip.type, "report");
  assertEquals(report.skip.level, ReportLevel.Skip);
});

// =============================================================================
// Type Guard Tests
// =============================================================================

Deno.test("isReportAction returns true for report actions", () => {
  assertEquals(isReportAction(report.error), true);
  assertEquals(isReportAction(report.warn), true);
  assertEquals(isReportAction(report.info), true);
  assertEquals(isReportAction(report.hint), true);
  assertEquals(isReportAction(report.off), true);
  assertEquals(isReportAction(report.skip), true);
});

Deno.test("isReportAction returns false for non-report actions", () => {
  assertEquals(isReportAction({ type: "other" }), false);
  assertEquals(isReportAction({ type: "fix" }), false);
});

// =============================================================================
// All Levels Covered Tests
// =============================================================================

Deno.test("all ReportLevel values have corresponding report action", () => {
  const allLevels = [
    ReportLevel.Error,
    ReportLevel.Warn,
    ReportLevel.Info,
    ReportLevel.Hint,
    ReportLevel.Off,
    ReportLevel.Skip,
  ];

  const reportLevels = [
    report.error.level,
    report.warn.level,
    report.info.level,
    report.hint.level,
    report.off.level,
    report.skip.level,
  ];

  // Every level should be represented
  for (const level of allLevels) {
    assertEquals(
      reportLevels.includes(level),
      true,
      `Missing report action for level ${level}`,
    );
  }
});

// =============================================================================
// Action Identity Tests
// =============================================================================

Deno.test("report actions are referentially stable", () => {
  // Same action should be same object
  assertEquals(report.error === report.error, true);
  assertEquals(report.warn === report.warn, true);
});

Deno.test("different report actions are different objects", () => {
  assertEquals(report.error === report.warn, false);
  assertEquals(report.error === report.info, false);
  assertEquals(report.off === report.skip, false);
});

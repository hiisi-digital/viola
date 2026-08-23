/**
 * The words viola uses to classify an issue.
 *
 * There was one of these per condition system and the two disagreed: one had
 * four impacts as strings, the other five as numbers, and their categories
 * differed by three members. A linter declaring `impact: "major"` in its
 * catalog therefore meant one thing to the evaluator and something else to a
 * condition. This is the merge, and it is a superset of both, so nothing that
 * either side could say has stopped being sayable.
 *
 * Values are strings because that is what a catalog declares and what a config
 * file writes. Ordering is the array below rather than the value, so a member
 * can be inserted without renumbering anything.
 *
 * @module
 */

/**
 * How much an issue matters.
 *
 * `Moderate` came from the numeric enum and sits where its ordering put it,
 * between `Major` and `Minor`. Nothing in the estate declares it yet.
 */
export enum Impact {
  /** Must fix, blocks release */
  Critical = "critical",
  /** Should fix soon */
  Major = "major",
  /** Worth fixing, not urgent */
  Moderate = "moderate",
  /** Fix when convenient */
  Minor = "minor",
  /** Nice to have */
  Trivial = "trivial",
}

/**
 * Most severe first. This array is the ordering, so `impactValue` and every
 * comparison over `Impact` agree by construction.
 */
export const IMPACT_ORDER: readonly Impact[] = [
  Impact.Critical,
  Impact.Major,
  Impact.Moderate,
  Impact.Minor,
  Impact.Trivial,
] as const;

/**
 * Position in `IMPACT_ORDER`. Lower is more severe, which is why every
 * comparison over impact negates before it compares.
 */
export function impactValue(impact: Impact): number {
  return IMPACT_ORDER.indexOf(impact);
}

/**
 * Negative when `a` is more severe than `b`, positive when less, zero when
 * equal.
 */
export function compareImpact(a: Impact, b: Impact): number {
  return impactValue(a) - impactValue(b);
}

/**
 * What kind of problem an issue is.
 *
 * `Security`, `Documentation` and `Deprecation` came from the other enum. No
 * linter declares them yet; they are here because dropping a word from a
 * vocabulary is how a later lint finds it has nowhere to file itself.
 */
export enum Category {
  /** Code is wrong or broken */
  Correctness = "correctness",
  /** Harder to work with over time */
  Maintainability = "maintainability",
  /** Breaks project conventions */
  Consistency = "consistency",
  /** Slower than needed */
  Performance = "performance",
  /** Cosmetic or formatting */
  Style = "style",
  /** Exploitable */
  Security = "security",
  /** Missing or wrong documentation */
  Documentation = "documentation",
  /** Use of something on its way out */
  Deprecation = "deprecation",
}

/**
 * How viola reports an issue once a rule has classified it.
 */
export enum ReportLevel {
  /** Fails the run, exits non-zero */
  Error = "error",
  /** Reported, does not fail the run */
  Warn = "warn",
  /** Reported as information */
  Info = "info",
  /** Reported dimly, as a suggestion */
  Hint = "hint",
  /** Not reported */
  Off = "off",
  /** Do not run linters over this at all. File scope only. */
  Skip = "skip",
}

/**
 * Either spelling of a category.
 *
 * `Category.Correctness` from code, `"correctness"` from a hand-written
 * catalog or config file. A linter declares its catalog as an object literal
 * and should not have to import an enum to name a category in it.
 */
export type CategoryName = `${Category}`;

/** Either spelling of an impact, for the same reason. */
export type ImpactName = `${Impact}`;

/** Either spelling of a report level, for the same reason. */
export type ReportLevelName = `${ReportLevel}`;

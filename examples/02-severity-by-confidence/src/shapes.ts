/**
 * Findings across the confidence range, so more than one band in the config is
 * visible in a single run.
 *
 * `duplicate-strings` scales its confidence with how often the literal turns
 * up, so `"rectangle"` five times over reaches the top band while a single
 * unused export sits in the middle one.
 */

/** Area of a rectangle. */
export function area(width: number, height: number): number {
  return width * height;
}

/** Area of a circle. */
export function areaOf(radius: number): number {
  return Math.PI * radius * radius;
}

/** The long name of a shape. */
export function describe(kind: string): string {
  if (kind === "rectangle") return "a rectangle";
  return "unknown shape";
}

/** The short name of a shape. */
export function label(kind: string): string {
  if (kind === "rectangle") return "rectangle";
  return "unknown";
}

/** Whether a shape has four corners. */
export function isRectangular(kind: string): boolean {
  return kind === "rectangle";
}

/** The sides a shape has. */
export function sides(kind: string): number {
  return kind === "rectangle" ? 4 : 0;
}

/** Under `src/`, so the overriding grammar is the one that read this. */
export function identity<T>(value: T): T {
  return value;
}

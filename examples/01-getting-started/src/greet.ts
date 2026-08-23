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

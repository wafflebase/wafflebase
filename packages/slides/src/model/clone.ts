/**
 * Plain-value deep clone via JSON. Use for snapshot values, init payloads,
 * and other plain-JS objects that have no Date / Map / RegExp / class
 * instances. Returns a fresh object tree with no shared references to the
 * input.
 */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

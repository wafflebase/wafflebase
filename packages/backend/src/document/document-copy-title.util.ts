/** Matches the rename DTO's `@Length(1, 200)` so a copy is always renameable. */
const MAX_TITLE_LENGTH = 200;

/**
 * The title for a duplicate of `title`: `<title> (copy)`, then
 * `<title> (copy 2)`, `(copy 3)` … until one is free among `existing`.
 *
 * `existing` is the set of titles already in the destination workspace+folder.
 * Titles are not unique in the data model, so this is cosmetic de-duplication
 * rather than a constraint — two concurrent copies can legitimately land on the
 * same name, and the list already tolerates duplicate titles.
 *
 * The result is clamped to 200 characters by trimming the *base* title, never
 * the ` (copy N)` suffix — a clamped copy still reads as a copy.
 */
export function copyTitle(title: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' (copy)' : ` (copy ${n})`;
    const base = title.slice(0, MAX_TITLE_LENGTH - suffix.length);
    const candidate = `${base}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

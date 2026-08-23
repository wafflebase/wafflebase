/**
 * The id this page's reports are filed under.
 *
 * ONE derivation, imported by both users. It was computed independently in
 * `mount.tsx` (the `.wb-reports/` directory name) and in `use-debug-session.ts`
 * (the `localStorage` key), so the report directory and the persisted session
 * agreed only because both modules happened to evaluate in the same millisecond
 * — and neither file mentioned the other.
 *
 * The CLOCK PREFIX is kept so a directory listing sorts the way the sessions
 * happened. That holds because base-36 epoch-milliseconds are eight characters
 * wide from 2059 back past 1975 — a lexicographic sort only agrees with a
 * numeric one at a fixed width, so the property is real but not eternal. The suffix is what makes it an id: two tabs opened in the same
 * millisecond took the same one, which meant they shared a
 * `.wb-reports/<sessionId>` directory and a persistence key — so one tab's
 * bundle could be written over the other's, and the store's adoption check read
 * both as the same session.
 */

/** Random suffix length. Six base-36 characters is ~31 bits. */
const SUFFIX_LEN = 6;

/**
 * Built from injected sources so a collision is testable rather than argued
 * about: pin the clock, vary only the randomness, and assert the ids differ.
 */
export function newSessionId(
  now: () => number = Date.now,
  random: () => number = Math.random,
): string {
  const suffix = Math.floor(random() * 36 ** SUFFIX_LEN)
    .toString(36)
    .padStart(SUFFIX_LEN, '0');
  return `wb-${now().toString(36)}-${suffix}`;
}

export const DEBUG_SESSION_ID = newSessionId();

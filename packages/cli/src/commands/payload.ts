/**
 * Shared helpers for the worksheet `get` / `set` command pairs.
 *
 * Every one of those endpoints answers a GET with an envelope (`{ merges: … }`,
 * `{ filter: … }`, `{ columnWidths: … }`) while its PUT takes the bare value and
 * the client adds the envelope back. A `set` that did not unwrap would send the
 * value wrapped twice, so `<resource> get D | <resource> set D` — the round trip
 * `docs/design/cli.md` documents for this whole group — would 400.
 */

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Accept the response envelope the matching `get` prints as well as the bare
 * value, so a `get | set` pipe is a round trip.
 *
 * Call this BEFORE the `--dry-run` branch. The printed body is the wire body,
 * so previewing the still-enveloped payload would preview a request the server
 * rejects — and a shape check downstream has to fail the same way whether or
 * not `--dry-run` was passed.
 */
export function unwrap(payload: unknown, key: string): unknown {
  if (isPlainObject(payload) && key in payload) return payload[key];
  return payload;
}

import type { MiroImportNote } from "@/api/miro";

/**
 * Wording for everything a Miro import did NOT carry over.
 *
 * Kept out of the dialog component so it stays pure and directly testable —
 * this is the logic that decides whether an import is reported as clean, and
 * getting it wrong means silently losing content.
 */

/**
 * Label a `skipped` entry keyed by Miro item/connector type in a way that
 * reads naturally for both — e.g. "3 embeds" and "2 connectors", not the
 * literal "3 connector".
 */
export function pluralizeSkipLabel(type: string, count: number): string {
  if (count === 1) return `1 ${type}`;
  return type.endsWith("s") ? `${count} ${type}` : `${count} ${type}s`;
}

/**
 * Wording for a `skipped` key that names a REASON rather than a Miro item
 * type, or null when the key is an ordinary type.
 *
 * The connector keys are the only ones like this, and they exist because the
 * two reasons call for different reactions. A connector with a dangling end
 * was already dangling in Miro and nothing could have saved it; a connector
 * whose target we did not map is ours — an unsupported type, or one past the
 * import ceiling — and re-importing a smaller board would fix it.
 *
 * Each returns a COMPLETE clause, "skipped" included, because these do not
 * survive being grouped with the item types: the caller joins those into one
 * list and appends a single trailing "skipped", which would have produced
 * "…whose target was not imported skipped".
 */
export function describeSkip(type: string, count: number): string | null {
  switch (type) {
    case "connector-free-end":
      return `${pluralizeSkipLabel("connector", count)} skipped — not attached at both ends in Miro`;
    case "connector":
      return `${pluralizeSkipLabel("connector", count)} skipped — their target was not imported`;
    default:
      return null;
  }
}

/**
 * Human wording for a backend import note.
 *
 * The `default` arm is the important one. `MiroImportNote.reason` is a plain
 * string, not a literal union, so the backend can (and does) grow new reasons
 * — `stalled` was already a third one this dialog originally ignored. A note
 * we cannot pretty-print must still reach the user in some honest form rather
 * than be dropped, because a dropped note makes a degraded import look clean.
 */
export function describeNote(note: MiroImportNote): string {
  const what = note.itemType ?? "items";
  switch (note.reason) {
    case "image-failed":
      return `${note.count} image(s) failed`;
    case "image-budget":
      // Nothing broke here: the board carried more image data than one import
      // is allowed to move, so the rest was left behind. Worded apart from
      // `image-failed` because the user's next step is different.
      return `${note.count} image(s) skipped — the board exceeds the per-import image limit`;
    case "truncated":
      // The fraction is the whole point. "truncated at 5000" reads the same
      // whether the board lost two items or half of itself, and a board that
      // lost half is one the user has to know about before they start working
      // in the copy.
      return note.total !== undefined && note.total > note.count
        ? `only ${note.count} of ${note.total} ${what} were imported — the board is over the import limit`
        : `${what} truncated at the import limit (${note.count})`;
    case "stalled":
      return `${what} may be incomplete — Miro stopped returning results after ${note.count}`;
    default:
      return `${note.reason} (${what}: ${note.count})`;
  }
}

/**
 * Human wording for a mapper APPROXIMATION — an item that did come across, in
 * a degraded form.
 *
 * These used to be counted alongside the skips, which read as
 * "2 shape-kinds skipped": it claimed content was missing when it was present,
 * and named a Miro item type (`shape-kind`) that does not exist.
 */
export function describeApproximation(kind: string, count: number): string {
  switch (kind) {
    case "shape-kind":
      return `${count} shape(s) with an unrecognized Miro shape type imported as rectangles`;
    case "parent-position":
      // Miro positions a framed item against its frame, so an unresolvable
      // frame leaves no absolute coordinate to recover and the item lands at
      // its frame-local offset instead. The frame going missing is only the
      // common cause — a malformed parent reference, a parent cycle, and
      // anything descended from either land here too, with the frame itself
      // present. So the wording names the unresolved frame, not a missing one.
      return `${count} item(s) may be misplaced — their Miro frame could not be resolved`;
    case "arrowhead-kind":
      // Miro's ERD crow's-foot notation has no counterpart among the board's
      // arrowhead kinds, so the line keeps a head but not the right one.
      return `${count} connector end(s) with an unsupported Miro arrowhead imported as plain arrows`;
    case "connector-caption":
      // The board has no caption model, so the words survive as an ordinary
      // text element — which will not follow the connector when it moves.
      return `${count} connector label(s) imported as separate text boxes`;
    default:
      return `${count} ${kind} approximated`;
  }
}

export interface ImportSummaryInput {
  /**
   * Mapper skips — everything absent from the document. Keyed by Miro item
   * type, except for the two connector keys (`connector-free-end` and
   * `connector`), which name a drop REASON instead; see {@link describeSkip}.
   */
  skipped: Record<string, number>;
  /** Mapper approximations, keyed by degradation — present but degraded. */
  approximated?: Record<string, number>;
  /**
   * Connectors the applier refused to write because an endpoint did not remap
   * onto a real element id. The mapper guarantees both ends resolve, so this
   * should always be 0 — but a drop that reaches the document silently is the
   * failure mode this whole flow exists to prevent, so it is reported.
   */
  droppedConnectors?: number;
  /** Notes raised by the backend proxy. */
  notes: MiroImportNote[];
}

/**
 * Build the user-facing summary of everything the import did not carry over
 * faithfully: mapper skips, mapper approximations, applier drops, and every
 * backend note. Returns null only when the import was genuinely clean, which
 * is the sole case that earns a success toast.
 */
export function summarizeImport(input: ImportSummaryInput): string | null {
  const { skipped, approximated = {}, droppedConnectors = 0, notes } = input;
  const parts: string[] = [];

  // Wholesale incompleteness leads. Everything else in this summary is
  // "one detail of something you have came across wrong"; these two say "you
  // do not have all of it", which changes what the user does next. Buried at
  // the end of a semicolon-joined list — where the notes used to go, after
  // every skip and approximation — a 44% truncation read as a footnote.
  for (const note of notes) {
    if (note.reason === "truncated" || note.reason === "stalled") {
      parts.push(describeNote(note));
    }
  }

  // Item types group into one list with a single trailing "skipped"; the
  // reason-shaped keys carry their own wording and stand alone.
  const types: string[] = [];
  const reasons: string[] = [];
  for (const [type, count] of Object.entries(skipped)) {
    if (count <= 0) continue;
    const reason = describeSkip(type, count);
    if (reason) reasons.push(reason);
    else types.push(pluralizeSkipLabel(type, count));
  }
  if (types.length) parts.push(`${types.join(", ")} skipped`);
  parts.push(...reasons);
  for (const [kind, count] of Object.entries(approximated)) {
    if (count > 0) parts.push(describeApproximation(kind, count));
  }
  if (droppedConnectors > 0) {
    parts.push(
      `${pluralizeSkipLabel("connector", droppedConnectors)} dropped (endpoint did not resolve)`,
    );
  }
  for (const note of notes) {
    if (note.reason === "truncated" || note.reason === "stalled") continue;
    parts.push(describeNote(note));
  }

  return parts.length ? parts.join("; ") : null;
}

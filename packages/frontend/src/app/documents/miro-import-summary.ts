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
    case "truncated":
      return `${what} truncated at the import limit (${note.count})`;
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
    default:
      return `${count} ${kind} approximated`;
  }
}

export interface ImportSummaryInput {
  /** Mapper skips, keyed by Miro item type — absent from the document. */
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

  const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
  if (skippedTotal) {
    parts.push(
      Object.entries(skipped)
        .map(([type, count]) => pluralizeSkipLabel(type, count))
        .join(", ") + " skipped",
    );
  }
  for (const [kind, count] of Object.entries(approximated)) {
    if (count > 0) parts.push(describeApproximation(kind, count));
  }
  if (droppedConnectors > 0) {
    parts.push(
      `${pluralizeSkipLabel("connector", droppedConnectors)} dropped (endpoint did not resolve)`,
    );
  }
  for (const note of notes) {
    parts.push(describeNote(note));
  }

  return parts.length ? parts.join("; ") : null;
}

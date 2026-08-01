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
 * Build the user-facing summary of everything the import did not carry over:
 * mapper skips plus every backend note. Returns null only when the import was
 * genuinely clean, which is the sole case that earns a success toast.
 */
export function summarizeImport(
  skipped: Record<string, number>,
  notes: MiroImportNote[],
): string | null {
  const parts: string[] = [];

  const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
  if (skippedTotal) {
    parts.push(
      Object.entries(skipped)
        .map(([type, count]) => pluralizeSkipLabel(type, count))
        .join(", ") + " skipped",
    );
  }
  for (const note of notes) {
    parts.push(describeNote(note));
  }

  return parts.length ? parts.join("; ") : null;
}

import type { MiroImportProgress } from "@/api/miro";

/**
 * The label on the Import button while an import runs.
 *
 * Kept out of the component and pure for the same reason the summary wording
 * is: this text is the ONLY thing distinguishing a running import from a hung
 * one. A large board spends 30-60s in `items` alone, and the original static
 * "Reading board…" is what made a working import get reported as stuck.
 *
 * Counts are locale-formatted because the numbers get big — "1,250" reads as a
 * count, "1250" reads as an id.
 */
export function describeImportProgress(
  progress: MiroImportProgress | null,
): string {
  if (!progress) {
    // Before the first line lands there is genuinely nothing to report: the
    // request is in flight and the board id has not even been resolved yet.
    return "Reading board…";
  }

  const done = progress.done.toLocaleString();
  switch (progress.stage) {
    case "items":
      return `Reading board… ${done} items`;
    case "connectors":
      return `Reading connectors… ${done}`;
    case "images":
      // The image phase is the only one whose size is known up front, so it is
      // the only one that can show a denominator — and it is also the slowest,
      // which is exactly where a denominator is worth the most.
      return `Importing images… ${done}/${(progress.total ?? progress.done).toLocaleString()}`;
    default:
      return "Reading board…";
  }
}

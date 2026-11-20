import { getWorksheetEntries, parseRef } from "@wafflebase/sheets";
import type { Worksheet } from "@wafflebase/sheets";
import { yorkiePlain } from "@/app/board/rituals/yorkie-plain";

/**
 * The worksheet a sheet thumbnail paints, and the last row and column it has
 * to show. `null` for a sheet with nothing in it.
 *
 * `worksheet` is usually a Yorkie proxy. It is unwrapped through `toJSON()`
 * (`yorkiePlain`) like every other proxy here, so the offscreen engine reads
 * a detached copy and can never touch CRDT state outside a `doc.update`.
 *
 * The freeze pane is dropped from the copy: it is scroll behaviour, and a
 * picture never scrolls, but the engine marks it with a thick grey band
 * across the whole grid — the heaviest line in the thumbnail, under every
 * header row.
 */
export function prepareSheetThumbnail(
  worksheet: unknown,
): { worksheet: Worksheet; lastRow: number; lastCol: number } | null {
  const snapshot = yorkiePlain<Worksheet>(worksheet);
  if (!snapshot) return null;
  const plain: Worksheet = { ...snapshot, frozenRows: 0, frozenCols: 0 };

  let lastRow = 0;
  let lastCol = 0;
  for (const [sref] of getWorksheetEntries(plain)) {
    const { r, c } = parseRef(sref);
    lastRow = Math.max(lastRow, r);
    lastCol = Math.max(lastCol, c);
  }
  for (const [sref, span] of Object.entries(plain.merges ?? {})) {
    const { r, c } = parseRef(sref);
    lastRow = Math.max(lastRow, r + span.rs - 1);
    lastCol = Math.max(lastCol, c + span.cs - 1);
  }
  if (lastRow === 0 || lastCol === 0) return null;
  return { worksheet: plain, lastRow, lastCol };
}

/**
 * Wait for the engine's first paint: two animation frames (the grid, then
 * its overlay), but never longer than `timeoutMs`.
 *
 * Animation frames are not delivered to a hidden tab, and the thumbnail is
 * awaited by the Share dialog's publish action, so an unbounded wait would
 * leave a publish started and then backgrounded pending forever, with the
 * offscreen engine still mounted. The timeout lets it finish with whatever
 * has been painted.
 */
export function waitForPaint(timeoutMs = 500): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    requestAnimationFrame(() => requestAnimationFrame(finish));
  });
}

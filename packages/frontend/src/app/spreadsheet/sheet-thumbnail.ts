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
 * Resolve `true` at the engine's next completed render, or `false` after
 * `timeoutMs` without one.
 *
 * The engine's `render()` only schedules a frame, and the paint behind it is
 * async, so neither a synchronous call nor a fixed number of animation frames
 * says the grid is on the canvas; capturing early yields a blank picture. Its
 * own "render finished" signal does: `onSelectionChange` fires after every
 * completed render. `subscribe` must be called after anything that notifies
 * synchronously (a selection move), so the first notification seen here is a
 * paint.
 *
 * Frames are not delivered to a hidden tab, so a capture started there times
 * out; the caller then publishes without a picture rather than with a blank
 * one, and unmounts the engine — whose document-level listeners are live for
 * as long as it is mounted.
 */
export function waitForRender(
  subscribe: (onRendered: () => void) => () => void,
  timeoutMs = 3000,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (rendered: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(rendered);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const unsubscribe = subscribe(() => finish(true));
  });
}

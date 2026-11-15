/**
 * Wire a splitter handle (the slides thumbnail column, the notes panel) for
 * drag-to-resize.
 *
 * Pointer events rather than mouse events, so the handle works under a finger
 * or a pen as well as a mouse, and `touch-action: none` so a touch drag on it
 * resizes instead of scrolling the page. The move/up listeners sit on the
 * document so the drag continues after the pointer leaves the thin handle; a
 * `pointercancel` (the browser taking the gesture back) ends the drag the
 * same way a release does. While a drag is live the body carries the resize
 * cursor and refuses text selection.
 *
 * Returns a disposer. Disposing mid-drag ends the drag (so `onEnd` still
 * persists the size) and restores the body styles.
 */
export function attachPanelResizer(
  handle: HTMLElement,
  {
    cursor,
    onStart,
    onMove,
    onEnd,
  }: {
    cursor: "col-resize" | "row-resize";
    onStart: (e: PointerEvent) => void;
    onMove: (e: PointerEvent) => void;
    onEnd: () => void;
  },
): () => void {
  let active = false;

  const end = () => {
    if (!active) return;
    active = false;
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", end);
    document.removeEventListener("pointercancel", end);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    onEnd();
  };
  const move = (e: PointerEvent) => {
    if (active) onMove(e);
  };
  const down = (e: PointerEvent) => {
    // A secondary button (right-click, pen barrel) is not a drag.
    if (e.button !== 0) return;
    e.preventDefault();
    active = true;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    onStart(e);
  };

  handle.style.touchAction = "none";
  handle.addEventListener("pointerdown", down);
  return () => {
    handle.removeEventListener("pointerdown", down);
    end();
  };
}

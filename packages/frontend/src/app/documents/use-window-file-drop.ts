import { useEffect, useState } from "react";

/**
 * Whole-window file drag-and-drop (Google-Drive-style).
 *
 * Returns whether a file drag is currently over the window (drive a drop
 * overlay with it) and installs window-level listeners that:
 * - `preventDefault` file drags anywhere so a stray drop never navigates the
 *   tab to the raw file (which would destroy SPA state + in-flight uploads);
 * - deliver a dropped batch to `onFiles`.
 *
 * A depth counter tracks dragenter/dragleave across nested children so the
 * overlay doesn't flicker as the pointer crosses element boundaries. Because
 * some browsers fire no `dragleave` when a drag is cancelled (ESC, pointer
 * leaves the window), the overlay is also force-reset on `dragend`, window
 * `blur`, and the Escape key.
 *
 * `onFiles` should be stable (wrap in `useCallback`) — it is an effect dep, so
 * an unstable identity re-binds the listeners on every render.
 */
export function useWindowFileDrop(onFiles: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const isFileDrag = (e: DragEvent) =>
      !!e.dataTransfer?.types?.includes("Files");
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const reset = () => {
      depth = 0;
      setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      reset();
      onFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") reset();
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onFiles]);

  return dragging;
}

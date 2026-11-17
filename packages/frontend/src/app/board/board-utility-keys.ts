import type { SlidesEditor } from "@wafflebase/slides";
import { isTextEntryTarget } from "./board-shortcuts";

type KeyLike = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

/** Mod+F. Matched on `code` too, for layouts that do not put F on `f`. */
export function isFindChord(e: KeyLike): boolean {
  return (
    (e.metaKey || e.ctrlKey) &&
    !e.altKey &&
    !e.shiftKey &&
    (e.key.toLowerCase() === "f" || e.code === "KeyF")
  );
}

/**
 * Alt+Shift+T, FigJam's Tidy up. Matched on `code`: on a Mac, Option
 * turns the produced `key` into a symbol (`ˇ`).
 */
export function isTidyUpChord(e: KeyLike): boolean {
  return e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === "KeyT";
}

export interface BoardUtilityKeyContext {
  editor: Pick<SlidesEditor, "isTextEditing" | "exitTextEditing" | "getSelection">;
  readOnly: boolean;
  /** Same contract as `BoardToolKeyContext.isBoardTarget`. */
  isBoardTarget: (target: EventTarget | null) => boolean;
  openFind: () => void;
  tidyUp: () => void;
}

/**
 * The board's document-level keydown for its utilities: Mod+F (find on
 * board) and Alt+Shift+T (tidy up the selection). Registered in the
 * capture phase next to `handleBoardToolKey`, and for the same reason it
 * `stopPropagation()`s what it takes: the slides editor ignores
 * `defaultPrevented`.
 *
 * Mod+F replaces the browser's find only when the keystroke belongs to
 * the board — the canvas, its toolbar, its find box, or no focused element.
 * It works on a read-only board and during a sticky edit (which it ends, so
 * the caret does not keep typing behind the find box). Tidy up needs an
 * editable board, at least two selected elements, and no text entry.
 */
export function handleBoardUtilityKey(
  e: KeyboardEvent,
  ctx: BoardUtilityKeyContext,
): boolean {
  if (e.defaultPrevented) return false;
  if (!ctx.isBoardTarget(e.target)) return false;
  if (isFindChord(e)) {
    e.preventDefault();
    e.stopPropagation();
    if (ctx.editor.isTextEditing()) ctx.editor.exitTextEditing();
    ctx.openFind();
    return true;
  }
  if (isTidyUpChord(e)) {
    if (ctx.readOnly || e.repeat) return false;
    if (isTextEntryTarget(e.target) || ctx.editor.isTextEditing()) return false;
    if (ctx.editor.getSelection().length < 2) return false;
    e.preventDefault();
    e.stopPropagation();
    ctx.tidyUp();
    return true;
  }
  return false;
}

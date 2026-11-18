import type { Element, Frame, SlidesEditor, SlidesStore } from "@wafflebase/slides";
import {
  SYNTHETIC_SLIDE_ID,
  findFreeRect,
  isSectionElement,
  type StickyDataExtras,
  type Viewport,
} from "@wafflebase/board";
import {
  DEFAULT_STICKY_SIZE,
  STICKY_COLORS,
  STICKY_GAP,
  adjacentStickyCenter,
  buildStickyInit,
  freeStickyCenter,
  isStickyElement,
  placeSticky,
  visibleWorldRect,
  type StickyDirection,
} from "./sticky";
import { isTextEntryTarget } from "./board-shortcuts";
import {
  layoutPastedStickies,
  parsePastedCells,
  stickyTextFromClipboard,
} from "./sticky-paste";
import { createStickyPlusHandles } from "./sticky-plus-handles";

/** What the sticky-first flow needs from the board. */
export interface StickyFlowContext {
  store: SlidesStore;
  editor: SlidesEditor;
  /** Top-level elements of the board, read live. */
  readElements: () => readonly Element[];
  /** The on-screen world rect, read live. */
  visible: () => Frame;
  /** Bring an off-screen world box into view. */
  reveal: (box: Frame) => void;
  /** Display name to record on a new sticky; `undefined` records none. */
  author: () => string | undefined;
}

/**
 * What a new sticky steps off: every top-level frame but a section's. A
 * section is a container, not an obstacle (the `S` key's rule, see
 * `readStickyObstacles` in `board-view.tsx`); counting it would push a
 * sticky added inside one out past its edge.
 */
function stickyObstacles(elements: readonly Element[]): Frame[] {
  return elements.filter((e) => !isSectionElement(e)).map((e) => e.frame);
}

/** The first inline font size in a sticky's text body, if any. */
function bodyFontSize(el: Element): number | undefined {
  if (el.type !== "shape") return undefined;
  for (const block of el.data.text?.blocks ?? []) {
    for (const inline of block.inlines) {
      if (typeof inline.style?.fontSize === "number") return inline.style.fontSize;
    }
  }
  return undefined;
}

/**
 * Add a sticky next to the sticky `sourceId` on its `direction` side
 * (FigJam's Mod+Enter / Tab / "+" handle): same colour, size, text size
 * and author-tag setting, at {@link adjacentStickyCenter}, selected and in
 * text edit. Returns the new id, or `null` when the source is not a
 * sticky. One batch, so one undo removes it.
 */
export function addAdjacentSticky(
  ctx: StickyFlowContext,
  sourceId: string,
  direction: StickyDirection,
): string | null {
  const elements = ctx.readElements();
  const source = elements.find((e) => e.id === sourceId);
  if (!source || source.type !== "shape" || !isStickyElement(source)) return null;
  const fill = source.data.fill;
  const colorValue =
    fill && "kind" in fill && fill.kind === "srgb" ? fill.value : STICKY_COLORS[0].value;
  const visible = ctx.visible();
  const center = adjacentStickyCenter(
    stickyObstacles(elements),
    source.frame,
    direction,
    visible,
  );
  const extras = source.data as StickyDataExtras;
  return placeSticky({
    store: ctx.store,
    editor: ctx.editor,
    center,
    colorValue,
    options: {
      size: { w: source.frame.w, h: source.frame.h },
      author: ctx.author(),
      fontSize: bodyFontSize(source),
      showAuthor: extras.showAuthor,
    },
    visible,
    reveal: ctx.reveal,
  });
}

/**
 * Turn pasted plain text into stickies on free space nearest the viewport
 * centre (see `parsePastedCells`): one batch, all selected, none in text edit. A
 * single line becomes one sticky on the nearest free spot instead.
 * Returns the new ids and how many cells were dropped over the cap.
 */
export function pasteTextAsStickies(
  ctx: StickyFlowContext,
  text: string,
): { ids: string[]; dropped: number } {
  const grid = parsePastedCells(text);
  const visible = ctx.visible();
  const center = { x: visible.x + visible.w / 2, y: visible.y + visible.h / 2 };
  const cellCount = grid.reduce((n, row) => n + row.filter((c) => c !== "").length, 0);
  if (cellCount === 0) return { ids: [], dropped: 0 };
  const placed =
    cellCount === 1
      ? {
          stickies: [
            {
              text: grid.flat().find((c) => c !== "")!,
              center: freeStickyCenter(
                stickyObstacles(ctx.readElements()),
                center,
                visible,
              ),
            },
          ],
          dropped: 0,
        }
      : layoutInFreeSpace(
          ctx,
          layoutPastedStickies(grid, center, DEFAULT_STICKY_SIZE, STICKY_GAP),
          visible,
        );
  const author = ctx.author();
  const ids: string[] = [];
  ctx.store.batch(() => {
    for (const s of placed.stickies) {
      ids.push(
        ctx.store.addElement(
          SYNTHETIC_SLIDE_ID,
          buildStickyInit(STICKY_COLORS[0].value, s.center, { text: s.text, author }),
        ),
      );
    }
  });
  ctx.editor.setSelection(ids);
  return { ids, dropped: placed.dropped };
}

/**
 * Move a pasted grid, as one block, to the nearest spot around the
 * viewport centre where it covers nothing (`findFreeRect`, the search the
 * agent's batch placement runs), and bring it into view if that spot is
 * off screen. Dropped on the centre as is, a paste lands on top of the
 * stickies already there.
 */
function layoutInFreeSpace(
  ctx: StickyFlowContext,
  placed: ReturnType<typeof layoutPastedStickies>,
  visible: Frame,
): ReturnType<typeof layoutPastedStickies> {
  if (placed.stickies.length === 0) return placed;
  const { w, h } = DEFAULT_STICKY_SIZE;
  const xs = placed.stickies.map((s) => s.center.x);
  const ys = placed.stickies.map((s) => s.center.y);
  const left = Math.min(...xs) - w / 2;
  const top = Math.min(...ys) - h / 2;
  const size = { w: Math.max(...xs) + w / 2 - left, h: Math.max(...ys) + h / 2 - top };
  const at = findFreeRect(
    stickyObstacles(ctx.readElements()),
    size,
    { x: left, y: top },
    STICKY_GAP,
  );
  const dx = at.x - left;
  const dy = at.y - top;
  const box: Frame = { x: at.x, y: at.y, w: size.w, h: size.h, rotation: 0 };
  const onScreen =
    box.x >= visible.x &&
    box.y >= visible.y &&
    box.x + box.w <= visible.x + visible.w &&
    box.y + box.h <= visible.y + visible.h;
  if (!onScreen) ctx.reveal(box);
  return {
    stickies: placed.stickies.map((s) => ({
      text: s.text,
      center: { x: s.center.x + dx, y: s.center.y + dy },
    })),
    dropped: placed.dropped,
  };
}

/** What {@link handleStickyFlowKey} needs. */
export interface StickyFlowKeyContext {
  editor: Pick<
    SlidesEditor,
    "getEditingElementId" | "getSelection" | "isCropping" | "exitTextEditing"
  >;
  readOnly: boolean;
  isSticky: (id: string) => boolean;
  isBoardTarget: (target: EventTarget | null) => boolean;
  addAdjacent: (sourceId: string, direction: StickyDirection) => void;
}

function isModEnter(e: KeyboardEvent): boolean {
  return e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;
}

function isPlainTab(e: KeyboardEvent): boolean {
  return e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
}

/**
 * The board's sticky keys, FigJam's brainstorming loop:
 *
 * - **Mod+Enter** on exactly one selected sticky adds a sticky to its
 *   right and starts typing in it.
 * - **Mod+Enter** or **Tab** while typing in a sticky commits it and does
 *   the same, so a run of ideas never leaves the keyboard.
 *
 * Registered in the capture phase, like `handleBoardToolKey`, and stops
 * propagation of what it takes: in a text edit the docs editor would
 * otherwise read Mod+Enter as a page break and Tab as an indent. An IME
 * composition passes through (Enter there confirms the candidate), as do
 * keys outside the board and a read-only mount. Slides never registers
 * this, so its Mod+Enter (present) and Tab (cycle elements) are unchanged.
 */
export function handleStickyFlowKey(e: KeyboardEvent, ctx: StickyFlowKeyContext): boolean {
  if (e.defaultPrevented || ctx.readOnly) return false;
  if (e.isComposing || e.keyCode === 229) return false;
  if (!ctx.isBoardTarget(e.target)) return false;
  const editing = ctx.editor.getEditingElementId();
  if (editing !== null) {
    if (!(isModEnter(e) || isPlainTab(e)) || !ctx.isSticky(editing)) return false;
    e.preventDefault();
    e.stopPropagation();
    ctx.editor.exitTextEditing();
    ctx.addAdjacent(editing, "right");
    return true;
  }
  if (!isModEnter(e) || e.repeat) return false;
  if (isTextEntryTarget(e.target) || ctx.editor.isCropping()) return false;
  const selection = ctx.editor.getSelection();
  if (selection.length !== 1 || !ctx.isSticky(selection[0])) return false;
  e.preventDefault();
  e.stopPropagation();
  ctx.addAdjacent(selection[0], "right");
  return true;
}

/**
 * True when something other than the bare board owns a paste: a focused
 * field, or an open dialog. Mirrors the image paste path's rule.
 */
function pasteOwnedElsewhere(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable) return true;
  return el.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"]') !== null;
}

export interface AttachStickyFlowDeps {
  container: HTMLElement;
  store: SlidesStore;
  editor: SlidesEditor;
  readOnly: boolean;
  getViewport: () => Viewport;
  getHostSize: () => { w: number; h: number };
  reveal: (box: Frame) => void;
  author: () => string | undefined;
  isBoardTarget: (target: EventTarget | null) => boolean;
  /** Told how many pasted cells were dropped over the cap. */
  onPasteTruncated?: (dropped: number) => void;
}

/**
 * Install the sticky-first flow on a board mount: the sticky keys
 * ({@link handleStickyFlowKey}), plain-text paste as stickies, and the
 * "+" handles around a selected sticky. Returns `refresh` (call it when
 * the viewport moves, so the handles follow) and `dispose`.
 *
 * A read-only mount gets nothing: every piece of it creates stickies.
 */
export function attachStickyFlow(deps: AttachStickyFlowDeps): {
  refresh: () => void;
  dispose: () => void;
} {
  if (deps.readOnly) return { refresh: () => {}, dispose: () => {} };
  const { store, editor } = deps;
  const readElements = (): readonly Element[] => store.read().slides[0]?.elements ?? [];
  const ctx: StickyFlowContext = {
    store,
    editor,
    readElements,
    visible: () => {
      const { w, h } = deps.getHostSize();
      return visibleWorldRect(deps.getViewport(), w, h);
    },
    reveal: deps.reveal,
    author: deps.author,
  };
  const isSticky = (id: string) => isStickyElement(readElements().find((e) => e.id === id));

  const onKeyDown = (e: KeyboardEvent) => {
    handleStickyFlowKey(e, {
      editor,
      readOnly: false,
      isSticky,
      isBoardTarget: deps.isBoardTarget,
      addAdjacent: (id, dir) => addAdjacentSticky(ctx, id, dir),
    });
  };

  // Plain text pasted on the board becomes stickies. The editor's own
  // Cmd+V rule only understands its element clipboard, and an image has
  // its own path; `stickyTextFromClipboard` leaves both to them.
  const onPaste = (e: ClipboardEvent) => {
    if (editor.getEditingElementId() !== null) return;
    if (pasteOwnedElsewhere()) return;
    const text = stickyTextFromClipboard(e.clipboardData);
    if (text === null) return;
    e.preventDefault();
    const { dropped } = pasteTextAsStickies(ctx, text);
    if (dropped > 0) deps.onPasteTruncated?.(dropped);
  };

  const handles = createStickyPlusHandles({
    container: deps.container,
    editor,
    getViewport: deps.getViewport,
    readElement: (id) => readElements().find((e) => e.id === id),
    isSticky: (el) => isStickyElement(el),
    onAdd: (id, dir) => {
      addAdjacentSticky(ctx, id, dir);
    },
  });
  const offChange = store.onChange?.(() => handles.update()) ?? (() => {});

  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("paste", onPaste);
  return {
    refresh: () => handles.update(),
    dispose: () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("paste", onPaste);
      offChange();
      handles.dispose();
    },
  };
}

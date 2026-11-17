import type { Element, Frame, SlidesEditor } from "@wafflebase/slides";
import { worldToScreen, type Viewport } from "@wafflebase/board";
import type { StickyDirection } from "./sticky";

/** Screen px from a sticky's edge to the centre of its "+" handle. */
export const PLUS_HANDLE_OFFSET = 22;

/** Diameter of a "+" handle, in screen px. */
const PLUS_HANDLE_SIZE = 22;

export const PLUS_DIRECTIONS: readonly StickyDirection[] = ["right", "down", "left", "up"];

const LABELS: Record<StickyDirection, string> = {
  right: "Add sticky note to the right",
  left: "Add sticky note to the left",
  down: "Add sticky note below",
  up: "Add sticky note above",
};

/**
 * Screen-space centres of the four "+" handles around `frame` (world)
 * under `viewport`: the middle of each side, {@link PLUS_HANDLE_OFFSET}
 * px out. Rotation is ignored, as the placement of the new sticky does.
 */
export function plusHandleCenters(
  frame: Frame,
  viewport: Viewport,
  offset = PLUS_HANDLE_OFFSET,
): Record<StickyDirection, { x: number; y: number }> {
  const tl = worldToScreen(viewport, { x: frame.x, y: frame.y });
  const br = worldToScreen(viewport, { x: frame.x + frame.w, y: frame.y + frame.h });
  const cx = (tl.x + br.x) / 2;
  const cy = (tl.y + br.y) / 2;
  return {
    right: { x: br.x + offset, y: cy },
    left: { x: tl.x - offset, y: cy },
    down: { x: cx, y: br.y + offset },
    up: { x: cx, y: tl.y - offset },
  };
}

export interface StickyPlusHandlesDeps {
  /** The board's canvas host; the handle layer is appended to it. */
  container: HTMLElement;
  editor: Pick<
    SlidesEditor,
    "getSelection" | "isTextEditing" | "onSelectionChange" | "onTextEditingChange"
  >;
  getViewport: () => Viewport;
  readElement: (id: string) => Element | undefined;
  isSticky: (el: Element) => boolean;
  onAdd: (id: string, direction: StickyDirection) => void;
}

/**
 * FigJam's "+" handles: one on each side of a single selected sticky
 * (not while typing in it, not mid-drag). A click adds a sticky on that
 * side — see `addAdjacentSticky`.
 *
 * A board-local DOM layer over the canvas rather than part of the slides
 * selection overlay, which slides repaints on its own schedule and knows
 * nothing about stickies. `update()` must run whenever the selection, the
 * sticky's frame or the viewport changes; the first two are subscribed
 * here, the viewport is the host's to report.
 */
export function createStickyPlusHandles(deps: StickyPlusHandlesDeps): {
  update: () => void;
  dispose: () => void;
  /** The layer element, for tests. */
  element: HTMLDivElement;
} {
  const layer = document.createElement("div");
  layer.dataset.stickyPlusHandles = "";
  Object.assign(layer.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    overflow: "hidden",
    display: "none",
  });

  let targetId: string | null = null;
  const buttons = new Map<StickyDirection, HTMLButtonElement>();
  for (const dir of PLUS_DIRECTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.tabIndex = -1;
    b.textContent = "+";
    b.setAttribute("aria-label", LABELS[dir]);
    b.title = LABELS[dir];
    b.dataset.direction = dir;
    Object.assign(b.style, {
      position: "absolute",
      width: `${PLUS_HANDLE_SIZE}px`,
      height: `${PLUS_HANDLE_SIZE}px`,
      marginLeft: `${-PLUS_HANDLE_SIZE / 2}px`,
      marginTop: `${-PLUS_HANDLE_SIZE / 2}px`,
      borderRadius: "9999px",
      border: "1px solid rgba(0, 0, 0, 0.15)",
      background: "#ffffff",
      color: "#3f3f46",
      font: "500 15px/1 Inter, system-ui, sans-serif",
      padding: "0",
      cursor: "pointer",
      pointerEvents: "auto",
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.15)",
    });
    // Keep the press from the board: the editor would read it as a click
    // on empty canvas and drop the selection the handle belongs to.
    b.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (targetId !== null) deps.onAdd(targetId, dir);
    });
    buttons.set(dir, b);
    layer.appendChild(b);
  }
  deps.container.appendChild(layer);

  // Hidden while a press on the board is down: a drag moves the sticky
  // through a ghost and only commits on release.
  let pressing = false;

  const hide = () => {
    targetId = null;
    layer.style.display = "none";
  };

  const update = () => {
    const selection = deps.editor.getSelection();
    if (pressing || selection.length !== 1 || deps.editor.isTextEditing()) {
      hide();
      return;
    }
    const el = deps.readElement(selection[0]);
    if (!el || !deps.isSticky(el)) {
      hide();
      return;
    }
    targetId = el.id;
    const centers = plusHandleCenters(el.frame, deps.getViewport());
    for (const [dir, b] of buttons) {
      b.style.left = `${centers[dir].x}px`;
      b.style.top = `${centers[dir].y}px`;
    }
    layer.style.display = "block";
  };

  const onPressStart = (e: PointerEvent) => {
    if (e.target instanceof Node && layer.contains(e.target)) return;
    pressing = true;
    hide();
  };
  const onPressEnd = () => {
    if (!pressing) return;
    pressing = false;
    update();
  };
  deps.container.addEventListener("pointerdown", onPressStart, true);
  document.addEventListener("pointerup", onPressEnd);
  document.addEventListener("pointercancel", onPressEnd);
  const offSelection = deps.editor.onSelectionChange(update);
  const offEditing = deps.editor.onTextEditingChange(update);
  update();

  return {
    update,
    element: layer,
    dispose: () => {
      deps.container.removeEventListener("pointerdown", onPressStart, true);
      document.removeEventListener("pointerup", onPressEnd);
      document.removeEventListener("pointercancel", onPressEnd);
      offSelection();
      offEditing();
      layer.remove();
    },
  };
}

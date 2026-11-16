/**
 * The board's hand (drag-to-pan) tool state.
 *
 * Board-local rather than a slides `InsertKind`: the hand inserts
 * nothing, and the slides editor has no notion of a pan tool. Held in a
 * ref by `BoardView` so it survives mount-effect re-runs, and shared
 * with `BoardToolbar` so the toggle and the `H` key agree.
 */
export interface HandTool {
  get(): boolean;
  set(on: boolean): void;
  subscribe(cb: () => void): () => void;
}

export function createHandTool(): HandTool {
  let on = false;
  const listeners = new Set<() => void>();
  return {
    get: () => on,
    set: (next) => {
      if (next === on) return;
      on = next;
      for (const cb of listeners) cb();
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/**
 * The pan cursor a board host shows, written as `data-board-pan` on the
 * container and enforced by {@link BOARD_PAN_CURSOR_CSS}.
 *
 * An attribute + `!important` rule rather than `canvas.style.cursor`
 * because the slides editor rewrites the canvas's inline cursor on every
 * hover (`move` over a selection, a resize cursor near an edge), which
 * used to clobber Space's `grab` the moment the pointer moved.
 */
export type PanCursor = "grab" | "grabbing" | null;

export function panCursor(state: {
  panning: boolean;
  spaceDown: boolean;
  hand: boolean;
  readOnly: boolean;
}): PanCursor {
  if (state.panning) return "grabbing";
  if (state.spaceDown || state.hand || state.readOnly) return "grab";
  return null;
}

export const BOARD_PAN_CURSOR_CSS = `
[data-board-pan="grab"], [data-board-pan="grab"] * { cursor: grab !important; }
[data-board-pan="grabbing"], [data-board-pan="grabbing"] * { cursor: grabbing !important; }
`;

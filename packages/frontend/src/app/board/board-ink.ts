import type { InsertKind, SlidesEditor, Stroke } from "@wafflebase/slides";

/**
 * The board's ink tools: marker, highlighter and eraser.
 *
 * Drawing runs on the slides editor's freehand pipeline (`'freeform'`
 * insert kind) and the stroke eraser (`'eraser'`); what is board-local is
 * the pen the user picked — which ink, which colour, how wide — chosen
 * before drawing, as in FigJam, and remembered per browser. The editor
 * reads it through `getInkStroke` at the start of each stroke.
 */

export type InkPen = "marker" | "highlighter";
export type InkWidth = "thin" | "medium" | "thick";

/** Eight ink colours, black first (the marker default). */
export const INK_COLORS = [
  { name: "Black", value: "#1E1E1E" },
  { name: "Gray", value: "#8F8F8F" },
  { name: "Red", value: "#E5484D" },
  { name: "Orange", value: "#F76B15" },
  { name: "Yellow", value: "#FFC53D" },
  { name: "Green", value: "#30A46C" },
  { name: "Blue", value: "#0090FF" },
  { name: "Purple", value: "#8E4EC6" },
] as const;

/** World-px stroke widths per pen. A highlighter is wide by nature. */
export const INK_WIDTHS: Readonly<Record<InkPen, Record<InkWidth, number>>> = {
  marker: { thin: 2, medium: 4, thick: 8 },
  highlighter: { thin: 12, medium: 20, thick: 32 },
};

/** Key hints shown in the ink tooltips (the keys live in `board-shortcuts.ts`). */
export const INK_HINTS = {
  marker: "M",
  highlighter: "Shift+M",
  eraser: "Shift+E",
} as const;

/** Highlighter opacity: translucent enough to read the text beneath. */
export const HIGHLIGHTER_ALPHA = 0.35;

export interface InkPenStyle {
  color: string;
  width: InkWidth;
}

export interface InkState {
  /** Which pen `'freeform'` draws with. */
  pen: InkPen;
  marker: InkPenStyle;
  highlighter: InkPenStyle;
}

export const DEFAULT_INK_STATE: InkState = {
  pen: "marker",
  marker: { color: INK_COLORS[0].value, width: "medium" },
  highlighter: { color: "#FFC53D", width: "medium" },
};

const STORAGE_KEY = "wafflebase.board.ink";

const WIDTH_NAMES: readonly InkWidth[] = ["thin", "medium", "thick"];

function readPenStyle(raw: unknown, fallback: InkPenStyle): InkPenStyle {
  if (typeof raw !== "object" || raw === null) return fallback;
  const r = raw as Record<string, unknown>;
  const color =
    typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color)
      ? r.color
      : fallback.color;
  const width = WIDTH_NAMES.includes(r.width as InkWidth)
    ? (r.width as InkWidth)
    : fallback.width;
  return { color, width };
}

/** Parse a stored ink choice, falling back field by field. */
export function parseInkState(json: string | null): InkState {
  if (!json) return DEFAULT_INK_STATE;
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    return {
      pen: raw.pen === "highlighter" ? "highlighter" : "marker",
      marker: readPenStyle(raw.marker, DEFAULT_INK_STATE.marker),
      highlighter: readPenStyle(raw.highlighter, DEFAULT_INK_STATE.highlighter),
    };
  } catch {
    return DEFAULT_INK_STATE;
  }
}

function loadInkState(): InkState {
  try {
    return parseInkState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_INK_STATE;
  }
}

function saveInkState(state: InkState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode / blocked storage: the choice lasts this session only.
  }
}

/** The stored stroke a pen draws with. */
export function inkStroke(state: InkState): Stroke {
  const pen = state.pen;
  const style = state[pen];
  return {
    color:
      pen === "highlighter"
        ? { kind: "srgb", value: style.color, alpha: HIGHLIGHTER_ALPHA }
        : { kind: "srgb", value: style.color },
    width: INK_WIDTHS[pen][style.width],
    cap: "round",
  };
}

/**
 * The pen choice, shared by the toolbar's Marker control, the `M` /
 * `Shift+M` keys and the editor's `getInkStroke`. Ref-held by `BoardView`
 * like the hand tool, so it survives mount-effect re-runs.
 */
export interface InkTool {
  get(): InkState;
  setPen(pen: InkPen): void;
  setStyle(pen: InkPen, patch: Partial<InkPenStyle>): void;
  subscribe(cb: () => void): () => void;
}

export function createInkTool(initial: InkState = loadInkState()): InkTool {
  let state = initial;
  const listeners = new Set<() => void>();
  const update = (next: InkState): void => {
    state = next;
    saveInkState(state);
    for (const cb of listeners) cb();
  };
  return {
    get: () => state,
    setPen: (pen) => {
      if (pen !== state.pen) update({ ...state, pen });
    },
    setStyle: (pen, patch) => update({ ...state, [pen]: { ...state[pen], ...patch } }),
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/** Insert kinds that stay armed on the board (`stickyInsertKinds`). */
export const BOARD_STICKY_INSERT_KINDS: readonly InsertKind[] = ["freeform", "eraser"];

/** Arm a pen: pick it, then put the editor in freehand mode. */
export function armInkPen(
  editor: Pick<SlidesEditor, "setInsertMode">,
  ink: InkTool,
  pen: InkPen,
): void {
  ink.setPen(pen);
  editor.setInsertMode("freeform");
}

/**
 * Whether a draw / erase tool is armed, so a single finger on empty
 * canvas draws instead of panning (`board-touch-gestures.ts`).
 */
export function isInkArmed(kind: InsertKind | null): boolean {
  return kind === "freeform" || kind === "eraser";
}

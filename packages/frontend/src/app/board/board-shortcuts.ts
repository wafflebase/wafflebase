import type { InsertKind, SlidesEditor } from "@wafflebase/slides";
import type { ShortcutItem } from "@/components/shortcuts-help-dialog";

/**
 * What a single-key tool shortcut does: arm an editor insert mode, return
 * to select, or drop a sticky (stickies are board-local, not an
 * `InsertKind` — see `sticky.ts`).
 */
export type BoardTool =
  | { kind: "select" }
  | { kind: "hand" }
  | { kind: "sticky" }
  | { kind: "section" }
  | { kind: "insert"; insert: InsertKind };

/**
 * FigJam's single-key tools, which is what a board user's hands already
 * know: V select, H hand, T text, S sticky, R rectangle, O ellipse,
 * L line, Shift+L arrow, X connector, Shift+S section.
 */
const TOOL_KEYS: Readonly<Record<string, BoardTool>> = {
  v: { kind: "select" },
  h: { kind: "hand" },
  t: { kind: "insert", insert: "text" },
  s: { kind: "sticky" },
  r: { kind: "insert", insert: "rect" },
  o: { kind: "insert", insert: "ellipse" },
  l: { kind: "insert", insert: "connector:line" },
  L: { kind: "insert", insert: "connector:arrow" },
  x: { kind: "insert", insert: "connector:elbow" },
  S: { kind: "section" },
};

/**
 * The tool a keystroke selects, or `null` when it is not a tool key.
 *
 * Any modifier other than Shift disqualifies it, so `Mod+S` / `Mod+V`
 * keep their meaning, and only Shift+L is a shifted tool. The caller owns
 * the context gate (no text edit, no focused field, nothing selected) —
 * see `board-view.tsx`.
 */
export function boardToolForKey(e: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): BoardTool | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const key = e.shiftKey ? e.key.toUpperCase() : e.key.toLowerCase();
  if (e.shiftKey && key !== "L" && key !== "S") return null;
  return TOOL_KEYS[key] ?? null;
}

/** Tool-key hints shown in the toolbar tooltips. */
export const TOOL_HINTS = {
  select: "V",
  hand: "H",
  text: "T",
  sticky: "S",
  section: "Shift+S",
} as const;

export const BOARD_SHORTCUT_CATEGORIES = [
  "Tools",
  "Sticky notes",
  "Canvas",
  "Selection",
  "Clipboard",
  "Arrange",
  "Text",
  "Help",
] as const;

/**
 * The board's shortcut sheet (Mod+/).
 *
 * Its own list rather than a filter over the slides catalog: half of that
 * catalog speaks of "the current slide", and the board adds tools and
 * canvas navigation the slides one has no words for. Entries below the
 * Tools / Canvas groups are the slides editor's own key rules, which the
 * board inherits unchanged.
 */
export const BOARD_SHORTCUTS: ReadonlyArray<ShortcutItem> = [
  { category: "Tools", keys: ["V", "Esc"], description: "Select" },
  { category: "Tools", keys: ["H"], description: "Hand (drag to pan)" },
  { category: "Tools", keys: ["T"], description: "Text box" },
  { category: "Tools", keys: ["S"], description: "Sticky note" },
  { category: "Tools", keys: ["Shift+S"], description: "Section (drag, or click for a default size)" },
  { category: "Tools", keys: ["R"], description: "Rectangle" },
  { category: "Tools", keys: ["O"], description: "Ellipse" },
  { category: "Tools", keys: ["L"], description: "Line" },
  { category: "Tools", keys: ["Shift+L"], description: "Arrow" },
  { category: "Tools", keys: ["X"], description: "Connector" },
  { category: "Tools", keys: ["Mod+Alt+M"], description: "Comment (on the selection, or click to place)" },

  { category: "Sticky notes", keys: ["Mod+Enter"], description: "Add a sticky next to the selected one" },
  { category: "Sticky notes", keys: ["Tab", "Mod+Enter"], description: "While typing: finish and start the next sticky" },
  { category: "Sticky notes", keys: ["Mod+V"], description: "Paste text: one sticky per line or cell" },

  { category: "Canvas", keys: ["Space"], description: "Pan (hold, then drag)" },
  { category: "Canvas", keys: ["Mod"], description: "Zoom (hold, then scroll or pinch)" },
  { category: "Canvas", keys: ["Shift"], description: "Pan sideways (hold, then scroll)" },
  { category: "Canvas", keys: ["Mod+=", "Mod+-"], description: "Zoom in / out" },
  { category: "Canvas", keys: ["Mod+0"], description: "Zoom to 100%" },
  { category: "Canvas", keys: ["Shift+1"], description: "Zoom to fit" },
  { category: "Canvas", keys: ["Shift+2"], description: "Zoom to selection" },

  { category: "Selection", keys: ["Mod+A"], description: "Select everything" },
  { category: "Selection", keys: ["Esc"], description: "Finish editing text; clear selection" },
  { category: "Selection", keys: ["Enter", "F2"], description: "Edit the selected sticky, shape or text" },
  { category: "Selection", keys: ["Delete", "Backspace"], description: "Delete" },
  { category: "Selection", keys: ["Arrow ←/→/↑/↓"], description: "Nudge 1 px (Shift: 10 px)" },
  { category: "Selection", keys: ["Mod+Alt+G"], description: "Group" },
  { category: "Selection", keys: ["Mod+Shift+Alt+G"], description: "Ungroup" },

  { category: "Clipboard", keys: ["Mod+C"], description: "Copy" },
  { category: "Clipboard", keys: ["Mod+X"], description: "Cut" },
  { category: "Clipboard", keys: ["Mod+V"], description: "Paste" },
  { category: "Clipboard", keys: ["Mod+D"], description: "Duplicate" },

  { category: "Arrange", keys: ["Mod+↑", "Mod+↓"], description: "Bring forward / send backward" },
  { category: "Arrange", keys: ["Mod+Shift+↑", "Mod+Shift+↓"], description: "Bring to front / send to back" },

  { category: "Text", keys: ["Mod+B"], description: "Bold" },
  { category: "Text", keys: ["Mod+I"], description: "Italic" },
  { category: "Text", keys: ["Mod+U"], description: "Underline" },
  { category: "Text", keys: ["Mod+K"], description: "Insert link" },

  { category: "Help", keys: ["Mod+Z"], description: "Undo" },
  { category: "Help", keys: ["Mod+Shift+Z"], description: "Redo" },
  { category: "Help", keys: ["Mod+/"], description: "Show keyboard shortcuts" },
];

/**
 * Whether a keystroke aimed at `target` belongs to that element rather
 * than to the board's tool keys: a text field, an open menu (whose
 * letters drive type-ahead), or a dialog — a letter typed over a modal,
 * a confirm included, must not mutate the board behind it.
 *
 * Deliberately narrower than `isEditableTarget`, which also claims a
 * focused button so Space re-activates it. A letter does nothing to a
 * button, and focus stays on a toolbar toggle after it is clicked — so
 * honouring buttons here would make V / T / S dead right after the user
 * touched the toolbar.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((target as HTMLElement).isContentEditable) return true;
  return (
    target.closest(
      '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]',
    ) !== null
  );
}

/** What {@link handleBoardToolKey} needs from the board. */
export interface BoardToolKeyContext {
  editor: Pick<
    SlidesEditor,
    "isTextEditing" | "isCropping" | "getSelection" | "setInsertMode"
  >;
  readOnly: boolean;
  fit: () => void;
  /** Step the zoom to the next preset in `direction`, about the host centre. */
  zoomStep: (direction: 1 | -1) => void;
  /** Zoom to an absolute scale (Mod+0 → 1), about the host centre. */
  zoomTo: (zoom: number) => void;
  /** Frame the current selection (Shift+2); a no-op with nothing selected. */
  fitSelection: () => void;
  /** Arm or disarm the hand (drag-to-pan) tool. */
  setHand: (on: boolean) => void;
  dropSticky: () => void;
  /** Arm or disarm the section tool (Shift+S). Omitted: no section tool. */
  setSection?: (on: boolean) => void;
  /**
   * Whether the keystroke's target belongs to the board: its canvas,
   * toolbar, or no focused element at all (`document.body`). The handler
   * is document-level, so without this a letter typed while focus sits in
   * sibling chrome — the history panel, the sidebar, a header button —
   * would change the board.
   */
  isBoardTarget: (target: EventTarget | null) => boolean;
}

/**
 * The view action a zoom chord (`Mod+=`, `Mod++`, `Mod+-`, `Mod+0`) asks
 * for, or `null`. Matched on `code` as well as `key` so a layout that
 * puts `=` / `-` on a different shift level (or the numpad) still works.
 */
export function zoomChordForKey(e: {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): "in" | "out" | "reset" | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  if (e.key === "=" || e.key === "+" || e.code === "Equal" || e.code === "NumpadAdd") return "in";
  if (e.key === "-" || e.key === "_" || e.code === "Minus" || e.code === "NumpadSubtract") return "out";
  if (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") return "reset";
  return null;
}

/**
 * Whether a keystroke is the bare Shift+digit view shortcut `digit`.
 * Matched on `code`: the produced `key` is `!` / `@` on US layouts and
 * something else elsewhere.
 */
function isShiftDigit(e: KeyboardEvent, digit: 1 | 2): boolean {
  return (
    e.shiftKey && e.code === `Digit${digit}` && !e.metaKey && !e.ctrlKey && !e.altKey
  );
}

/**
 * The board's document-level keydown for single-key tools and view
 * shortcuts (zoom chords, Shift+1 fit, Shift+2 zoom to selection).
 * Returns whether it handled the key.
 *
 * Registered in the CAPTURE phase by `BoardView`, ahead of the slides
 * editor's bubble-phase key rules: otherwise type-to-edit claims Shift+1 /
 * Shift+2 on a selected sticky and types `!` / `@` into it instead of
 * zooming. Letters still reach type-to-edit, because tools stand down
 * whenever something is selected.
 *
 * The gates, in order: a key someone else already took, a keystroke
 * aimed outside the board, one meant for a field / menu / dialog
 * ({@link isTextEntryTarget}), and a live text edit all pass through.
 * View shortcuts work read-only and with a selection; the zoom chords
 * also honour auto-repeat (hold Mod+= to keep zooming) and suppress the
 * browser's page zoom, which on a canvas app only blurs the UI. Tools
 * ignore auto-repeat and need an editable board with nothing selected
 * (a read-only board pans on a plain drag already):
 * with a selection, a printable key is the slides editor's type-to-edit
 * (Google Slides parity), which must keep winning on a selected sticky.
 */
/**
 * Claim a key the board acted on. `stopPropagation` as well as
 * `preventDefault`: the editor's bubble-phase type-to-edit rule does not
 * check `defaultPrevented`, so without it a Shift+2 on a selected sticky
 * would zoom AND start an edit seeded with `@`.
 */
function consume(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();
}

export function handleBoardToolKey(e: KeyboardEvent, ctx: BoardToolKeyContext): boolean {
  if (e.defaultPrevented) return false;
  if (!ctx.isBoardTarget(e.target)) return false;
  if (isTextEntryTarget(e.target) || ctx.editor.isTextEditing()) return false;
  // An image crop owns the keyboard (Enter commits, Esc cancels); moving
  // the viewport under it is not something it expects.
  if (ctx.editor.isCropping()) return false;
  const chord = zoomChordForKey(e);
  if (chord) {
    consume(e);
    if (chord === "reset") {
      if (!e.repeat) ctx.zoomTo(1);
    } else {
      ctx.zoomStep(chord === "in" ? 1 : -1);
    }
    return true;
  }
  if (e.repeat) return false;
  if (isShiftDigit(e, 1)) {
    consume(e);
    ctx.fit();
    return true;
  }
  if (isShiftDigit(e, 2)) {
    consume(e);
    ctx.fitSelection();
    return true;
  }
  // Esc returns to Select (the shortcut sheet says so) from the hand
  // as from any insert tool. Not consumed: the editor still runs its own
  // Esc (clear the insert mode, deselect).
  if (e.key === "Escape") {
    ctx.setHand(false);
    ctx.setSection?.(false);
    return false;
  }
  if (ctx.readOnly || ctx.editor.getSelection().length > 0) return false;
  const tool = boardToolForKey(e);
  if (!tool) return false;
  consume(e);
  if (tool.kind === "hand") {
    ctx.setHand(true);
    return true;
  }
  ctx.setHand(false);
  ctx.setSection?.(tool.kind === "section");
  if (tool.kind === "section") ctx.editor.setInsertMode(null);
  else if (tool.kind === "select") ctx.editor.setInsertMode(null);
  else if (tool.kind === "sticky") ctx.dropSticky();
  else ctx.editor.setInsertMode(tool.insert);
  return true;
}

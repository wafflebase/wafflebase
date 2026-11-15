import type { InsertKind, SlidesEditor } from "@wafflebase/slides";
import type { ShortcutItem } from "@/components/shortcuts-help-dialog";

/**
 * What a single-key tool shortcut does: arm an editor insert mode, return
 * to select, or drop a sticky (stickies are board-local, not an
 * `InsertKind` — see `sticky.ts`).
 */
export type BoardTool =
  | { kind: "select" }
  | { kind: "sticky" }
  | { kind: "insert"; insert: InsertKind };

/**
 * FigJam's single-key tools, which is what a board user's hands already
 * know: V select, T text, S sticky, R rectangle, O ellipse, L line,
 * Shift+L arrow, X connector.
 */
const TOOL_KEYS: Readonly<Record<string, BoardTool>> = {
  v: { kind: "select" },
  t: { kind: "insert", insert: "text" },
  s: { kind: "sticky" },
  r: { kind: "insert", insert: "rect" },
  o: { kind: "insert", insert: "ellipse" },
  l: { kind: "insert", insert: "connector:line" },
  L: { kind: "insert", insert: "connector:arrow" },
  x: { kind: "insert", insert: "connector:elbow" },
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
  if (e.shiftKey && key !== "L") return null;
  return TOOL_KEYS[key] ?? null;
}

/** Tool-key hints shown in the toolbar tooltips. */
export const TOOL_HINTS = {
  select: "V",
  text: "T",
  sticky: "S",
} as const;

export const BOARD_SHORTCUT_CATEGORIES = [
  "Tools",
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
  { category: "Tools", keys: ["T"], description: "Text box" },
  { category: "Tools", keys: ["S"], description: "Sticky note" },
  { category: "Tools", keys: ["R"], description: "Rectangle" },
  { category: "Tools", keys: ["O"], description: "Ellipse" },
  { category: "Tools", keys: ["L"], description: "Line" },
  { category: "Tools", keys: ["Shift+L"], description: "Arrow" },
  { category: "Tools", keys: ["X"], description: "Connector" },

  { category: "Canvas", keys: ["Space"], description: "Pan (hold, then drag)" },
  { category: "Canvas", keys: ["Mod"], description: "Zoom (hold, then scroll)" },
  { category: "Canvas", keys: ["Shift+1"], description: "Zoom to fit" },

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
  editor: Pick<SlidesEditor, "isTextEditing" | "getSelection" | "setInsertMode">;
  readOnly: boolean;
  fit: () => void;
  dropSticky: () => void;
}

/**
 * The board's document-level keydown for single-key tools and Shift+1
 * zoom-to-fit. Returns whether it handled the key.
 *
 * The gates, in order: a key someone else already took, a held key's
 * auto-repeat, a keystroke meant for a field / menu / dialog
 * ({@link isTextEntryTarget}), and a live text edit all pass through.
 * Shift+1 is a view action, so it works read-only and with a selection.
 * Tools need an editable board with nothing selected: with a selection, a
 * printable key is the slides editor's type-to-edit (Google Slides
 * parity), which must keep winning on a selected sticky.
 */
export function handleBoardToolKey(e: KeyboardEvent, ctx: BoardToolKeyContext): boolean {
  if (e.defaultPrevented || e.repeat) return false;
  if (isTextEntryTarget(e.target) || ctx.editor.isTextEditing()) return false;
  if (e.shiftKey && e.code === "Digit1" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    ctx.fit();
    return true;
  }
  if (ctx.readOnly || ctx.editor.getSelection().length > 0) return false;
  const tool = boardToolForKey(e);
  if (!tool) return false;
  e.preventDefault();
  if (tool.kind === "select") ctx.editor.setInsertMode(null);
  else if (tool.kind === "sticky") ctx.dropSticky();
  else ctx.editor.setInsertMode(tool.insert);
  return true;
}

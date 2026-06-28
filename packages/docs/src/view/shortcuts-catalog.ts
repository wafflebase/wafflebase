/**
 * Single source of truth for the keyboard shortcuts shipped by the
 * docs editor. The runtime bindings live in `text-editor.ts` (and a
 * few in the frontend, e.g. comments toggle); this catalog drives the
 * help modal opened by Cmd/Ctrl+/.
 *
 * Keep this list in sync with `text-editor.ts handleKeyDown` whenever a
 * binding is added or removed. The runtime handler is a `switch`, not a
 * symbolic table, so there is no automated assertion that every binding
 * has a catalog entry — dual-edit is the convention.
 *
 * Keys use platform-neutral tokens:
 *   - `Mod`      — Cmd on macOS, Ctrl elsewhere
 *   - `WordMod`  — Option (⌥) on macOS, Ctrl elsewhere (word-level nav/delete)
 *   - `Shift`, `Alt`
 *   - Named keys (`Enter`, `Tab`, `Esc`, `Arrow ↑`, …)
 *   - Printable letters in upper case (`A`, `B`, …)
 *
 * A combo is a `+`-joined string; alternative combos are an array.
 */

export type ShortcutCategory =
  | 'Editing'
  | 'Navigation'
  | 'Format'
  | 'Paragraph'
  | 'Find'
  | 'Comments'
  | 'History'
  | 'Help';

export interface ShortcutEntry {
  category: ShortcutCategory;
  keys: ReadonlyArray<string>;
  description: string;
}

export const SHORTCUTS: ReadonlyArray<ShortcutEntry> = [
  // Editing -------------------------------------------------------------
  { category: 'Editing', keys: ['Mod+A'],               description: 'Select all' },
  { category: 'Editing', keys: ['Mod+C'],               description: 'Copy' },
  { category: 'Editing', keys: ['Mod+X'],               description: 'Cut' },
  { category: 'Editing', keys: ['Mod+V'],               description: 'Paste' },
  { category: 'Editing', keys: ['Mod+Shift+V'],         description: 'Paste without formatting' },
  { category: 'Editing', keys: ['Mod+Shift+C'],         description: 'Copy formatting (format painter)' },
  { category: 'Editing', keys: ['Mod+Alt+V'],           description: 'Paste formatting (apply format painter)' },
  { category: 'Editing', keys: ['WordMod+Backspace'],   description: 'Delete previous word' },
  { category: 'Editing', keys: ['WordMod+Delete'],      description: 'Delete next word' },

  // Navigation ----------------------------------------------------------
  { category: 'Navigation', keys: ['Arrow ←/→'],         description: 'Move caret by character' },
  { category: 'Navigation', keys: ['WordMod+Arrow ←/→'], description: 'Move caret by word' },
  { category: 'Navigation', keys: ['Arrow ↑/↓'],         description: 'Move caret by line' },
  { category: 'Navigation', keys: ['Home', 'End'],       description: 'Go to start / end of line' },
  { category: 'Navigation', keys: ['Mod+Home', 'Mod+End'], description: 'Go to start / end of document' },
  { category: 'Navigation', keys: ['Tab', 'Shift+Tab'],  description: 'Indent / outdent list item' },

  // Format (inline) -----------------------------------------------------
  { category: 'Format', keys: ['Mod+B'],                description: 'Bold' },
  { category: 'Format', keys: ['Mod+I'],                description: 'Italic' },
  { category: 'Format', keys: ['Mod+U'],                description: 'Underline' },
  { category: 'Format', keys: ['Mod+Shift+X'],          description: 'Strikethrough' },
  { category: 'Format', keys: ['Mod+.'],                description: 'Superscript' },
  { category: 'Format', keys: ['Mod+,'],                description: 'Subscript' },
  { category: 'Format', keys: ['Mod+K'],                description: 'Insert link' },
  { category: 'Format', keys: ['Mod+\\'],               description: 'Clear formatting' },

  // Paragraph -----------------------------------------------------------
  { category: 'Paragraph', keys: ['Mod+Shift+L'],       description: 'Align left' },
  { category: 'Paragraph', keys: ['Mod+Shift+E'],       description: 'Align center' },
  { category: 'Paragraph', keys: ['Mod+Shift+R'],       description: 'Align right' },
  { category: 'Paragraph', keys: ['Mod+Shift+J'],       description: 'Justify' },
  { category: 'Paragraph', keys: ['Mod+Shift+7'],       description: 'Ordered (numbered) list' },
  { category: 'Paragraph', keys: ['Mod+Shift+8'],       description: 'Unordered (bulleted) list' },
  { category: 'Paragraph', keys: ['Mod+]', 'Mod+['],    description: 'Increase / decrease indent' },
  { category: 'Paragraph', keys: ['Mod+Alt+0'],         description: 'Reset block to paragraph' },
  { category: 'Paragraph', keys: ['Mod+Alt+1', 'Mod+Alt+2', 'Mod+Alt+3', 'Mod+Alt+4', 'Mod+Alt+5', 'Mod+Alt+6'], description: 'Apply heading 1 – 6' },
  { category: 'Paragraph', keys: ['Mod+Enter'],         description: 'Insert page break' },

  // Find ---------------------------------------------------------------
  { category: 'Find', keys: ['Mod+F'],                  description: 'Find' },
  { category: 'Find', keys: ['Mod+H'],                  description: 'Find and replace' },

  // Comments -----------------------------------------------------------
  { category: 'Comments', keys: ['Mod+Alt+M'],          description: 'Insert comment on selection' },
  { category: 'Comments', keys: ['Mod+Alt+Shift+M'],    description: 'Toggle comments side panel' },

  // History ------------------------------------------------------------
  { category: 'History', keys: ['Mod+Z'],               description: 'Undo' },
  { category: 'History', keys: ['Mod+Shift+Z', 'Mod+Y'], description: 'Redo' },

  // Help ---------------------------------------------------------------
  { category: 'Help', keys: ['Mod+/'],                  description: 'Show keyboard shortcuts' },
];

/**
 * Render a combo string for display, rewriting `Mod` to the
 * platform-correct symbol. Pure helper so the function stays testable.
 */
export function formatCombo(combo: string, isMac: boolean): string {
  const mod = isMac ? '⌘' : 'Ctrl';
  return combo
    .split('+')
    .map((part) => part.trim())
    .map((part) => {
      if (part === 'Mod') return mod;
      if (part === 'WordMod') return isMac ? '⌥' : 'Ctrl';
      if (part === 'Shift') return isMac ? '⇧' : 'Shift';
      if (part === 'Alt') return isMac ? '⌥' : 'Alt';
      return part;
    })
    .join(isMac ? '' : '+');
}

/**
 * Single source of truth for the keyboard shortcuts shipped by the
 * sheets editor. The runtime bindings live in `worksheet.ts` (keyRules
 * via `runKeyRules`); this catalog drives the help modal opened by
 * Cmd/Ctrl+/.
 *
 * Keys use platform-neutral tokens:
 *   - `Mod`  — Cmd on macOS, Ctrl elsewhere
 *   - `Shift`, `Alt`
 *   - Named keys (`Enter`, `Tab`, `Esc`, `Arrow ↑`, …)
 *   - Printable letters in upper case (`A`, `B`, …)
 *
 * A combo is a `+`-joined string; alternative combos are an array.
 */

export type ShortcutCategory =
  | 'Navigation'
  | 'Selection'
  | 'Editing'
  | 'Clipboard'
  | 'Format'
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
  // Navigation ---------------------------------------------------------
  { category: 'Navigation', keys: ['Arrow ←/→/↑/↓'],          description: 'Move active cell' },
  { category: 'Navigation', keys: ['Tab', 'Shift+Tab'],       description: 'Move to next / previous cell' },
  { category: 'Navigation', keys: ['Enter'],                  description: 'Confirm input and move down' },
  { category: 'Navigation', keys: ['Mod+Arrow ←/→/↑/↓'],      description: 'Jump to data edge in direction' },

  // Selection ----------------------------------------------------------
  { category: 'Selection', keys: ['Mod+A'],                   description: 'Select all' },
  { category: 'Selection', keys: ['Shift+Arrow ←/→/↑/↓'],     description: 'Extend selection one cell' },

  // Editing ------------------------------------------------------------
  { category: 'Editing', keys: ['Enter'],                     description: 'Edit active cell' },
  { category: 'Editing', keys: ['Esc'],                       description: 'Cancel cell edit / clear copy buffer' },
  { category: 'Editing', keys: ['Delete', 'Backspace'],       description: 'Clear cell contents' },
  { category: 'Editing', keys: ['Mod+Shift+M'],               description: 'Merge / unmerge selected cells' },

  // Clipboard ----------------------------------------------------------
  { category: 'Clipboard', keys: ['Mod+C'],              description: 'Copy' },
  { category: 'Clipboard', keys: ['Mod+X'],              description: 'Cut' },
  { category: 'Clipboard', keys: ['Mod+V'],              description: 'Paste' },

  // Format -------------------------------------------------------------
  { category: 'Format', keys: ['Mod+B'],                 description: 'Bold' },
  { category: 'Format', keys: ['Mod+I'],                 description: 'Italic' },
  { category: 'Format', keys: ['Mod+U'],                 description: 'Underline' },
  { category: 'Format', keys: ['Mod+Shift+S'],           description: 'Strikethrough' },

  // Find ---------------------------------------------------------------
  { category: 'Find', keys: ['Mod+F'],                   description: 'Find' },

  // Comments -----------------------------------------------------------
  { category: 'Comments', keys: ['Mod+Alt+M'],           description: 'Insert comment on active cell' },
  { category: 'Comments', keys: ['Mod+Alt+Shift+M'],     description: 'Toggle comments side panel' },

  // History ------------------------------------------------------------
  { category: 'History', keys: ['Mod+Z'],                description: 'Undo' },
  { category: 'History', keys: ['Mod+Shift+Z', 'Mod+Y'], description: 'Redo' },

  // Help ---------------------------------------------------------------
  { category: 'Help', keys: ['Mod+/'],                   description: 'Show keyboard shortcuts' },
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
      if (part === 'Shift') return isMac ? '⇧' : 'Shift';
      if (part === 'Alt') return isMac ? '⌥' : 'Alt';
      return part;
    })
    .join(isMac ? '' : '+');
}

/**
 * Single source of truth for the keyboard shortcuts shipped by the
 * slides editor. The runtime keyRule registrations live in
 * `interactions/keyboard.ts`; this catalog drives the help modal and
 * any user-facing reference docs.
 *
 * Keep this list in sync with `buildKeyRules` whenever you add or
 * remove a rule. There is no automated assertion that every rule has
 * a catalog entry (the rules are predicate-based, not symbolic), so
 * dual-edit is the convention.
 *
 * Keys use platform-neutral tokens:
 *   - `Mod`        — Cmd on macOS, Ctrl elsewhere
 *   - `Shift`, `Alt`
 *   - Named keys (`Enter`, `Tab`, `Esc`, `Page Up`, `Arrow ↑`, …)
 *   - Printable letters in upper case (`A`, `M`, `D`, …)
 *
 * A combo is a `+`-joined string; multiple alternative combos are
 * an array of strings.
 */

export type ShortcutCategory =
  | 'Selection'
  | 'Slide'
  | 'Clipboard'
  | 'Z-order'
  | 'Nudge'
  | 'Format'
  | 'Present'
  | 'Help'
  | 'Drag';

export interface ShortcutEntry {
  category: ShortcutCategory;
  keys: ReadonlyArray<string>;
  description: string;
}

export const SHORTCUTS: ReadonlyArray<ShortcutEntry> = [
  // Selection ------------------------------------------------------------
  { category: 'Selection', keys: ['Mod+A'],            description: 'Select all elements on the current slide' },
  { category: 'Selection', keys: ['Esc'],              description: 'Exit text edit; pop drill-in level; clear selection' },
  { category: 'Selection', keys: ['Tab', 'Shift+Tab'], description: 'Cycle next / previous element' },
  { category: 'Selection', keys: ['F2', 'Enter'],      description: 'Enter text edit on the selected text element' },
  { category: 'Selection', keys: ['Delete', 'Backspace'], description: 'Delete selected elements' },
  { category: 'Selection', keys: ['Mod+Alt+G'],       description: 'Group selected elements' },
  { category: 'Selection', keys: ['Mod+Shift+Alt+G'], description: 'Ungroup selected group' },

  // Nudge ----------------------------------------------------------------
  { category: 'Nudge', keys: ['Arrow ←/→/↑/↓'],         description: 'Move selection 1 px' },
  { category: 'Nudge', keys: ['Shift + Arrow'],          description: 'Move selection 10 px' },

  // Slide ----------------------------------------------------------------
  { category: 'Slide', keys: ['Mod+M'],           description: 'Add a new slide after the current' },
  { category: 'Slide', keys: ['Mod+Shift+D'],     description: 'Duplicate the current slide' },
  { category: 'Slide', keys: ['Mod+D'],           description: 'Duplicate selected elements (or current slide if none)' },
  { category: 'Slide', keys: ['Page Up', 'Page Down'], description: 'Go to previous / next slide' },
  { category: 'Slide', keys: ['Arrow ↑', 'Arrow ↓'],   description: 'Go to previous / next slide (thumbnail panel focused)' },

  // Clipboard ------------------------------------------------------------
  { category: 'Clipboard', keys: ['Mod+C'],       description: 'Copy selected elements' },
  { category: 'Clipboard', keys: ['Mod+X'],       description: 'Cut selected elements' },
  { category: 'Clipboard', keys: ['Mod+V'],       description: 'Paste' },
  { category: 'Clipboard', keys: ['Mod+Shift+V'], description: 'Paste (when editing text: plain text)' },

  // Z-order --------------------------------------------------------------
  { category: 'Z-order', keys: ['Mod+↑', 'Mod+↓'],             description: 'Bring forward / send backward' },
  { category: 'Z-order', keys: ['Mod+Shift+↑', 'Mod+Shift+↓'], description: 'Bring to front / send to back' },

  // Format (text-box edit mode) ------------------------------------------
  { category: 'Format', keys: ['Mod+B'],       description: 'Bold (when editing text)' },
  { category: 'Format', keys: ['Mod+I'],       description: 'Italic (when editing text)' },
  { category: 'Format', keys: ['Mod+U'],       description: 'Underline (when editing text)' },
  { category: 'Format', keys: ['Mod+K'],       description: 'Insert link (when editing text)' },
  { category: 'Format', keys: ['Mod+\\'],      description: 'Clear formatting (when editing text)' },
  { category: 'Format', keys: ['Mod+Shift+L', 'Mod+Shift+E', 'Mod+Shift+R'], description: 'Align left / center / right (when editing text)' },

  // Present --------------------------------------------------------------
  { category: 'Present', keys: ['Mod+Enter'],       description: 'Start presentation from the current slide' },
  { category: 'Present', keys: ['Mod+Shift+Enter'], description: 'Start presentation from the first slide' },

  // History --------------------------------------------------------------
  { category: 'Help', keys: ['Mod+Z'],          description: 'Undo' },
  { category: 'Help', keys: ['Mod+Shift+Z'],    description: 'Redo' },
  { category: 'Help', keys: ['Mod+/'],          description: 'Show keyboard shortcuts' },

  // Drag modifiers --------------------------------------------------------
  { category: 'Drag', keys: ['Shift'], description: 'While drawing a shape: force 1:1 (square / circle / regular polygon)' },
  { category: 'Drag', keys: ['Shift'], description: 'While drawing a line / connector: snap endpoint angle to 15°' },
  { category: 'Drag', keys: ['Shift'], description: 'While dragging a line endpoint: snap to 15° relative to the opposite end' },
  { category: 'Drag', keys: ['Shift'], description: 'While moving selected elements: lock to the dominant axis (H or V)' },
];

/**
 * Render a combo string for display, rewriting `Mod` to the
 * platform-correct symbol. Pass `isMac` explicitly so the function
 * stays pure / testable.
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

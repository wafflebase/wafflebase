/**
 * The keyboard, which is the whole reason this feature can report a state that
 * only exists while it is held.
 *
 * **THE CAPTURE TRIGGER IS A KEY, NOT A CLICK**, and that is not a preference.
 * A hover tooltip, an open menu and a drag in progress are all destroyed by the
 * click a pick would need — and an overlay that swallows pointer events makes it
 * worse, because the app underneath then stops tracking hover and never sees the
 * `mouseup` of a drag already under way. A keypress moves no pointer, so `:hover`,
 * JS hover state and a held button all survive it. Measured by hand; recorded as
 * finding 5 in `docs/design/debug-report.md`.
 *
 * Two consequences for this module:
 *
 *   - Every binding is a SINGLE key while debug mode is live, because a chord
 *     with a modifier competes with the engine shortcut catalogs, and the point
 *     is to press it without thinking while holding the mouse still.
 *   - The keys are intercepted at capture phase by the caller, so the app
 *     underneath never sees them — no menu typeahead, no app shortcut fires.
 *     That interception is what makes single letters safe here.
 */

/** What a key press asks for. */
export type HotkeyAction =
  /** Enter or leave debug mode. */
  | 'toggle'
  /** Capture what is under the cursor right now, without moving it. */
  | 'capture'
  /** Drag out a rectangle. */
  | 'region'
  /** Open the preview panel over what has been collected. */
  | 'review'
  /** Abandon the thing in hand — never the mode. */
  | 'cancel';

export type Chord = {
  /** Compared case-insensitively against `KeyboardEvent.key`. */
  key: string;
  /** `Meta` on macOS, `Control` elsewhere; either satisfies this. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

/**
 * The catalog. One line per action, so rebinding is a one-line change — which
 * is the point of having a catalog rather than comparing keys inline.
 *
 * `Mod+Shift+Y` for the global toggle avoids both the engine catalogs
 * (`packages/slides/src/view/editor/shortcuts-catalog.ts` claims `Mod+Shift+`
 * with 7 8 Alt+G C D E Enter J L M R S V X Z ↑ ↓) and the combinations browsers
 * reserve (B I J C P O N M T Q). It is also the only binding that must work
 * while debug mode is OFF, which is why it is the only one with modifiers.
 */
export const DEFAULT_BINDINGS: Readonly<Record<HotkeyAction, Chord>> = {
  toggle: { key: 'y', mod: true, shift: true },
  capture: { key: 'c' },
  // THERE IS NO `pick` BINDING. `p` used to enter a "pick" mode whose entire
  // effect was painting the hover outline — it could never produce an item, and
  // `capture` already works in any mode, so the badge listed it beside `c` and
  // `r` as if it were a third action while doing nothing a reporter could see.
  // The outline is now always on while debug mode is live, which also fixes the
  // real defect underneath: `c` used to fire with nothing outlined, so what it
  // would record was invisible until after the keystroke.
  region: { key: 'r' },
  // NOT `Enter`, which was the first choice and was wrong: a recognised binding
  // is intercepted at capture phase, so binding Enter took it from the entire app
  // while debug mode was live — the review panel's own buttons stopped being
  // keyboard-activatable, and Enter-to-commit in the sheet grid went dead. Enter
  // is load-bearing across menus, dialogs and the grid in a way `c` and `r` are
  // not, and a reporting tool may not break the app it is used to report on.
  review: { key: 'v' },
  cancel: { key: 'Escape' },
};

/** The parts of a keyboard event this module reads. Narrowed for testability. */
export type KeyLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

export function matchChord(event: KeyLike, chord: Chord): boolean {
  if (event.key.toLowerCase() !== chord.key.toLowerCase()) return false;
  const mod = Boolean(event.ctrlKey) || Boolean(event.metaKey);
  if (Boolean(chord.mod) !== mod) return false;
  if (Boolean(chord.shift) !== Boolean(event.shiftKey)) return false;
  if (Boolean(chord.alt) !== Boolean(event.altKey)) return false;
  return true;
}

/**
 * The action a key press asks for, given whether debug mode is live.
 *
 * When it is NOT live only `toggle` can fire: the single-letter bindings would
 * otherwise steal `c` and `r` from the app on every keystroke, which is a
 * far worse defect than anything this feature reports.
 */
export function actionFor(
  event: KeyLike,
  live: boolean,
  bindings: Readonly<Record<HotkeyAction, Chord>> = DEFAULT_BINDINGS,
): HotkeyAction | undefined {
  if (matchChord(event, bindings.toggle)) return 'toggle';
  if (!live) return undefined;
  for (const action of ['capture', 'region', 'review', 'cancel'] as const) {
    if (matchChord(event, bindings[action])) return action;
  }
  return undefined;
}

/**
 * The actions available while the review panel is open.
 *
 * Aiming is not one of them: the reporter is reading a list, and the panel is
 * full of buttons whose own keyboard activation must keep working. Only leaving
 * the panel — and the global toggle — are recognised, so every other key reaches
 * the panel untouched.
 */
export function actionWhileReviewing(
  event: KeyLike,
  bindings: Readonly<Record<HotkeyAction, Chord>> = DEFAULT_BINDINGS,
): HotkeyAction | undefined {
  const action = actionFor(event, true, bindings);
  return action === 'toggle' || action === 'cancel' ? action : undefined;
}

/**
 * Whether a key press belongs to the app rather than to the overlay.
 *
 * A field the overlay itself renders owns the keyboard while it is focused: `r`
 * and `p` are letters someone is typing, and Escape means "drop this one", not
 * "leave debug mode". Measured the hard way — the `window.prompt` this replaced
 * sent its Escape on to the page and turned debug mode off, so cancelling once
 * made the whole overlay vanish with no reason given.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.matches('input, textarea, select, [contenteditable="true"]')) {
    return true;
  }
  return false;
}

/**
 * Helpers for reading a range style summary (`getRangeStyleSummary()`).
 *
 * Boolean inline styles are toggled from the *range* summary, never from
 * `getSelectionStyle()`: the latter samples a single caret position, and a
 * backward (right-to-left) selection parks the caret at the range's start,
 * where it resolves to the run *preceding* the selection. Toggles fed from
 * the caret therefore invert the wrong value and can leave a style
 * impossible to re-apply (issue #715).
 */

/**
 * Is a boolean inline style fully applied across the current selection?
 *
 * `'mixed'` — the selection carries both values — counts as *not* applied,
 * so the next click applies the style to the whole range (Google Docs
 * behaviour) and the toolbar button renders unpressed.
 */
export function isStyleOn(value: boolean | "mixed" | undefined): boolean {
  return value === true;
}

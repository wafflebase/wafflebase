import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';
import type { ThemeColor } from '../../model/theme';

/**
 * Default font size (pt) for freshly typed slide text — plain text
 * boxes, table cells, and shape inline text.
 *
 * Slides text that the user types into an empty body would otherwise
 * fall through to the docs engine's `DEFAULT_INLINE_STYLE.fontSize`
 * (11 pt — the Google *Docs* default), which renders noticeably smaller
 * than the body placeholder (18 pt) and than the table/text defaults in
 * PowerPoint (18 pt) and Google Slides (14 pt). We standardize on
 * PowerPoint's 18 pt, which also matches the `body` placeholder in
 * `DEFAULT_MASTER`, so typed text reads at a consistent slide size.
 */
export const SLIDES_DEFAULT_TEXT_SIZE = 18;

/** Bind new runs to the deck's `text` role so they follow the theme. */
const DEFAULT_TEXT_COLOR: ThemeColor = { kind: 'role', role: 'text' };

/**
 * A single empty paragraph carrying the slides default inline style
 * (theme `text` color + {@link SLIDES_DEFAULT_TEXT_SIZE}). Seeds new
 * text boxes (`insert.ts`) and the in-place editor for empty cell /
 * shape bodies (`mountSlidesTextBox`) so the first keystroke renders at
 * the slide default instead of the docs 11 pt fallback.
 *
 * Cast through `Block`: `style.color` carries a `ThemeColor` that the
 * text-renderer's color resolver maps to a concrete color at paint time
 * (same convention as every other slides text run).
 */
export function makeDefaultSlidesTextBlock(id = 'placeholder'): Block {
  return {
    id,
    type: 'paragraph',
    inlines: [
      {
        text: '',
        style: { color: DEFAULT_TEXT_COLOR, fontSize: SLIDES_DEFAULT_TEXT_SIZE },
      },
    ],
    // Fully-defaulted block style — `computeLayout` reads `marginTop` /
    // `marginBottom` without a fallback, so a sparse style would NaN the
    // cumulative y and shift the paint. Matches the prior insert seed.
    style: { ...DEFAULT_BLOCK_STYLE },
  } as Block;
}

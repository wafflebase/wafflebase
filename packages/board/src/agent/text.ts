import {
  SLIDES_DEFAULT_TEXT_SIZE,
  generateId,
  makeDefaultSlidesTextBlock,
  type ElementInit,
  type Point,
} from '@wafflebase/slides';

/** The text tool's click-to-insert width (slides `insert.ts` `TEXT_DEFAULT_W`). */
export const TEXT_BOX_WIDTH = 400;

/** The text tool's one-line height (slides `insert.ts` `TEXT_DEFAULT_H`). */
export const TEXT_BOX_MIN_HEIGHT = 80;

/**
 * A rough height for `text` wrapped at `w`. The canvas grows a `grow`
 * text box to fit once someone edits it, but a box written without an
 * editor keeps the height it is given, so this errs tall: a box a little
 * too big reads fine, one too small spills past its own selection frame.
 */
export function estimateTextHeight(
  text: string,
  w: number = TEXT_BOX_WIDTH,
  fontSize: number = SLIDES_DEFAULT_TEXT_SIZE,
): number {
  const charW = fontSize * 0.75;
  const lineH = fontSize * 2;
  const perLine = Math.max(1, Math.floor(w / charW));
  const lines = text
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0);
  return Math.max(TEXT_BOX_MIN_HEIGHT, Math.ceil(lines * lineH + fontSize));
}

/**
 * The `ElementInit` for a text box holding `text`, its top-left at `at` —
 * the same element the text tool inserts (`autofit: 'grow'`, the slides
 * default run style), with one paragraph per line.
 */
export function buildTextBoxInit(
  text: string,
  at: Point,
  opts: { w?: number; h?: number; fontSize?: number; bold?: boolean } = {},
): ElementInit {
  const w = opts.w ?? TEXT_BOX_WIDTH;
  const fontSize = opts.fontSize ?? SLIDES_DEFAULT_TEXT_SIZE;
  const h = opts.h ?? estimateTextHeight(text, w, fontSize);
  const blocks = text.split('\n').map((line, i) => {
    const block = makeDefaultSlidesTextBlock(i === 0 ? undefined : generateId());
    block.inlines = block.inlines.map((inline) => ({
      ...inline,
      text: line,
      style: {
        ...inline.style,
        fontSize,
        ...(opts.bold ? { bold: true } : {}),
      },
    }));
    return block;
  });
  return {
    type: 'text',
    frame: { x: at.x, y: at.y, w, h, rotation: 0 },
    data: { autofit: 'grow', blocks },
  } as ElementInit;
}

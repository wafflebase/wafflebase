import { DEFAULT_BLOCK_STYLE, type Block, type BlockStyle, type Inline } from '@wafflebase/docs';

/** Inline formatting accumulated while walking the HTML tree. */
interface Marks { bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean }

/**
 * The item-level typography Miro carries on `style` rather than in the HTML.
 *
 * Miro applies size, colour and alignment to the whole item and puts only
 * bold/italic/underline markup inside `data.content`, so these arrive
 * alongside the fragment rather than within it. Dropping them (which is what
 * the importer did) flattened 3,821 text items and every shape label to the
 * 11pt black default: grey annotations turned black, 36pt headings turned
 * body-sized, and white-on-dark labels became black on dark and unreadable.
 *
 * Every field is optional and applied as a BASE the parsed markup layers over,
 * so an inline `<strong>` still wins on the axis it names and leaves the rest.
 */
export interface MiroTextStyle {
  /** Size in POINTS. Miro reports pixels; the caller converts. */
  fontSize?: number;
  color?: string;
  alignment?: BlockStyle['alignment'];
}

/** Miro `textAlign` → the docs block alignment. Unknown values fall through. */
export function miroAlignment(align: string | undefined): BlockStyle['alignment'] | undefined {
  if (align === 'left' || align === 'center' || align === 'right') return align;
  if (align === 'justify') return 'justify';
  return undefined;
}

/**
 * Miro font sizes are in PIXELS; `InlineStyle.fontSize` is in POINTS.
 *
 * The CSS ratio (1pt = 4/3px) is the right one here — Miro's canvas is a web
 * canvas and its "14" is 14 CSS pixels, which is what the docs text engine
 * will lay out as 10.5pt.
 */
export function miroFontSizePt(px: number | undefined): number | undefined {
  if (px === undefined || !(px > 0)) return undefined;
  return px * 0.75;
}

const TAG_MARKS: Record<string, keyof Marks> = {
  STRONG: 'bold',
  B: 'bold',
  EM: 'italic',
  I: 'italic',
  U: 'underline',
  S: 'strikethrough',
};

function makeBlock(inlines: Inline[], index: number, base: MiroTextStyle): Block {
  const inlineStyle = baseInlineStyle(base);
  return {
    id: `miro-${index}`,
    type: 'paragraph',
    inlines: inlines.length ? inlines : [{ text: '', style: inlineStyle }],
    style: {
      ...DEFAULT_BLOCK_STYLE,
      ...(base.alignment ? { alignment: base.alignment } : {}),
    },
  } as Block;
}

/**
 * The item-level typography as an inline style, with absent fields left out
 * rather than written as `undefined` — an explicit `undefined` is what the
 * docs style merge reads as "clear this axis", so writing them would strip
 * the inherited default instead of deferring to it.
 */
function baseInlineStyle(base: MiroTextStyle): Record<string, unknown> {
  return {
    ...(base.fontSize !== undefined ? { fontSize: base.fontSize } : {}),
    ...(base.color !== undefined ? { color: base.color } : {}),
  };
}

/**
 * Parse Miro's `data.content` HTML fragment into docs `Block[]`.
 *
 * Deliberately conservative: block breaks come from `<p>`/`<br>`, and
 * bold/italic/underline/strikethrough carry onto the inline style. Every other
 * tag degrades to its text content — rich-text fidelity is best-effort, and a
 * tag we do not model must never lose the user's words.
 *
 * `base` carries the typography Miro keeps on the item's `style` rather than
 * in this fragment (see {@link MiroTextStyle}); the markup layers over it.
 */
export function miroHtmlToBlocks(html: string | undefined, base: MiroTextStyle = {}): Block[] {
  const source = (html ?? '').trim();
  if (!source) return [makeBlock([], 0, base)];

  const doc = new DOMParser().parseFromString(`<body>${source}</body>`, 'text/html');
  const inlineBase = baseInlineStyle(base);
  const blocks: Block[] = [];
  let current: Inline[] = [];

  const flush = () => {
    if (current.length) {
      blocks.push(makeBlock(current, blocks.length, base));
      current = [];
    }
  };

  const walk = (node: Node, marks: Marks) => {
    if (node.nodeType === 3 /* text */) {
      const text = node.textContent ?? '';
      if (text) current.push({ text, style: { ...inlineBase, ...marks } } as Inline);
      return;
    }
    if (node.nodeType !== 1 /* element */) return;

    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (tag === 'BR') {
      flush();
      return;
    }

    const isBlock = tag === 'P' || tag === 'DIV' || tag === 'LI';
    if (isBlock) flush();

    const mark = TAG_MARKS[tag];
    const next = mark ? { ...marks, [mark]: true } : marks;
    for (const child of Array.from(el.childNodes)) walk(child, next);

    if (isBlock) flush();
  };

  for (const child of Array.from(doc.body.childNodes)) walk(child, {});
  flush();

  return blocks.length ? blocks : [makeBlock([], 0, base)];
}

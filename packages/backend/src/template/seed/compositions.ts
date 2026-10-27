import type { Element } from '@wafflebase/slides';
import type { SlidesSlide } from '../../yorkie/yorkie.types';
import { DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import type { Block } from '@wafflebase/docs';
import { SH, SW, rf, shapeEl, type Fill } from './builders';

/**
 * High-level slide compositions for authoring agents (#1091).
 *
 * Each builder returns a plain `Element[]` — ordinary native slide elements
 * (shape / text / table / image) in the same 1920x1080 coordinate system and
 * theme-role colour vocabulary `builders.ts` uses. They are PURE DATA: no
 * network, no randomness, no editor. An agent composes a slide from these
 * validated pieces instead of hand-writing raw element JSON.
 *
 * Guarantees "by construction":
 *  - every frame lies inside the slide's safe area (`MARGIN` on each side,
 *    and above `FOOTER_TOP`, which only `footer` may enter) — a builder
 *    THROWS rather than emit an element that overflows or runs off-slide;
 *  - text boxes are `autofit: 'none'` with explicit sizes, and the code /
 *    table builders size their frames from the content (line count, row
 *    count), so a stack of compositions can be positioned by arithmetic;
 *  - colours are theme roles, so the pieces follow whichever theme the deck
 *    carries and keep contrast in light and dark themes.
 *
 * Place the result with {@link addElements}. Compositions do not detect
 * collisions with *each other*: use the returned frames (`frameOf`) / the
 * exported layout constants to stack them.
 */

/** Edge margin, matching the built-in layouts' placeholder padding. */
export const MARGIN = 80;
/** Top of the footer band; content builders keep their frames above this. */
export const FOOTER_TOP = SH - 88;
/** Full-width content measure inside the margins. */
export const CONTENT_W = SW - MARGIN * 2;

/** Slide-logical rectangle a composition is placed in. */
export type Box = { x: number; y: number; w: number; h: number };

type Common = {
  /** Id prefix (unique per slide). Auto-generated when omitted. */
  id?: string;
};

let counter = 0;
const nextId = (prefix: string, given?: string): string => {
  if (given) return given;
  counter += 1;
  return `c-${prefix}-${counter}`;
};

const role = (r: string) => ({ kind: 'role' as const, role: r });

function frame(x: number, y: number, w: number, h: number) {
  return { x, y, w, h, rotation: 0 };
}

/** Throw unless the box sits inside the slide's safe area. */
function assertSafe(name: string, b: Box, maxY = FOOTER_TOP): void {
  const ok =
    [b.x, b.y, b.w, b.h].every(Number.isFinite) &&
    b.w > 0 &&
    b.h > 0 &&
    b.x >= MARGIN &&
    b.y >= 0 &&
    b.x + b.w <= SW - MARGIN &&
    b.y + b.h <= maxY;
  if (!ok) {
    throw new Error(
      `${name}: frame ${JSON.stringify(b)} is outside the safe area ` +
        `(x ${MARGIN}..${SW - MARGIN}, y 0..${maxY})`,
    );
  }
}

type TextOpts = {
  fontSize: number;
  bold?: boolean;
  color?: string; // theme role
  fontFamily?: string;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  marginBottom?: number;
};

let blockCounter = 0;

/** A single-run docs block (one paragraph) with explicit typography. */
function textBlock(text: string, o: TextOpts): Block {
  blockCounter += 1;
  return {
    id: `cb-${blockCounter}`,
    type: 'paragraph',
    style: {
      ...DEFAULT_BLOCK_STYLE,
      alignment: o.align ?? 'left',
      lineHeight: o.lineHeight ?? 1.25,
      marginBottom: o.marginBottom ?? 0,
    },
    inlines: [
      {
        text,
        style: {
          fontSize: o.fontSize,
          ...(o.bold ? { bold: true } : {}),
          ...(o.fontFamily ? { fontFamily: o.fontFamily } : {}),
          color: role(o.color ?? 'text'),
        },
      },
    ],
  } as unknown as Block;
}

function textEl(
  id: string,
  b: Box,
  blocks: Block[],
  anchor?: 'top' | 'middle' | 'bottom',
): Element {
  return {
    id,
    type: 'text',
    frame: frame(b.x, b.y, b.w, b.h),
    data: {
      blocks,
      autofit: 'none',
      verticalAnchor: anchor ?? 'top',
      inset: { left: 0, top: 0, right: 0, bottom: 0 },
    },
  } as unknown as Element;
}

/** Append compositions to a slide, in paint order (later = on top). */
export function addElements(
  slide: SlidesSlide,
  ...parts: Element[][]
): SlidesSlide {
  for (const p of parts) slide.elements.push(...p);
  return slide;
}

/** Bounding box of the whole composition (for stacking the next piece). */
export function frameOf(els: Element[]): Box {
  if (els.length === 0) throw new Error('frameOf: empty composition');
  const x0 = Math.min(...els.map((e) => e.frame.x));
  const y0 = Math.min(...els.map((e) => e.frame.y));
  const x1 = Math.max(...els.map((e) => e.frame.x + e.frame.w));
  const y1 = Math.max(...els.map((e) => e.frame.y + e.frame.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// --------------------------------------------------------------------------
// kicker
// --------------------------------------------------------------------------

export type KickerOptions = Common & {
  x?: number;
  /** Top of the label (default 28: just above the layouts' title at y=80). */
  y?: number;
  w?: number;
  /** Upper-case the label (default true). */
  uppercase?: boolean;
  /** Theme colour role (default accent1). */
  color?: string;
};

/**
 * A small eyebrow / overline label (accent tick + bold caps text) to sit above
 * a slide title. 40px tall; default position clears the built-in title slot.
 */
export function kicker(text: string, opts: KickerOptions = {}): Element[] {
  const x = opts.x ?? MARGIN;
  const y = opts.y ?? 28;
  const w = opts.w ?? 900;
  const h = 40;
  const label = (opts.uppercase ?? true) ? text.toUpperCase() : text;
  assertSafe('kicker', { x, y, w, h });
  const id = nextId('kicker', opts.id);
  const color = opts.color ?? 'accent1';
  return [
    shapeEl(`${id}-tick`, 'rect', x, y + 6, 8, 28, rf(color)) as Element,
    textEl(
      `${id}-text`,
      { x: x + 24, y, w: w - 24, h },
      [textBlock(label, { fontSize: 24, bold: true, color, lineHeight: 1.2 })],
      'middle',
    ),
  ];
}

// --------------------------------------------------------------------------
// calloutCard
// --------------------------------------------------------------------------

export type CalloutCardOptions = Common & {
  /** Bold heading line (optional). */
  title?: string;
  /** Body text; `\n` starts a new paragraph. */
  body: string;
  /** Outer box including the callout tail (default 800x300 at the margin). */
  box?: Partial<Box>;
  /** Draw the speech-bubble tail (default true). false = plain rounded card. */
  tail?: boolean;
  /** Fill theme role (default backgroundAlt). */
  fill?: string;
  /** Accent role for the title (default accent1). */
  accent?: string;
};

/**
 * A callout / note card: a `wedgeRoundRectCallout` shape (plain `roundRect`
 * with `tail: false`) carrying its own text body. The tail points down-left
 * and is reserved INSIDE `box` — the shape body takes the top 80% so the tip
 * never leaves the box, and the card never collides with what sits below it.
 */
export function calloutCard(opts: CalloutCardOptions): Element[] {
  const box: Box = { x: MARGIN, y: 260, w: 800, h: 300, ...opts.box };
  assertSafe('calloutCard', box);
  const tail = opts.tail ?? true;
  const bodyH = tail ? Math.round(box.h * 0.8) : box.h;
  const id = nextId('callout', opts.id);
  const blocks: Block[] = [];
  if (opts.title) {
    blocks.push(
      textBlock(opts.title, {
        fontSize: 36,
        bold: true,
        color: opts.accent ?? 'accent1',
        marginBottom: 12,
      }),
    );
  }
  for (const line of opts.body.split('\n')) {
    blocks.push(
      textBlock(line, { fontSize: 30, lineHeight: 1.35, marginBottom: 6 }),
    );
  }
  const el = shapeEl(
    id,
    tail ? 'wedgeRoundRectCallout' : 'roundRect',
    box.x,
    box.y,
    box.w,
    bodyH,
    rf(opts.fill ?? 'backgroundAlt'),
  ) as { data: Record<string, unknown> };
  // Tip at (-25%, +62.5%) of the body from its centre: 12.5% of bodyH below
  // the shape = 10% of box.h, inside the reserved 20%.
  if (tail) el.data.adjustments = [-25000, 62500, 16667];
  el.data.stroke = { color: role(opts.accent ?? 'accent1'), width: 3 };
  el.data.text = {
    blocks,
    autofit: 'none',
    verticalAnchor: 'middle',
    inset: { left: 40, top: 28, right: 40, bottom: 28 },
  };
  return [el as unknown as Element];
}

// --------------------------------------------------------------------------
// codeBlock
// --------------------------------------------------------------------------

export type CodeBlockOptions = Common & {
  x?: number;
  y?: number;
  /** Panel width (default: full content measure). */
  w?: number;
  fontSize?: number;
  /** Panel fill role (default `text`, i.e. dark on light themes). */
  panel?: string;
  /** Code colour role (default `background`, contrasting the panel). */
  color?: string;
};

const CODE_PAD = 36;
const CODE_LINE = 1.4;
const MONO_EM = 0.62; // conservative advance width of a monospace glyph, in em

/**
 * Monospace code on a contrasting panel. One docs block per source line so
 * newlines (and blank lines) are preserved exactly; tabs become 2 spaces.
 * The panel height is computed from the line count, and the builder throws if
 * the code would not fit the width (no wrapping) or run past the footer.
 */
export function codeBlock(
  code: string,
  opts: CodeBlockOptions = {},
): Element[] {
  const fontSize = opts.fontSize ?? 28;
  const lines = code
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/\n$/, '')
    .split('\n');
  const x = opts.x ?? MARGIN;
  const y = opts.y ?? 260;
  const w = opts.w ?? CONTENT_W;
  const h = Math.ceil(lines.length * fontSize * CODE_LINE + CODE_PAD * 2);
  const box = { x, y, w, h };
  assertSafe('codeBlock', box);
  const widest = Math.max(...lines.map((l) => l.length));
  if (widest * fontSize * MONO_EM > w - CODE_PAD * 2) {
    throw new Error(
      `codeBlock: longest line (${widest} chars at ${fontSize}px) does not fit ` +
        `${w - CODE_PAD * 2}px; shorten it, widen the panel or lower fontSize`,
    );
  }
  const id = nextId('code', opts.id);
  const panel = shapeEl(
    id,
    'roundRect',
    x,
    y,
    w,
    h,
    rf(opts.panel ?? 'text'),
  ) as { data: Record<string, unknown> };
  panel.data.adjustments = [4000];
  panel.data.text = {
    blocks: lines.map((l) =>
      textBlock(l, {
        fontSize,
        color: opts.color ?? 'background',
        fontFamily: 'Courier New',
        lineHeight: CODE_LINE,
      }),
    ),
    autofit: 'none',
    verticalAnchor: 'middle',
    inset: { left: CODE_PAD, top: CODE_PAD, right: CODE_PAD, bottom: CODE_PAD },
  };
  return [panel as unknown as Element];
}

// --------------------------------------------------------------------------
// table
// --------------------------------------------------------------------------

export type TableOptions = Common & {
  x?: number;
  y?: number;
  w?: number;
  fontSize?: number;
  /**
   * Explicit column widths in slide px — not fractions — summing to ≤ the
   * content measure; each at least `2 × fontSize`.
   */
  columnWidths?: number[];
};

/**
 * A native slides `table` element from a header row and data rows.
 *
 * Header cells are bold on an accent fill, body rows are banded and ruled.
 * Raggedness is repaired: the column count is the widest of the header and
 * every row, short rows are padded with empty cells, and an empty header list
 * yields a header-less table. Cells are stringified. Row heights are fixed
 * minimums derived from `fontSize` and `frame.h` is their sum (the model's
 * frame-sync invariant); a table whose height reaches the footer throws.
 * Cell text wraps in the renderer and the table grows with it, so keep cell
 * text short relative to column width.
 */
export function table(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
  opts: TableOptions = {},
): Element[] {
  const cols = Math.max(headers.length, ...rows.map((r) => r.length));
  if (cols === 0) throw new Error('table: needs at least one column');
  const fontSize = opts.fontSize ?? 28;
  const rowH = Math.round(fontSize * 1.5 + 24);
  const x = opts.x ?? MARGIN;
  const y = opts.y ?? 260;
  const colW = opts.columnWidths
    ? Array.from({ length: cols }, (_, i) => opts.columnWidths![i] ?? 0)
    : Array.from({ length: cols }, () =>
        Math.floor((opts.w ?? CONTENT_W) / cols),
      );
  if (colW.some((c) => !(c > 0)))
    throw new Error('table: every column needs a positive width');
  // Widths are slide px. A column narrower than two glyphs wraps every cell
  // one character per line and the renderer grows the table off the slide —
  // which the linter cannot see, since it judges the declared frame. Fractions
  // (`[0.3, 0.7]`) are the usual way to get here.
  const minCol = fontSize * 2;
  if (colW.some((c) => c < minCol))
    throw new Error(
      `table: columnWidths are slide px; every column needs at least ${minCol}px at fontSize ${fontSize} (got ${colW.join(', ')})`,
    );
  const w = colW.reduce((a, b) => a + b, 0);
  const hasHeader = headers.length > 0;
  const h = rowH * (rows.length + (hasHeader ? 1 : 0));
  assertSafe('table', { x, y, w, h });

  const border = { color: role('textSecondary'), width: 1 };
  const mkCell = (text: string, header: boolean, band: boolean) => ({
    body: {
      blocks: [
        textBlock(text, {
          fontSize,
          bold: header,
          color: header ? 'background' : 'text',
        }),
      ],
    },
    style: {
      fill: header
        ? role('accent1')
        : band
          ? role('backgroundAlt')
          : role('background'),
      border: { top: border, right: border, bottom: border, left: border },
      padding: { top: 8, right: 16, bottom: 8, left: 16 },
      verticalAlign: 'middle' as const,
    },
  });
  const pad = <T>(arr: readonly T[], fill: T): T[] =>
    Array.from({ length: cols }, (_, i) => (i < arr.length ? arr[i] : fill));

  const trs: Array<{ height: number; cells: ReturnType<typeof mkCell>[] }> = [];
  if (hasHeader) {
    trs.push({
      height: rowH,
      cells: pad(headers, '').map((t) => mkCell(String(t), true, false)),
    });
  }
  rows.forEach((r, i) => {
    trs.push({
      height: rowH,
      cells: pad(r, '').map((t) => mkCell(String(t), false, i % 2 === 1)),
    });
  });
  return [
    {
      id: nextId('table', opts.id),
      type: 'table',
      frame: frame(x, y, w, h),
      data: { columnWidths: colW, rows: trs },
    } as unknown as Element,
  ];
}

// --------------------------------------------------------------------------
// bigNumberCard
// --------------------------------------------------------------------------

export type BigNumberCardOptions = Common & {
  /** Default 520x320 at the margin, y=260. */
  box?: Partial<Box>;
  accent?: string;
};

/**
 * A KPI card: a big accent-coloured figure over a smaller label, centred in a
 * rounded card with an accent bar across its top. `number` is a string so the
 * caller controls formatting ("98%", "$4.2M", "12x").
 */
export function bigNumberCard(
  number: string,
  label: string,
  opts: BigNumberCardOptions = {},
): Element[] {
  const box: Box = { x: MARGIN, y: 260, w: 520, h: 320, ...opts.box };
  assertSafe('bigNumberCard', box);
  const accent = opts.accent ?? 'accent1';
  // Scale the figure down for long strings so it stays inside the card.
  const numSize = Math.max(
    56,
    Math.min(
      128,
      Math.floor((box.w - 80) / (Math.max(number.length, 1) * 0.62)),
    ),
  );
  const id = nextId('kpi', opts.id);
  const card = shapeEl(
    id,
    'roundRect',
    box.x,
    box.y,
    box.w,
    box.h,
    rf('backgroundAlt'),
  ) as {
    data: Record<string, unknown>;
  };
  card.data.adjustments = [6000];
  card.data.text = {
    blocks: [
      textBlock(number, {
        fontSize: numSize,
        bold: true,
        color: accent,
        align: 'center',
        lineHeight: 1.1,
        marginBottom: 12,
      }),
      textBlock(label, {
        fontSize: 30,
        color: 'textSecondary',
        align: 'center',
        lineHeight: 1.25,
      }),
    ],
    autofit: 'none',
    verticalAnchor: 'middle',
    inset: { left: 32, top: 40, right: 32, bottom: 24 },
  };
  return [
    card as unknown as Element,
    shapeEl(
      `${id}-bar`,
      'rect',
      box.x,
      box.y,
      box.w,
      12,
      rf(accent),
    ) as Element,
  ];
}

// --------------------------------------------------------------------------
// footer
// --------------------------------------------------------------------------

export type FooterOptions = Common & {
  /** Right-aligned secondary text, e.g. a page label. */
  right?: string;
};

/**
 * A footer: hairline rule plus a small caption (and optional right-aligned
 * label) in the band below `FOOTER_TOP`, the only place the other builders
 * leave free. Spans the content measure.
 */
export function footer(text: string, opts: FooterOptions = {}): Element[] {
  const id = nextId('footer', opts.id);
  const y = FOOTER_TOP + 16;
  const h = 40;
  const rule = shapeEl(`${id}-rule`, 'rect', MARGIN, FOOTER_TOP, CONTENT_W, 2, {
    ...rf('textSecondary'),
    alpha: 0.4,
  } as unknown as Fill) as Element;
  const leftW = opts.right ? Math.floor(CONTENT_W * 0.7) : CONTENT_W;
  const out: Element[] = [
    rule,
    textEl(
      `${id}-text`,
      { x: MARGIN, y, w: leftW, h },
      [textBlock(text, { fontSize: 22, color: 'textSecondary' })],
      'middle',
    ),
  ];
  if (opts.right) {
    const rw = CONTENT_W - leftW;
    out.push(
      textEl(
        `${id}-right`,
        { x: MARGIN + leftW, y, w: rw, h },
        [
          textBlock(opts.right, {
            fontSize: 22,
            color: 'textSecondary',
            align: 'right',
          }),
        ],
        'middle',
      ),
    );
  }
  return out;
}

// --------------------------------------------------------------------------
// diagram
// --------------------------------------------------------------------------

export type DiagramOptions = Common & {
  /**
   * Reference to the already-uploaded image (URL or asset id the slides image
   * element can load). Omit to embed the SVG itself as a `data:` URI —
   * fine for small diagrams, but large ones should be uploaded.
   */
  src?: string;
  alt?: string;
  /** Area the diagram is fitted (contain, centred) into. Default: content area. */
  box?: Partial<Box>;
};

/** Intrinsic width/height of an SVG, from `viewBox` or `width`/`height`. */
export function svgIntrinsicSize(svg: string): { w: number; h: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!tag) return null;
  // Take the attribute value and split it, rather than matching the four
  // numbers in one pattern: simpler, and no backtracking on a crafted tag.
  const vb = /\bviewBox\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
  const parts = vb?.trim().split(/[\s,]+/).map(Number);
  if (parts?.length === 4 && parts[2] > 0 && parts[3] > 0)
    return { w: parts[2], h: parts[3] };
  const w = /\swidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(tag);
  const h = /\sheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(tag);
  if (w && h && Number(w[1]) > 0 && Number(h[1]) > 0)
    return { w: Number(w[1]), h: Number(h[1]) };
  return null;
}

/** `data:image/svg+xml;base64,…` URI for an SVG string (pure, no I/O). */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/**
 * An SVG diagram as a native `image` element, fitted (aspect preserved) and
 * centred inside `box`.
 *
 * Builders are pure data, so this never uploads. Two flows:
 *  1. Upload first (preferred for anything non-trivial): rasterise/upload the
 *     SVG with the CLI (`wafflebase images upload <file>`), then pass the
 *     returned reference as `opts.src`.
 *  2. Omit `src` and the SVG is embedded as a base64 `data:` URI.
 * Either way the `svg` text supplies the intrinsic aspect ratio (viewBox, or
 * width/height); one without either is rejected.
 */
export function diagram(svg: string, opts: DiagramOptions = {}): Element[] {
  const size = svgIntrinsicSize(svg);
  if (!size) {
    throw new Error('diagram: svg needs a viewBox or width/height to fit it');
  }
  const box: Box = {
    x: MARGIN,
    y: 260,
    w: CONTENT_W,
    h: FOOTER_TOP - 260 - 24,
    ...opts.box,
  };
  assertSafe('diagram', box);
  const scale = Math.min(box.w / size.w, box.h / size.h);
  const w = Math.round(size.w * scale);
  const h = Math.round(size.h * scale);
  const x = box.x + Math.round((box.w - w) / 2);
  const y = box.y + Math.round((box.h - h) / 2);
  return [
    {
      id: nextId('diagram', opts.id),
      type: 'image',
      frame: frame(x, y, w, h),
      data: {
        src: opts.src ?? svgDataUri(svg),
        ...(opts.alt ? { alt: opts.alt } : {}),
      },
    } as unknown as Element,
  ];
}

import {
  SHAPE_TEXT_RECT_FRACTIONS,
  computeConnectorFrame,
  connectionSitesForKind,
  estimateMeasurer,
} from '@wafflebase/slides';
import type {
  ChartKind,
  ColorRole,
  ConnectorElement,
  ConnectorRouting,
  Element,
  FreeformCommand,
  ShapeKind,
} from '@wafflebase/slides';
import type { SlidesSlide } from '../../yorkie/yorkie.types';
import { DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import type { Block, ResolvedFont } from '@wafflebase/docs';
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
 * Units: frames are slide px, but `fontSize` is in POINTS — the docs layout
 * engine paints it at `pt × 96/72` px. Every fit check below measures in px
 * through {@link textWidthPx} (the linter's own font-free estimate), which
 * is why a 28pt line is ~52px tall at lineHeight 1.4, not 39px.
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

const role = (r: ColorRole) => ({ kind: 'role' as const, role: r });

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
  color?: ColorRole; // theme role
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
// Text measurement (shared by the fit rules)
// --------------------------------------------------------------------------

/** Docs font sizes are points; the layout engine paints `pt × 96/72` px. */
export const PX_PER_PT = 96 / 72;

const measurer = estimateMeasurer();

/**
 * Estimated rendered width in slide px of `text` at `pt` points — the same
 * font-free estimate `wafflebase slides lint` uses (Hangul at 0.95 em, bold
 * +5%) plus an 8% margin, so text that passes here does not wrap on screen.
 */
export function textWidthPx(text: string, pt: number, bold = false): number {
  const font = {
    family: 'sans-serif',
    size: pt * PX_PER_PT,
    weight: bold ? 'bold' : 'normal',
    style: 'normal',
  } as ResolvedFont;
  // The estimate's per-class widths are averages, and a word heavy in wide
  // Latin glyphs (m, w, W) runs ~6% past them; the margin keeps "fits"
  // meaning fits on screen.
  return measurer.measureWidth(text, font) * TEXT_SAFETY;
}

const TEXT_SAFETY = 1.08;

/** Greedy word wrap at `maxW` px; null when one word alone is too wide. */
function wrapWords(
  text: string,
  pt: number,
  bold: boolean,
  maxW: number,
): string[] | null {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (textWidthPx(word, pt, bold) > maxW) return null;
      const next = line ? `${line} ${word}` : word;
      if (textWidthPx(next, pt, bold) <= maxW) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Largest size in `[minPt, maxPt]` (2pt steps) at which `text` word-wraps
 * into a `w × h` px box; null when even `minPt` does not fit.
 */
function fitText(
  text: string,
  o: {
    w: number;
    h: number;
    maxPt: number;
    minPt: number;
    bold?: boolean;
    lineHeight: number;
  },
): { pt: number; lines: number } | null {
  for (let pt = o.maxPt; pt >= o.minPt; pt -= 2) {
    const lines = wrapWords(text, pt, !!o.bold, o.w);
    if (lines && lines.length * pt * PX_PER_PT * o.lineHeight <= o.h)
      return { pt, lines: lines.length };
  }
  return null;
}

/**
 * The px box a shape of `kind` lays its text in, mirroring the renderer's
 * `shapeTextInset`: the OOXML preset text rectangle (a roundRect insets ~5%
 * of its width, a diamond 25%) plus the body's own inset.
 */
function shapeTextBox(
  kind: ShapeKind,
  w: number,
  h: number,
  inset: { left: number; top: number; right: number; bottom: number },
): { w: number; h: number } {
  const r = SHAPE_TEXT_RECT_FRACTIONS[kind] ?? { l: 0, t: 0, r: 1, b: 1 };
  return {
    w: (r.r - r.l) * w - inset.left - inset.right,
    h: (r.b - r.t) * h - inset.top - inset.bottom,
  };
}

const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/;

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
  color?: ColorRole;
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
  fill?: ColorRole;
  /** Accent role for the title (default accent1). */
  accent?: ColorRole;
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
  /**
   * Monospace family. Default `Courier New`, or `Nanum Gothic Coding` (a
   * catalogue web font: monospace with Hangul glyphs) when the code
   * contains Hangul — Courier has none, and the renderer deliberately adds
   * no Korean fallback to monospace chains.
   */
  fontFamily?: string;
  /** Panel fill role (default `text`, i.e. dark on light themes). */
  panel?: ColorRole;
  /** Code colour role (default `background`, contrasting the panel). */
  color?: ColorRole;
};

const CODE_PAD = 36;
const CODE_LINE = 1.4;
/** Advance of a monospace glyph in em (Courier New: 0.6; Hangul: 1.0). */
const MONO_EM = 0.6;
const WIDE_EM = 1.0;
const WIDE_CHAR =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60]/;

/** Rendered width of a code line in em: wide (CJK) glyphs take a full em. */
function monoEms(line: string): number {
  let ems = 0;
  for (const ch of line) ems += WIDE_CHAR.test(ch) ? WIDE_EM : MONO_EM;
  return ems;
}

/**
 * Monospace code on a contrasting panel. One docs block per source line so
 * newlines (and blank lines) are preserved exactly; tabs become 2 spaces.
 * The panel height is computed from the line count (in px: `fontSize` is
 * points), and the builder throws if the code would not fit the width (no
 * wrapping) or run past the footer.
 */
export function codeBlock(
  code: string,
  opts: CodeBlockOptions = {},
): Element[] {
  const fontSize = opts.fontSize ?? 28;
  const px = fontSize * PX_PER_PT;
  const lines = code
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/\n$/, '')
    .split('\n');
  const fontFamily =
    opts.fontFamily ??
    (HANGUL.test(code) ? 'Nanum Gothic Coding' : 'Courier New');
  const x = opts.x ?? MARGIN;
  const y = opts.y ?? 260;
  const w = opts.w ?? CONTENT_W;
  // The roundRect lays text inside its preset text rectangle, which insets
  // a few % of the frame on each side; size the frame so that rectangle
  // holds the lines plus the padding.
  const rect = SHAPE_TEXT_RECT_FRACTIONS.roundRect ?? {
    l: 0,
    t: 0,
    r: 1,
    b: 1,
  };
  const textH = lines.length * px * CODE_LINE;
  const h = Math.ceil((textH + CODE_PAD * 2) / (rect.b - rect.t));
  const box = { x, y, w, h };
  assertSafe('codeBlock', box);
  const pads = {
    left: CODE_PAD,
    top: CODE_PAD,
    right: CODE_PAD,
    bottom: CODE_PAD,
  };
  const avail = shapeTextBox('roundRect', w, h, pads).w;
  const widest = lines.reduce((a, l) => (monoEms(l) > monoEms(a) ? l : a), '');
  if (monoEms(widest) * px > avail) {
    throw new Error(
      `codeBlock: longest line (${widest.length} chars at ${fontSize}pt) does not fit ` +
        `${Math.floor(avail)}px; shorten it, widen the panel or lower fontSize`,
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
        fontFamily,
        lineHeight: CODE_LINE,
      }),
    ),
    autofit: 'none',
    verticalAnchor: 'middle',
    inset: pads,
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
  accent?: ColorRole;
};

const BIG_NUMBER_INSET = { left: 32, top: 40, right: 32, bottom: 24 };
const BIG_NUMBER_MAX_PT = 128;
const BIG_NUMBER_MIN_PT = 32;

/**
 * A KPI card: a big accent-coloured figure over a smaller label, centred in a
 * rounded card with an accent bar across its top. `number` is a string so the
 * caller controls formatting ("98%", "$4.2M", "12x", "87건"). The figure is
 * sized (128pt down to 32pt) to stay on one line; the builder throws when it
 * cannot.
 */
export function bigNumberCard(
  number: string,
  label: string,
  opts: BigNumberCardOptions = {},
): Element[] {
  const box: Box = { x: MARGIN, y: 260, w: 520, h: 320, ...opts.box };
  assertSafe('bigNumberCard', box);
  const accent = opts.accent ?? 'accent1';
  // Size the figure so it fits the card's text box on ONE line. The width
  // is estimated in px (font sizes are points) with the linter's measurer,
  // so a figure with a unit attached — "87건", "4.2M" — keeps the unit on
  // the number's line: a CJK unit may otherwise break onto its own line
  // (CJK text breaks between any two characters).
  // The label's height comes off the top: the two lines share the card.
  const inner = shapeTextBox('roundRect', box.w, box.h, BIG_NUMBER_INSET);
  const labelLines = wrapWords(label, 30, false, inner.w)?.length ?? 2;
  const numberH = inner.h - labelLines * 30 * PX_PER_PT * 1.25 - 12;
  let numSize = 0;
  for (let pt = BIG_NUMBER_MAX_PT; pt >= BIG_NUMBER_MIN_PT; pt -= 2) {
    if (
      textWidthPx(number, pt, true) <= inner.w &&
      pt * PX_PER_PT * 1.1 <= numberH
    ) {
      numSize = pt;
      break;
    }
  }
  if (!numSize) {
    throw new Error(
      `bigNumberCard: "${number}" does not fit a ${box.w}x${box.h}px card on one line ` +
        `even at ${BIG_NUMBER_MIN_PT}pt; widen the card or shorten the figure`,
    );
  }
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
    inset: BIG_NUMBER_INSET,
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
  const parts = vb
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    parts?.length === 4 &&
    parts.every(Number.isFinite) &&
    parts[2] > 0 &&
    parts[3] > 0
  )
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

// --------------------------------------------------------------------------
// flow
// --------------------------------------------------------------------------

/**
 * Node shapes `flow` draws. Kept to kinds whose connection sites sit on the
 * silhouette (the bbox midpoints, or the ellipse's own eight), so an
 * attached arrow touches the outline rather than stopping short of it.
 * `can` reads as a database, `ellipse` as a start/end terminal, `diamond`
 * as a decision.
 */
export type FlowShape =
  | 'roundRect'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'can'
  | 'hexagon';

export type FlowNode =
  | string
  | {
      label: string;
      shape?: FlowShape;
      /** Fill role (default backgroundAlt; an accent / `text` fill gets light text). */
      fill?: ColorRole;
      /** Position along the flow (default: the node's index). */
      step?: number;
      /** Parallel track across the flow (default 0), for branches. */
      lane?: number;
    };

/** `[from, to]` node indices, or an object for a dashed edge. */
export type FlowEdge =
  | readonly [number, number]
  | { from: number; to: number; dashed?: boolean };

export type FlowOptions = Common & {
  /** Area the diagram is laid out in. Default: the content area. */
  box?: Partial<Box>;
  /** `row` (default) flows left → right; `column` flows top → bottom. */
  direction?: 'row' | 'column';
  /** Gap between steps along the flow, in px (default 96 — the arrows). */
  gap?: number;
  /** Gap between lanes, in px (default 64). */
  laneGap?: number;
  /** Node size cap in px (default 420x200 for row, 560x150 for column). */
  node?: { w?: number; h?: number };
  /** Label size in pt (default 28); shrinks to `minFontSize` to fit. */
  fontSize?: number;
  /** Smallest label size before the builder throws (default 18). */
  minFontSize?: number;
  /** Node outline / arrow colour (defaults accent1 / textSecondary). */
  accent?: ColorRole;
  line?: ColorRole;
};

type FlowNodeSpec = Exclude<FlowNode, string>;

const LIGHT_TEXT_FILLS: ReadonlySet<ColorRole> = new Set<ColorRole>([
  'text',
  'textSecondary',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
]);

const FLOW_TEXT_INSET = { left: 16, top: 12, right: 16, bottom: 12 };

const DIR_ANGLE = {
  E: 0,
  S: Math.PI / 2,
  W: Math.PI,
  N: -Math.PI / 2,
} as const;

/** A {@link FlowEdge} in its object form. */
function edgeOf(e: FlowEdge): { from: number; to: number; dashed: boolean } {
  if (Array.isArray(e)) {
    const [from, to] = e as readonly [number, number];
    return { from, to, dashed: false };
  }
  const o = e as { from: number; to: number; dashed?: boolean };
  return { from: o.from, to: o.to, dashed: !!o.dashed };
}

/** Index of the shape's connection site whose outward normal best matches. */
function siteFacing(kind: ShapeKind, angle: number): number {
  const sites = connectionSitesForKind(kind);
  let best = 0;
  let bestD = Infinity;
  sites.forEach((s, i) => {
    const d = Math.abs(
      Math.atan2(Math.sin(s.angle - angle), Math.cos(s.angle - angle)),
    );
    if (d < bestD - 1e-9) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * A boxes-and-arrows flow or architecture diagram from native shapes and
 * connectors, laid out on a grid inside `box`: `step` runs along the flow
 * (`direction`), `lane` across it, so a branch is a node on lane 1.
 * `edges` default to the sequence `0→1→2…`.
 *
 * Every connector is ATTACHED to its two shapes (moving a box in the editor
 * drags its arrows along) and exits from the side facing the target: same
 * lane → a straight arrow; another lane → an elbow; a skip or backward edge
 * on one lane → an elbow looping over the nodes between. Labels are sized
 * down from `fontSize` until they word-wrap inside their node, and the
 * builder throws when one still does not fit at `minFontSize`, or when the
 * grid leaves a node too small to hold text.
 *
 * Paint order: connectors first, then nodes, so a line never crosses a box.
 * In PPTX the nodes export as native shapes and the arrows as `<p:cxnSp>`
 * lines (exported free-standing, not glued to the shapes; elbows become
 * `bentConnector3`, so a looping elbow straightens into a Z).
 */
export function flow(
  nodes: readonly FlowNode[],
  edges?: readonly FlowEdge[],
  opts: FlowOptions = {},
): Element[] {
  if (nodes.length === 0) throw new Error('flow: needs at least one node');
  const box: Box = {
    x: MARGIN,
    y: 260,
    w: CONTENT_W,
    h: FOOTER_TOP - 260 - 24,
    ...opts.box,
  };
  assertSafe('flow', box);
  const row = (opts.direction ?? 'row') === 'row';
  const specs: FlowNodeSpec[] = nodes.map((n, i) => {
    const spec = typeof n === 'string' ? { label: n } : n;
    const step = spec.step ?? i;
    const lane = spec.lane ?? 0;
    if (![step, lane].every((v) => Number.isInteger(v) && v >= 0))
      throw new Error(
        `flow: node ${i} needs a non-negative integer step and lane`,
      );
    return { ...spec, step, lane };
  });
  const seen = new Set<string>();
  for (const [i, n] of specs.entries()) {
    const key = `${n.step}:${n.lane}`;
    if (seen.has(key))
      throw new Error(
        `flow: node ${i} shares step ${n.step}, lane ${n.lane} with another node`,
      );
    seen.add(key);
  }
  const steps = Math.max(...specs.map((n) => n.step!)) + 1;
  const lanes = Math.max(...specs.map((n) => n.lane!)) + 1;
  const gap = opts.gap ?? 96;
  const laneGap = opts.laneGap ?? 64;
  const mainLen = row ? box.w : box.h;
  const crossLen = row ? box.h : box.w;
  const slotMain = (mainLen - gap * (steps - 1)) / steps;
  const slotCross = (crossLen - laneGap * (lanes - 1)) / lanes;
  const cap = row
    ? { w: opts.node?.w ?? 420, h: opts.node?.h ?? 200 }
    : { w: opts.node?.w ?? 560, h: opts.node?.h ?? 150 };
  const nodeW = Math.floor(Math.min(row ? slotMain : slotCross, cap.w));
  const nodeH = Math.floor(Math.min(row ? slotCross : slotMain, cap.h));
  if (nodeW < 120 || nodeH < 72) {
    throw new Error(
      `flow: ${steps} steps × ${lanes} lanes leave ${nodeW}x${nodeH}px nodes in a ` +
        `${box.w}x${box.h} box (need ≥ 120x72); use fewer nodes, a bigger box or smaller gaps`,
    );
  }
  // Centre the used grid in the box on the cross axis; steps keep their slots.
  const usedCross = lanes * (row ? nodeH : nodeW) + laneGap * (lanes - 1);
  const crossStart = (row ? box.y : box.x) + (crossLen - usedCross) / 2;
  const mainStart = row ? box.x : box.y;

  const id = nextId('flow', opts.id);
  const fontSize = opts.fontSize ?? 28;
  const minFont = opts.minFontSize ?? 18;
  const accent = opts.accent ?? 'accent1';
  const shapes = specs.map((n, i) => {
    const kind: ShapeKind = n.shape ?? 'roundRect';
    const mainC = mainStart + n.step! * (slotMain + gap) + slotMain / 2;
    const crossC =
      crossStart +
      n.lane! * ((row ? nodeH : nodeW) + laneGap) +
      (row ? nodeH : nodeW) / 2;
    const cx = row ? mainC : crossC;
    const cy = row ? crossC : mainC;
    const x = Math.round(cx - nodeW / 2);
    const y = Math.round(cy - nodeH / 2);
    const tb = shapeTextBox(kind, nodeW, nodeH, FLOW_TEXT_INSET);
    const fit = fitText(n.label, {
      w: tb.w,
      h: tb.h,
      maxPt: fontSize,
      minPt: minFont,
      bold: true,
      lineHeight: 1.2,
    });
    if (!fit) {
      throw new Error(
        `flow: label "${n.label}" does not fit its ${nodeW}x${nodeH}px ${kind} even at ` +
          `${minFont}pt; shorten it, use fewer nodes or a bigger box`,
      );
    }
    const fill = n.fill ?? 'backgroundAlt';
    const el = shapeEl(`${id}-n${i}`, kind, x, y, nodeW, nodeH, rf(fill)) as {
      data: Record<string, unknown>;
    };
    if (kind === 'roundRect') el.data.adjustments = [12000];
    el.data.stroke = { color: role(accent), width: 3 };
    el.data.text = {
      blocks: n.label.split('\n').map((l) =>
        textBlock(l, {
          fontSize: fit.pt,
          bold: true,
          align: 'center',
          lineHeight: 1.2,
          color: LIGHT_TEXT_FILLS.has(fill) ? 'background' : 'text',
        }),
      ),
      autofit: 'none',
      verticalAnchor: 'middle',
      inset: FLOW_TEXT_INSET,
    };
    return el as unknown as Element;
  });

  const lookup = new Map<string, Element>(shapes.map((s) => [s.id, s]));
  const list: FlowEdge[] = edges
    ? [...edges]
    : specs.slice(1).map((_, i) => [i, i + 1] as const);
  const connectors = list.map((e, k): Element => {
    const { from, to, dashed } = edgeOf(e);
    if (
      ![from, to].every(
        (v) => Number.isInteger(v) && v >= 0 && v < specs.length,
      ) ||
      from === to
    )
      throw new Error(
        `flow: edge ${k} (${from} → ${to}) must join two different node indices`,
      );
    const a = specs[from];
    const b = specs[to];
    const ds = b.step! - a.step!;
    const dl = b.lane! - a.lane!;
    // Sides in flow terms, mapped to compass sides by `direction`: `fwd`
    // points down the flow, `outer` is the side of the outermost lane.
    const fwd = row ? 'E' : 'S';
    const back = row ? 'W' : 'N';
    const inner = row ? 'N' : 'W';
    const outerSide = row ? 'S' : 'E';
    let exit: keyof typeof DIR_ANGLE;
    let entry: keyof typeof DIR_ANGLE;
    let routing: ConnectorRouting = 'straight';
    let bend: number | undefined;
    if (dl === 0 && ds === 1) {
      exit = fwd;
      entry = back;
    } else if (ds === 0) {
      // Same step, another lane: straight across.
      exit = dl > 0 ? outerSide : inner;
      entry = dl > 0 ? inner : outerSide;
    } else if (ds > 0) {
      // Forward to another lane, or a skip on one lane: an elbow whose bend
      // sits in the gap just before the target, clear of the nodes between.
      exit = fwd;
      entry = back;
      routing = 'elbow';
      if (dl === 0) {
        const loop = a.lane === lanes - 1 && lanes > 1 ? outerSide : inner;
        exit = loop;
        entry = loop;
      } else {
        const nodeMain = row ? nodeW : nodeH;
        const span = ds * (slotMain + gap) - nodeMain;
        const realGap = slotMain + gap - nodeMain;
        bend = (span - realGap / 2) / span;
      }
    } else {
      // Backward: loop around the outside of the grid (above / left of lane
      // 0, or below / right of the last lane), never through the nodes.
      const loop =
        Math.max(a.lane!, b.lane!) === lanes - 1 && lanes > 1
          ? outerSide
          : inner;
      exit = loop;
      entry = loop;
      routing = 'elbow';
    }
    const kindOf = (n: FlowNodeSpec): ShapeKind => n.shape ?? 'roundRect';
    const c = {
      id: `${id}-e${k}`,
      type: 'connector',
      frame: frame(0, 0, 0, 0),
      routing,
      start: {
        kind: 'attached',
        elementId: shapes[from].id,
        siteIndex: siteFacing(kindOf(a), DIR_ANGLE[exit]),
      },
      end: {
        kind: 'attached',
        elementId: shapes[to].id,
        siteIndex: siteFacing(kindOf(b), DIR_ANGLE[entry]),
      },
      ...(bend !== undefined && Number.isFinite(bend)
        ? { elbowBend: bend }
        : {}),
      arrowheads: { end: { kind: 'triangle', size: 'lg' } },
      stroke: {
        color: role(opts.line ?? 'textSecondary'),
        width: 3,
        ...(dashed ? { dash: 'dashed' } : {}),
      },
    } as unknown as ConnectorElement;
    const f = computeConnectorFrame(c, lookup);
    c.frame = {
      x: Math.round(f.x * 100) / 100,
      y: Math.round(f.y * 100) / 100,
      w: Math.round(f.w * 100) / 100,
      h: Math.round(f.h * 100) / 100,
      rotation: 0,
    };
    return c as unknown as Element;
  });

  const out = [...connectors, ...shapes];
  // A looping elbow can leave the box; it still has to stay on the slide.
  const all = frameOf(out);
  assertSafe('flow', {
    x: Math.floor(all.x),
    y: Math.floor(all.y),
    w: Math.ceil(all.w),
    h: Math.ceil(all.h),
  });
  return out;
}

// --------------------------------------------------------------------------
// chart
// --------------------------------------------------------------------------

export type ChartSeriesInput = {
  name?: string;
  values: ReadonlyArray<number | null>;
  /** Theme role (default accent1, accent2, … by series index). */
  color?: ColorRole;
};

export type ChartOptions = Common & {
  /** Default: the content area. */
  box?: Partial<Box>;
  title?: string;
  /** Show a legend (default: when there is more than one series). */
  legend?: boolean;
  /** Value labels on the bars / points (default: single-series charts). */
  valueLabels?: boolean;
  /** Tick and value label formatter (default: thousands separators). */
  format?: (v: number) => string;
  /** Label size in pt (default 20). */
  fontSize?: number;
  /**
   * Emit the native `chart` element instead of shapes. It paints in the app,
   * the thumbnails and PDF export, but the PPTX exporter DROPS chart elements
   * (chart serialization is not implemented), so a deck bound for PowerPoint
   * should keep the default.
   */
  native?: boolean;
};

const SERIES_ROLES: readonly ColorRole[] = [
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
];

/** A "nice" axis step (1, 2, 2.5, 5 × 10^n) for about `ticks` intervals. */
function niceStep(max: number, ticks: number): number {
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

const defaultFormat = (v: number): string =>
  Number.isInteger(v)
    ? v.toLocaleString('en-US')
    : v.toLocaleString('en-US', { maximumFractionDigits: 2 });

/**
 * A bar / column / line chart.
 *
 * By default it is drawn from NATIVE SHAPES — bars are rects, a line series
 * is a stroked freeform path with point markers, labels are text boxes —
 * because the PPTX exporter skips `chart` elements: shapes survive every
 * export path (app, PDF, PPTX) and stay editable. `native: true` emits the
 * model's `ChartElement` instead (in-app + PDF only; see the option).
 *
 * The value axis starts at 0 with "nice" ticks; negative values throw (use
 * `native: true` or a table). Every series must have one value per
 * category. Category labels shrink to fit their slot down to 14pt, then the
 * builder throws.
 */
export function chart(
  kind: Extract<ChartKind, 'bar' | 'column' | 'line'>,
  categories: readonly string[],
  series: readonly ChartSeriesInput[],
  opts: ChartOptions = {},
): Element[] {
  const box: Box = {
    x: MARGIN,
    y: 260,
    w: CONTENT_W,
    h: FOOTER_TOP - 260 - 24,
    ...opts.box,
  };
  assertSafe('chart', box);
  if (!['bar', 'column', 'line'].includes(kind))
    throw new Error(
      `chart: kind must be bar, column or line (got ${String(kind)})`,
    );
  if (categories.length === 0 || series.length === 0)
    throw new Error('chart: needs at least one category and one series');
  series.forEach((s, i) => {
    if (s.values.length !== categories.length)
      throw new Error(
        `chart: series ${i} has ${s.values.length} values for ${categories.length} categories`,
      );
    if (s.values.some((v) => v !== null && !Number.isFinite(v)))
      throw new Error(`chart: series ${i} has a non-finite value`);
  });
  const id = nextId('chart', opts.id);
  const showLegend = opts.legend ?? series.length > 1;

  if (opts.native) {
    return [
      {
        id,
        type: 'chart',
        frame: frame(box.x, box.y, box.w, box.h),
        data: {
          kind,
          ...(kind === 'line' ? {} : { grouping: 'clustered' }),
          ...(opts.title ? { title: opts.title } : {}),
          categories: [...categories],
          series: series.map((s, i) => ({
            ...(s.name ? { name: s.name } : {}),
            values: [...s.values],
            color: role(s.color ?? SERIES_ROLES[i % SERIES_ROLES.length]),
          })),
          legend: showLegend ? 'bottom' : 'none',
          showGridlines: true,
        },
      } as unknown as Element,
    ];
  }

  const values = series.flatMap((s) =>
    s.values.filter((v): v is number => v !== null),
  );
  if (values.some((v) => v < 0))
    throw new Error(
      'chart: negative values are not supported in the shape chart; pass native: true',
    );
  const fmt = opts.format ?? defaultFormat;
  const fs = opts.fontSize ?? 20;
  const lineH = fs * PX_PER_PT * 1.3;
  const max = Math.max(...values, 0);
  const step = max > 0 ? niceStep(max, 4) : 1;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = Array.from(
    { length: Math.round(top / step) + 1 },
    (_, i) => i * step,
  );
  const valueLabels = opts.valueLabels ?? series.length === 1;
  const out: Element[] = [];
  let tid = 0;
  const label = (
    text: string,
    b: Box,
    o: {
      align?: 'left' | 'center' | 'right';
      size?: number;
      bold?: boolean;
      color?: ColorRole;
    } = {},
  ) =>
    textEl(
      `${id}-t${tid++}`,
      b,
      [
        textBlock(text, {
          fontSize: o.size ?? fs,
          bold: o.bold,
          align: o.align ?? 'center',
          color: o.color ?? 'textSecondary',
          lineHeight: 1.2,
        }),
      ],
      'middle',
    );

  // Bands: title on top, legend at the bottom, axis labels around the plot.
  let top0 = box.y;
  if (opts.title) {
    const th = Math.ceil(28 * PX_PER_PT * 1.3);
    out.push(
      label(
        opts.title,
        { x: box.x, y: box.y, w: box.w, h: th },
        { size: 28, bold: true, color: 'text', align: 'left' },
      ),
    );
    top0 += th + 16;
  }
  let bottom0 = box.y + box.h;
  const legendH = Math.ceil(lineH);
  if (showLegend) bottom0 -= legendH + 16;

  const horizontal = kind === 'bar';
  const valueAxisLabelW =
    Math.ceil(Math.max(...ticks.map((t) => textWidthPx(fmt(t), fs)))) + 16;
  const catLabelW = horizontal
    ? Math.min(
        Math.floor(box.w * 0.3),
        Math.ceil(Math.max(...categories.map((c) => textWidthPx(c, fs)))) + 24,
      )
    : 0;
  const plot: Box = horizontal
    ? {
        x: box.x + catLabelW,
        y: top0,
        w: box.w - catLabelW - 24,
        h: bottom0 - top0 - Math.ceil(lineH) - 8,
      }
    : {
        x: box.x + valueAxisLabelW,
        y: top0 + (valueLabels ? Math.ceil(lineH) + 16 : 0),
        w: box.w - valueAxisLabelW,
        h: 0,
      };
  if (!horizontal) plot.h = bottom0 - plot.y - Math.ceil(lineH) - 8;
  if (plot.w < 160 || plot.h < 120)
    throw new Error(
      `chart: the ${box.w}x${box.h} box leaves no room for the plot; make it bigger`,
    );

  const n = categories.length;
  const slot = (horizontal ? plot.h : plot.w) / n;
  // Category labels must fit their slot (bars: the left column).
  const catFit = (c: string): number => {
    const room = horizontal ? catLabelW - 24 : slot - 8;
    for (let pt = fs; pt >= 14; pt -= 1)
      if (textWidthPx(c, pt) <= room) return pt;
    throw new Error(
      `chart: category "${c}" does not fit its ${Math.floor(room)}px slot even at 14pt`,
    );
  };
  const catSize = Math.min(...categories.map(catFit));

  // Gridlines + value ticks.
  const hair = (
    x: number,
    y: number,
    w: number,
    h: number,
    alpha: number,
    r: ColorRole = 'textSecondary',
  ) =>
    shapeEl(`${id}-g${tid++}`, 'rect', x, y, w, h, {
      ...rf(r),
      alpha,
    } as unknown as Fill) as Element;
  for (const t of ticks) {
    const f = t / top;
    if (horizontal) {
      const x = plot.x + f * plot.w;
      out.push(
        hair(Math.round(x) - 1, plot.y, 2, plot.h, t === 0 ? 0.8 : 0.25),
      );
      const lw = valueAxisLabelW;
      out.push(
        label(fmt(t), {
          x: Math.round(
            Math.min(Math.max(x - lw / 2, box.x), box.x + box.w - lw),
          ),
          y: plot.y + plot.h + 8,
          w: lw,
          h: Math.ceil(lineH),
        }),
      );
    } else {
      const y = plot.y + plot.h - f * plot.h;
      out.push(
        hair(plot.x, Math.round(y) - 1, plot.w, 2, t === 0 ? 0.8 : 0.25),
      );
      out.push(
        label(
          fmt(t),
          {
            x: box.x,
            y: Math.round(y - lineH / 2),
            w: valueAxisLabelW - 12,
            h: Math.ceil(lineH),
          },
          { align: 'right' },
        ),
      );
    }
  }
  // Category labels.
  categories.forEach((c, i) => {
    const b: Box = horizontal
      ? {
          x: box.x,
          y: Math.round(plot.y + i * slot),
          w: catLabelW - 16,
          h: Math.round(slot),
        }
      : {
          x: Math.round(plot.x + i * slot),
          y: plot.y + plot.h + 8,
          w: Math.round(slot),
          h: Math.ceil(lineH),
        };
    out.push(
      label(c, b, {
        align: horizontal ? 'right' : 'center',
        size: catSize,
        color: 'text',
      }),
    );
  });

  const colorOf = (i: number): ColorRole =>
    series[i].color ?? SERIES_ROLES[i % SERIES_ROLES.length];
  if (kind === 'line') {
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) =>
        v === null
          ? null
          : {
              x: plot.x + (i + 0.5) * slot,
              y: plot.y + plot.h - (v / top) * plot.h,
            },
      );
      const cmds: FreeformCommand[] = [];
      let pen = false;
      for (const p of pts) {
        if (!p) {
          pen = false;
          continue;
        }
        const nx = (p.x - plot.x) / plot.w;
        const ny = (p.y - plot.y) / plot.h;
        cmds.push(pen ? { c: 'L', x: nx, y: ny } : { c: 'M', x: nx, y: ny });
        pen = true;
      }
      if (cmds.length > 1) {
        const line = shapeEl(
          `${id}-s${si}`,
          'freeform',
          plot.x,
          plot.y,
          plot.w,
          plot.h,
          rf(colorOf(si)),
        ) as {
          data: Record<string, unknown>;
        };
        delete line.data.fill;
        line.data.path = { commands: cmds };
        line.data.stroke = { color: role(colorOf(si)), width: 5 };
        out.push(line as unknown as Element);
      }
      pts.forEach((p, i) => {
        if (!p) return;
        const r = 9;
        out.push(
          shapeEl(
            `${id}-s${si}-p${i}`,
            'ellipse',
            Math.round(p.x - r),
            Math.round(p.y - r),
            r * 2,
            r * 2,
            rf(colorOf(si)),
          ) as Element,
        );
        if (valueLabels) {
          const lw = Math.round(slot);
          out.push(
            label(
              fmt(s.values[i]!),
              {
                x: Math.round(p.x - lw / 2),
                y: Math.round(p.y - r - 4 - lineH),
                w: lw,
                h: Math.ceil(lineH),
              },
              { color: 'text' },
            ),
          );
        }
      });
    });
  } else {
    const groupW = slot * 0.7;
    const barW = groupW / series.length;
    series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        if (v === null) return;
        const len = (v / top) * (horizontal ? plot.w : plot.h);
        const off = i * slot + (slot - groupW) / 2 + si * barW;
        const b: Box = horizontal
          ? { x: plot.x, y: plot.y + off, w: len, h: barW }
          : { x: plot.x + off, y: plot.y + plot.h - len, w: barW, h: len };
        const rb = {
          x: Math.round(b.x),
          y: Math.round(b.y),
          w: Math.max(1, Math.round(b.w)),
          h: Math.max(1, Math.round(b.h)),
        };
        if (len > 0)
          out.push(
            shapeEl(
              `${id}-s${si}-b${i}`,
              'rect',
              rb.x,
              rb.y,
              rb.w,
              rb.h,
              rf(colorOf(si)),
            ) as Element,
          );
        if (valueLabels) {
          const text = fmt(v);
          const tw = Math.ceil(textWidthPx(text, fs)) + 8;
          out.push(
            horizontal
              ? label(
                  text,
                  {
                    x: Math.min(rb.x + rb.w + 8, box.x + box.w - tw),
                    y: rb.y,
                    w: tw,
                    h: rb.h,
                  },
                  { align: 'left', color: 'text' },
                )
              : label(
                  text,
                  {
                    x: Math.round(rb.x + rb.w / 2 - Math.max(tw, rb.w) / 2),
                    y: Math.round(rb.y - lineH - 4),
                    w: Math.max(tw, rb.w),
                    h: Math.ceil(lineH),
                  },
                  { color: 'text' },
                ),
          );
        }
      });
    });
  }

  if (showLegend) {
    const sw = 20;
    const items = series.map((s, i) => ({
      name: s.name ?? `Series ${i + 1}`,
      w: sw + 10 + Math.ceil(textWidthPx(s.name ?? `Series ${i + 1}`, fs)) + 8,
    }));
    const total =
      items.reduce((a, it) => a + it.w, 0) + 32 * (items.length - 1);
    let x = Math.round(box.x + (box.w - Math.min(total, box.w)) / 2);
    const y = box.y + box.h - legendH;
    items.forEach((it, i) => {
      out.push(
        shapeEl(
          `${id}-l${i}`,
          'rect',
          x,
          Math.round(y + (legendH - sw) / 2),
          sw,
          sw,
          rf(colorOf(i)),
        ) as Element,
      );
      out.push(
        label(
          it.name,
          { x: x + sw + 10, y, w: it.w - sw - 10, h: legendH },
          { align: 'left', color: 'text' },
        ),
      );
      x += it.w + 32;
    });
  }
  for (const e of out) {
    const f = e.frame;
    assertSafe('chart', {
      x: Math.floor(f.x),
      y: Math.floor(f.y),
      w: Math.max(1, Math.ceil(f.w)),
      h: Math.max(1, Math.ceil(f.h)),
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// icon
// --------------------------------------------------------------------------

/**
 * A pen for a 24×24 icon grid, emitting {@link FreeformCommand}s normalized
 * to [0, 1]. Arcs always start where the pen is (`arcTo` in OOXML is
 * pen-relative), so `arc` moves or lines to its own start first.
 */
class IconPen {
  readonly cmds: FreeformCommand[] = [];
  private at: { x: number; y: number } | null = null;
  M(x: number, y: number): this {
    this.cmds.push({ c: 'M', x: x / 24, y: y / 24 });
    this.at = { x, y };
    return this;
  }
  L(...pts: number[]): this {
    for (let i = 0; i < pts.length; i += 2) {
      this.cmds.push({ c: 'L', x: pts[i] / 24, y: pts[i + 1] / 24 });
      this.at = { x: pts[i], y: pts[i + 1] };
    }
    return this;
  }
  Z(): this {
    this.cmds.push({ c: 'Z' });
    return this;
  }
  /** Arc on centre (cx, cy), radii rx/ry, from `startDeg` sweeping `sweepDeg` (clockwise +). */
  arc(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    startDeg: number,
    sweepDeg: number,
    move = true,
  ): this {
    const s = (startDeg * Math.PI) / 180;
    const sx = cx + rx * Math.cos(s);
    const sy = cy + ry * Math.sin(s);
    const there =
      this.at &&
      Math.abs(this.at.x - sx) < 1e-6 &&
      Math.abs(this.at.y - sy) < 1e-6;
    if (!there) {
      if (move) this.M(sx, sy);
      else this.L(sx, sy);
    }
    const sw = (sweepDeg * Math.PI) / 180;
    this.cmds.push({
      c: 'A',
      cx: cx / 24,
      cy: cy / 24,
      rx: rx / 24,
      ry: ry / 24,
      start: s,
      sweep: sw,
    });
    this.at = { x: cx + rx * Math.cos(s + sw), y: cy + ry * Math.sin(s + sw) };
    return this;
  }
  /**
   * A dot: a tiny closed square whose stroke (round joins) fills it in.
   * A zero-length line would vanish under the butt caps the renderer uses.
   */
  dot(cx: number, cy: number): this {
    const d = 0.3;
    return this.M(cx - d, cy - d)
      .L(cx + d, cy - d, cx + d, cy + d, cx - d, cy + d)
      .Z();
  }
  circle(cx: number, cy: number, r: number): this {
    return this.arc(cx, cy, r, r, 0, 360).Z();
  }
}

/**
 * The bundled icon set: simple, original line drawings on a 24-unit grid
 * (drawn for this file, not copied from an icon pack). Stroked, unfilled.
 */
const ICONS = {
  check: (p: IconPen) => p.M(4.5, 12.5).L(9.5, 17.5, 19.5, 6.5),
  cross: (p: IconPen) => p.M(6, 6).L(18, 18).M(18, 6).L(6, 18),
  warning: (p: IconPen) =>
    p.M(12, 3).L(22, 20.5, 2, 20.5).Z().M(12, 9.5).L(12, 14).dot(12, 17.25),
  info: (p: IconPen) => p.circle(12, 12, 9.5).M(12, 11).L(12, 17).dot(12, 7.5),
  user: (p: IconPen) => p.circle(12, 8, 4).arc(12, 21, 7.5, 7.5, 180, 180),
  users: (p: IconPen) =>
    p
      .circle(8.5, 8.5, 3.5)
      .arc(8.5, 20.5, 6.5, 6.5, 180, 180)
      .circle(17.5, 7, 2.75)
      .arc(17.5, 19, 5, 5, 240, 120),
  code: (p: IconPen) =>
    p
      .M(8, 7)
      .L(3, 12, 8, 17)
      .M(16, 7)
      .L(21, 12, 16, 17)
      .M(13.5, 4.5)
      .L(10.5, 19.5),
  database: (p: IconPen) =>
    p
      .arc(12, 5.5, 8, 3, 0, 360)
      .Z()
      .M(4, 5.5)
      .L(4, 18.5)
      .arc(12, 18.5, 8, 3, 180, -180, false)
      .L(20, 5.5)
      .M(4, 12)
      .arc(12, 12, 8, 3, 180, -180, false),
  server: (p: IconPen) =>
    p
      .M(3, 4)
      .L(21, 4, 21, 11, 3, 11)
      .Z()
      .M(3, 13)
      .L(21, 13, 21, 20, 3, 20)
      .Z()
      .dot(7, 7.5)
      .dot(7, 16.5)
      .M(11, 7.5)
      .L(17, 7.5)
      .M(11, 16.5)
      .L(17, 16.5),
  cloud: (p: IconPen) =>
    p
      .M(7, 19)
      .arc(7, 15, 4, 4, 90, 180)
      .arc(12, 11, 5, 5, 180, 180)
      .arc(17, 15, 4, 4, 270, 180)
      .L(7, 19)
      .Z(),
  document: (p: IconPen) =>
    p
      .M(5, 3)
      .L(14, 3, 19, 8, 19, 21, 5, 21)
      .Z()
      .M(14, 3)
      .L(14, 8, 19, 8)
      .M(8.5, 13)
      .L(15.5, 13)
      .M(8.5, 17)
      .L(15.5, 17),
  chart: (p: IconPen) =>
    p
      .M(3.5, 3.5)
      .L(3.5, 20.5, 20.5, 20.5)
      .M(8, 17)
      .L(8, 12)
      .M(12.5, 17)
      .L(12.5, 7)
      .M(17, 17)
      .L(17, 10),
  'arrow-right': (p: IconPen) =>
    p.M(3.5, 12).L(20, 12).M(13.5, 5.5).L(20, 12, 13.5, 18.5),
  lightbulb: (p: IconPen) =>
    p
      .arc(12, 9.5, 6.5, 6.5, 135, 270)
      .L(15, 17, 9, 17)
      .Z()
      .M(9.5, 19.5)
      .L(14.5, 19.5)
      .M(10.5, 22)
      .L(13.5, 22),
  clock: (p: IconPen) => p.circle(12, 12, 9.5).M(12, 6.5).L(12, 12, 16, 14.5),
  lock: (p: IconPen) =>
    p
      .M(4.5, 11)
      .L(19.5, 11, 19.5, 21, 4.5, 21)
      .Z()
      .M(8, 11)
      .L(8, 7.5)
      .arc(12, 7.5, 4, 4, 180, 180, false)
      .L(16, 11)
      .M(12, 14.5)
      .L(12, 17.5),
} satisfies Record<string, (p: IconPen) => IconPen>;

export type IconName = keyof typeof ICONS;

/** Names of the bundled icons, for discovery (`icon(name)`). */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** Normalized path of a bundled icon (exported for tests). */
export function iconPath(name: IconName): FreeformCommand[] {
  const draw = Object.prototype.hasOwnProperty.call(ICONS, name)
    ? ICONS[name]
    : undefined;
  if (!draw)
    throw new Error(
      `icon: unknown icon "${String(name)}" (have: ${ICON_NAMES.join(', ')})`,
    );
  return draw(new IconPen()).cmds;
}

export type IconOptions = Common & {
  /** Area the (square) icon is centred in. Default 96x96 at the margin, y=260. */
  box?: Partial<Box>;
  /** Stroke colour role (default accent1). */
  color?: ColorRole;
  /**
   * Draw a filled disc behind the icon in this role (the icon then takes
   * 56% of the disc). Pair a light disc (`backgroundAlt`) with an accent
   * icon, or an accent disc with `color: 'background'`.
   */
  background?: ColorRole;
};

/**
 * One of the bundled icons ({@link ICON_NAMES}) as a native `freeform`
 * shape: a stroked vector path coloured by theme role, square, centred in
 * `box`. Being a shape rather than an image, it follows the deck's theme,
 * stays sharp at any size and exports to PPTX as `<a:custGeom>`.
 */
export function icon(name: IconName, opts: IconOptions = {}): Element[] {
  const commands = iconPath(name);
  const box: Box = { x: MARGIN, y: 260, w: 96, h: 96, ...opts.box };
  assertSafe('icon', box);
  const side = Math.floor(Math.min(box.w, box.h));
  if (side < 16)
    throw new Error(`icon: ${side}px is too small to draw an icon`);
  const id = nextId('icon', opts.id);
  const x = Math.round(box.x + (box.w - side) / 2);
  const y = Math.round(box.y + (box.h - side) / 2);
  const out: Element[] = [];
  let s = side;
  let ix = x;
  let iy = y;
  if (opts.background) {
    out.push(
      shapeEl(
        `${id}-bg`,
        'ellipse',
        x,
        y,
        side,
        side,
        rf(opts.background),
      ) as Element,
    );
    s = Math.round(side * 0.56);
    ix = x + Math.round((side - s) / 2);
    iy = y + Math.round((side - s) / 2);
  }
  const color = opts.color ?? 'accent1';
  const el = shapeEl(id, 'freeform', ix, iy, s, s, rf(color)) as {
    data: Record<string, unknown>;
  };
  delete el.data.fill;
  el.data.path = { commands };
  // 2 units on the 24 grid, like the drawings were made for.
  el.data.stroke = {
    color: role(color),
    width: Math.max(1.5, Math.round((s / 12) * 10) / 10),
  };
  el.data.alt = `${name} icon`;
  out.push(el as unknown as Element);
  return out;
}

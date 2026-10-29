import { DEFAULT_INLINE_STYLE, normalizeBlockStyle, type Block } from '@wafflebase/docs';
import { scaleBlocks } from '../../model/autofit.js';
import { DOCS_PX_PER_PT, SLIDE_WIDTH, type SlidesDocument } from '../../model/presentation.js';
import { pxToEmu } from './units.js';

/**
 * Points per inch, and EMU per inch, for the exported page.
 */
const POINTS_PER_INCH = 72;
const EMU_PER_INCH = 914_400;

/**
 * Canvas px per point on the exported page. The 1920-px canvas is written as
 * a fixed 13.333-in page (`units.ts`), so this is always 2 — the scale a
 * PPTX deck is imported at, too.
 */
export const EXPORT_PX_PER_PT = SLIDE_WIDTH / ((pxToEmu(SLIDE_WIDTH) / EMU_PER_INCH) * POINTS_PER_INCH);

/**
 * The deck re-expressed at the exported page's physical scale.
 *
 * Text sizes are stored in points and painted at `meta.pxPerPt` canvas px per
 * point (`deckFontScale`; absent ⇒ the docs canvas's 96 DPI). The exporter
 * writes those points verbatim onto a page that runs at
 * {@link EXPORT_PX_PER_PT}, so a deck authored in wafflebase (no `pxPerPt`)
 * opened in PowerPoint with every run 1.5× too large. This applies the
 * renderer's own `scaleBlocks` — font sizes, paragraph margins, indents and
 * list markers — to every text body by `pxPerPt / EXPORT_PX_PER_PT`, so the
 * file shows what wafflebase painted. A deck imported from PPTX already runs
 * at 2 and is returned unchanged.
 *
 * Returns a copy; the input is not modified.
 */
export function toExportScale(deck: SlidesDocument): SlidesDocument {
  const factor = (deck.meta.pxPerPt ?? DOCS_PX_PER_PT) / EXPORT_PX_PER_PT;
  if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-9) return deck;
  const scaled = structuredClone(deck);
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    // A text body: `{ blocks: Block[] }` (text element data, shape text,
    // table cell body, layout/master placeholder). Speaker notes are a bare
    // `Block[]` on the slide and are not painted on the canvas, so they are
    // left at their authored size.
    if (Array.isArray(o.blocks) && o.blocks.every(isBlock)) {
      // Normalize first, as the renderer does (`prepareBlocksForLayout`):
      // `scaleBlocks` multiplies every margin, so a sparse style would
      // otherwise come out as NaN.
      o.blocks = scaleBlocks(
        (o.blocks as Block[]).map((b) => ({ ...b, style: normalizeBlockStyle(b.style) })),
        factor,
      );
    }
    for (const [k, v] of Object.entries(o)) {
      if (k !== 'blocks' && k !== 'notes') walk(v);
    }
  };
  walk(scaled.slides);
  walk(scaled.layouts);
  walk(scaled.masters);
  scaled.meta = { ...scaled.meta, pxPerPt: EXPORT_PX_PER_PT };
  return scaled;
}

function isBlock(b: unknown): boolean {
  return !!b && typeof b === 'object' && Array.isArray((b as Block).inlines) && !!(b as Block).style;
}

/**
 * The deck with every text run naming the font wafflebase paints it in.
 *
 * A run without `fontFamily` is painted in the docs default
 * (`DEFAULT_INLINE_STYLE.fontFamily`), but exported with no `<a:latin>`, so
 * PowerPoint and Keynote substitute the theme font instead — a different face
 * — and Keynote also drops the bold of such runs. Writing the family the
 * renderer used keeps the face and the weight.
 *
 * Applies to decks authored in wafflebase (no `meta.pxPerPt`) only.
 * Returns a copy when anything changes; the input is not modified.
 */
export function withExplicitFonts(deck: SlidesDocument): SlidesDocument {
  const family = DEFAULT_INLINE_STYLE.fontFamily;
  // Only a deck authored in wafflebase. An imported deck's font-less runs
  // came from a PPTX that inherited its theme font on purpose; naming a
  // family there would change the original, not preserve it.
  if (!family || deck.meta.pxPerPt != null) return deck;
  let changed = false;
  const scaled = structuredClone(deck);
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.blocks) && o.blocks.every(isBlock)) {
      for (const b of o.blocks as Block[]) {
        for (const inl of b.inlines) {
          if (!inl.style.fontFamily) {
            inl.style = { ...inl.style, fontFamily: family };
            changed = true;
          }
        }
      }
    }
    for (const [k, v] of Object.entries(o)) {
      if (k !== 'blocks' && k !== 'notes') walk(v);
    }
  };
  walk(scaled.slides);
  return changed ? scaled : deck;
}

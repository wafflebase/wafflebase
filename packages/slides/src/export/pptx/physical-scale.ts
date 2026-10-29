import { DEFAULT_INLINE_STYLE, normalizeBlockStyle, type Block } from '@wafflebase/docs';
import { scaleBlocks } from '../../model/autofit.js';
import type { TextInset } from '../../model/element.js';
import {
  deckFontScale,
  DOCS_PX_PER_PT,
  SLIDE_PX_PER_PT,
  type SlidesDocument,
} from '../../model/presentation.js';

/**
 * The deck re-expressed at the exported page's physical scale.
 *
 * Text sizes are stored in points and painted at `deckFontScale(meta)` ×
 * the docs canvas's 96 DPI. The exporter writes those points verbatim onto
 * a page that runs at {@link SLIDE_PX_PER_PT}, so a deck authored in
 * wafflebase (no `pxPerPt`) opened in PowerPoint with every run 1.5× too
 * large. This applies the renderer's own `scaleBlocks` — font sizes,
 * paragraph margins, indents and list markers — plus letter spacing, which
 * is point-valued too, to every text body by the ratio of the two scales, so
 * the file shows what wafflebase painted. A deck imported from PPTX already
 * runs at 2 and is returned unchanged.
 *
 * The factor is read through `deckFontScale`, so an absent, unusable or
 * oversized `pxPerPt` is interpreted exactly as the renderer interprets it.
 *
 * Returns a copy; the input is not modified.
 */
export function toExportScale(deck: SlidesDocument): SlidesDocument {
  const factor = (deckFontScale(deck.meta) * DOCS_PX_PER_PT) / SLIDE_PX_PER_PT;
  if (Math.abs(factor - 1) < 1e-9) return deck;
  const scaled = structuredClone(deck);
  forEachTextBody(scaled, (body) => {
    // Normalize first, as the renderer does (`prepareBlocksForLayout`):
    // `scaleBlocks` multiplies every margin, so a sparse style would
    // otherwise come out as NaN.
    body.blocks = scaleBlocks(body.blocks.map(normalizeBlock), factor).map((b) => ({
      ...b,
      inlines: b.inlines.map((inl) =>
        inl.style.letterSpacing
          ? { ...inl, style: { ...inl.style, letterSpacing: inl.style.letterSpacing * factor } }
          : inl,
      ),
    }));
  });
  scaled.meta = { ...scaled.meta, pxPerPt: SLIDE_PX_PER_PT };
  return scaled;
}

const ZERO_INSET: TextInset = { left: 0, top: 0, right: 0, bottom: 0 };

/**
 * The deck with the defaults wafflebase paints spelled out, so a receiving
 * app cannot substitute its own:
 *
 * - A run without `fontFamily` is painted in the docs default
 *   (`Theme.defaultFontFamily`, which `DEFAULT_INLINE_STYLE.fontFamily`
 *   mirrors — read here because the view theme is browser-only and this
 *   exporter runs in Node), but would be exported with no `<a:latin>`,
 *   so PowerPoint and Keynote substitute the theme font instead — a
 *   different face — and Keynote also drops the bold of such runs.
 * - A text element without `inset` is painted with zero insets, but would be
 *   exported with no `lIns/tIns/rIns/bIns`, so the receiving app applies the
 *   OOXML defaults (0.1in / 0.05in) and the text re-wraps inside a narrower
 *   box than the one wafflebase painted.
 *
 * Applies to decks authored in wafflebase (no `meta.pxPerPt`) only. An
 * imported deck's font-less runs and inset-less boxes came from a PPTX that
 * inherited the theme font and the default insets on purpose; spelling them
 * out there would change the original, not preserve it.
 *
 * Returns a copy when anything changes; the input is not modified.
 */
export function withPaintedDefaults(deck: SlidesDocument): SlidesDocument {
  if (deck.meta.pxPerPt != null) return deck;
  const family = DEFAULT_INLINE_STYLE.fontFamily;
  let changed = false;
  const copy = structuredClone(deck);
  forEachTextBody(copy, (body, owner) => {
    if (family) {
      for (const b of body.blocks) {
        for (const inl of b.inlines) {
          if (!inl.style?.fontFamily) {
            inl.style = { ...inl.style, fontFamily: family };
            changed = true;
          }
        }
      }
    }
    if (owner?.type === 'text' && !body.inset) {
      body.inset = { ...ZERO_INSET };
      changed = true;
    }
  });
  return changed ? copy : deck;
}

/** A block with a complete style and a style object on every run. */
function normalizeBlock(b: Block): Block {
  return {
    ...b,
    style: normalizeBlockStyle(b.style ?? {}),
    inlines: b.inlines.map((inl) => (inl.style ? inl : { ...inl, style: {} })),
  };
}

type MutableTextBody = { blocks: Block[]; inset?: TextInset };

/**
 * Calls `fn` on every painted text body of the deck's slides, layouts and
 * masters: text element data, shape text, table cell bodies and placeholder
 * bodies — anything shaped `{ blocks: Block[] }`. `owner` is the element
 * whose `data` the body is, when it is one. Speaker notes are a bare
 * `Block[]` on the slide and are not painted on the canvas, so they are left
 * alone.
 */
function forEachTextBody(
  deck: SlidesDocument,
  fn: (body: MutableTextBody, owner: { type?: unknown } | undefined) => void,
): void {
  const walk = (node: unknown, parent: Record<string, unknown> | undefined): void => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n, undefined);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.blocks) && o.blocks.every(isBlock)) {
      fn(o as MutableTextBody, parent && parent.data === o ? parent : undefined);
    }
    for (const [k, v] of Object.entries(o)) {
      if (k !== 'blocks' && k !== 'notes') walk(v, o);
    }
  };
  walk(deck.slides, undefined);
  walk(deck.layouts, undefined);
  walk(deck.masters, undefined);
}

function isBlock(b: unknown): boolean {
  return !!b && typeof b === 'object' && Array.isArray((b as Block).inlines);
}

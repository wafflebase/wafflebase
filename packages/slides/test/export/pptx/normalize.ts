/**
 * Test helper for PPTX model-equivalence round-trip tests.
 *
 * `normalize` deep-clones a SlidesDocument and erases fields that are
 * intentionally lossy through the PPTX export → re-import cycle so that
 * round-trip tests can do a structural `toEqual` without false positives.
 *
 * Lossy fields and their reasons are documented inline below.
 */

import type { SlidesDocument, Slide, SlideAnimation } from '../../../src/model/presentation.js';
import type { Element, TableCell, TextBody } from '../../../src/model/element.js';
import type { Block, Inline } from '@wafflebase/docs';

/** Sentinel placed on connector start/end after normalization. */
const CONNECTOR_ENDPOINT_NORMALIZED = { kind: '_normalized' } as const;

/**
 * Deep-clone `deck` and erase all fields that are intentionally lossy
 * through the PPTX export → re-import round-trip so that structural
 * equality checks (`.toEqual`) can be performed on the result.
 *
 * Fields dropped / zeroed and why:
 *
 * **IDs** — `Slide.id`, `Element.id`, `Block.id`, `ObjectAnimation.id`
 *   are regenerated on import; zeroed to `''`.
 *
 * **layoutId** — replaced with a positional string (`"layout:0"`, …)
 *   because the PPTX importer synthesises new layout IDs.
 *
 * **Connector endpoints** — `ConnectorElement.start` and `.end` are
 *   replaced with `{ kind: '_normalized' }` because the exporter only
 *   serialises the bounding frame, not `<a:stCxn>`/`<a:endCxn>`. After
 *   re-import both endpoints become `free` endpoints computed from frame
 *   corners, so the comparison must ignore them entirely.
 *
 * **`inline.style.href`** — imported from `<a:hlinkClick>` but exported
 *   as an empty `r:id=""` relationship that resolves to nothing on
 *   re-import; dropped. v1 deferral: exporter does not yet wire hyperlink
 *   relationship ids.
 *
 * **`block.style.marginTop`** — the importer does not read `<a:pPr spcBef>`
 *   so this field is never populated on import; excluded vacuously.
 *
 * **`block.style.marginBottom`** — the importer does not read `<a:pPr spcAft>`
 *   so this field is never populated on import; excluded vacuously.
 *
 * **`meta.pxPerPt`** — computed from slide size; may differ slightly due
 *   to floating-point rounding; dropped.
 *
 * **`meta.recentColors`** — not stored in PPTX; dropped.
 *
 * **`meta.themeId`**, **`meta.masterId`** — generated IDs that differ
 *   after re-import; dropped.
 *
 * **`guides`** — not exported to PPTX; replaced with `[]`.
 *
 * **`animations[].elementId`** — references an element ID that is zeroed;
 *   replaced with `''`.
 */
export function normalize(deck: SlidesDocument): unknown {
  // Build a layout-id → positional index map so we can replace layoutId
  // with a stable "layout:N" string.
  const layoutIndex = new Map<string, number>(
    deck.layouts.map((l, i) => [l.id, i]),
  );

  const cloned = structuredClone(deck) as SlidesDocument;

  // Drop meta fields that don't round-trip.
  delete (cloned.meta as Partial<typeof cloned.meta>).pxPerPt;
  delete (cloned.meta as Partial<typeof cloned.meta>).recentColors;
  (cloned.meta as Partial<typeof cloned.meta>).themeId = '';
  (cloned.meta as Partial<typeof cloned.meta>).masterId = '';

  // Guides are not exported.
  cloned.guides = [];

  // Normalise slides.
  for (const slide of cloned.slides) {
    normalizeSlide(slide, layoutIndex);
  }

  return cloned;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalizeSlide(
  slide: Slide,
  layoutIndex: Map<string, number>,
): void {
  // Zero the slide ID.
  slide.id = '';

  // Replace layoutId with positional string.
  const idx = layoutIndex.get(slide.layoutId);
  slide.layoutId = idx !== undefined ? `layout:${idx}` : 'layout:?';

  // Normalise animations (zero elementId and animation id).
  if (slide.animations) {
    for (const anim of slide.animations) {
      normalizeAnimation(anim);
    }
  }

  // Normalise every element on the slide.
  for (const el of slide.elements) {
    normalizeElement(el);
  }

  // Normalise notes blocks.
  for (const block of slide.notes) {
    normalizeBlock(block);
  }
}

function normalizeAnimation(anim: SlideAnimation): void {
  anim.id = '';
  anim.elementId = '';
}

function normalizeElement(el: Element): void {
  el.id = '';

  if (el.type === 'connector') {
    // Connector endpoints are lost through export → import (the exporter
    // doesn't emit stCxn/endCxn); replace with a sentinel so toEqual works.
    (el as { start: unknown }).start = CONNECTOR_ENDPOINT_NORMALIZED;
    (el as { end: unknown }).end = CONNECTOR_ENDPOINT_NORMALIZED;
    // Connector frame is a derived quantity (computed from endpoints via
    // computeConnectorFrame, which also adds stroke-width padding). The
    // original PPTX may store a frame that differs from the derived one, so
    // the frame changes on export → re-import even with the same geometry.
    // Since endpoints are already normalized away, the frame is meaningless
    // for comparison; replace it with a zero sentinel.
    (el as { frame: unknown }).frame = { x: 0, y: 0, w: 0, h: 0, rotation: 0 };
    return;
  }

  if (el.type === 'group') {
    for (const child of el.data.children) {
      normalizeElement(child);
    }
    return;
  }

  if (el.type === 'text') {
    normalizeTextBody(el.data);
    return;
  }

  if (el.type === 'shape') {
    if (el.data.text) {
      normalizeTextBody(el.data.text);
    }
    return;
  }

  if (el.type === 'table') {
    for (const row of el.data.rows) {
      for (const cell of row.cells) {
        normalizeCellBody(cell);
      }
    }
    return;
  }

  // 'image' — no text to normalise.
}

function normalizeTextBody(body: TextBody): void {
  for (const block of body.blocks) {
    normalizeBlock(block);
  }
}

function normalizeCellBody(cell: TableCell): void {
  normalizeTextBody(cell.body);
}

function normalizeBlock(block: Block): void {
  // Zero block ID (regenerated on import).
  block.id = '';

  // Drop block-style fields that the importer never populates (vacuous exclusions).
  // marginTop/marginBottom: the importer does not read <a:pPr spcBef>/<a:pPr spcAft>,
  // so these fields are never set on import and need no exporter path.
  const s = block.style as Partial<typeof block.style>;
  delete s.marginTop;
  delete s.marginBottom;

  for (const inline of block.inlines) {
    normalizeInline(inline);
  }
}

function normalizeInline(inline: Inline): void {
  const s = inline.style as Partial<typeof inline.style>;
  // href: v1 deferral — exported as empty r:id="", resolves to nothing on re-import.
  // Hyperlink relationship wiring is deferred; drop for comparison.
  delete (s as Record<string, unknown>)['href'];
}

// ---------------------------------------------------------------------------
// fromDataUrl
// ---------------------------------------------------------------------------

/**
 * Decode a `data:` URL into its raw bytes and MIME type.
 *
 * @example
 * const { bytes, mime } = await fromDataUrl('data:image/png;base64,iVBOR...');
 */
export async function fromDataUrl(
  src: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const match = src.match(/^data:([^;,]+)(?:;[^,]*?)?;base64,(.+)$/s);
  if (!match) {
    throw new Error(`fromDataUrl: not a base64 data URL: ${src.slice(0, 80)}`);
  }
  const [, mime, b64] = match;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return { bytes, mime };
}

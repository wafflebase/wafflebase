/**
 * PPTX export orchestrator.
 *
 * `exportPptx` assembles a complete `.pptx` archive from a `SlidesDocument`:
 *   1. Pre-scans all elements for image `src` values (deduped).
 *   2. Optionally fetches each image via `opts.fetchImage` and adds media parts.
 *   3. Emits theme / master / layout parts with the correct rel chain.
 *   4. Emits each slide part; wires slide→layout rels and image rels per slide.
 *   5. Emits `ppt/presentation.xml` with slide-id list and master-id list.
 *   6. Returns `writer.build()` — a complete in-memory zip as `Uint8Array`.
 *
 * ## Rel chain (mirrors what import/pptx/index.ts traverses)
 *   _rels/.rels              → ppt/presentation.xml (officeDocument)
 *   ppt/_rels/presentation.xml.rels
 *     → ppt/theme/theme1.xml     (theme)
 *     → ppt/slideMasters/slideMaster1.xml  (slideMaster)
 *     → ppt/slides/slideN.xml    (slide, one per slide)
 *   ppt/slideMasters/_rels/slideMaster1.xml.rels
 *     → ppt/theme/theme1.xml     (theme)
 *     → ppt/slideLayouts/slideLayoutN.xml  (slideLayout, one per layout)
 *   ppt/slideLayouts/_rels/slideLayoutN.xml.rels
 *     → ppt/slideMasters/slideMaster1.xml  (slideMaster)
 *   ppt/slides/_rels/slideN.xml.rels
 *     → ppt/slideLayouts/slideLayoutM.xml  (slideLayout — the slide's layout)
 *     → ppt/media/imageK.{ext}             (image, one per image element)
 *
 * ## Image handling
 *   If `opts.fetchImage` is absent and a slide has image elements whose `src`
 *   is a data-URL or remote URL that cannot be resolved at build time, we
 *   throw a clear error rather than silently writing broken rId references.
 *   Callers that don't need images can pass a deck with no image elements and
 *   omit `opts.fetchImage`.
 *
 * ## Content types added
 *   - presentation.xml:    presentationml.presentation.main+xml
 *   - theme/themeN.xml:    theme+xml
 *   - slideMasters/…:      presentationml.slideMaster+xml
 *   - slideLayouts/…:      presentationml.slideLayout+xml
 *   - slides/slideN.xml:   presentationml.slide+xml
 *   - slides/notesN.xml:   presentationml.notesSlide+xml
 */

import type { SlidesDocument } from '../../model/presentation.js';
import { resolveBackgroundFill } from '../../model/presentation.js';
import type { ImageElement } from '../../model/element.js';
import { flattenElements, buildElementWorldLookup } from '../../model/group.js';
import { computeConnectorFrame } from '../../view/canvas/connector-frame.js';
import { PptxWriter } from './zip.js';
import { REL_TYPES } from './templates.js';
import { themeToXml } from './theme.js';
import { masterToXml } from './master.js';
import { layoutToXml } from './layout.js';
import { slideToXml, notesSlideToXml } from './slide.js';
import { presentationToXml } from './presentation.js';
import type { ElementXmlCtx } from './group.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ExportPptxOptions {
  /**
   * Called once per unique image `src` across all slides. Must return the
   * raw image bytes and MIME type so the exporter can embed the file in the
   * `ppt/media/` directory.
   *
   * Required if the deck contains `ImageElement` elements. Omit only when
   * the deck has no images — attempting to export a deck with images without
   * this option throws a clear error rather than writing broken XML.
   */
  fetchImage?: (src: string) => Promise<{ bytes: Uint8Array; mime: string }>;
}

// ---------------------------------------------------------------------------
// MIME → file extension helper
// ---------------------------------------------------------------------------

/** Map a MIME type to the file extension used in `ppt/media/`. */
function extFromMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/bmp':
      return 'bmp';
    default:
      return 'png';
  }
}

// ---------------------------------------------------------------------------
// Content-type constants
// ---------------------------------------------------------------------------

const CT_PRESENTATION =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const CT_THEME =
  'application/vnd.openxmlformats-officedocument.theme+xml';
const CT_SLIDE_MASTER =
  'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml';
const CT_SLIDE_LAYOUT =
  'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml';
const CT_SLIDE =
  'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const CT_NOTES =
  'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml';

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Export a `SlidesDocument` to a `.pptx` binary (zip archive) returned as
 * `Uint8Array`. The bytes can be written directly to a file or served as a
 * download response.
 *
 * Node consumers should import this from `@wafflebase/slides/node`. Browser
 * consumers can import from `@wafflebase/slides` (same symbol, same code —
 * the orchestrator itself is DOM-free).
 */
export async function exportPptx(
  deck: SlidesDocument,
  opts: ExportPptxOptions = {},
): Promise<Uint8Array> {
  const writer = new PptxWriter();

  // -------------------------------------------------------------------------
  // Step 1: Pre-scan all image elements across all slides (dedup by src).
  // -------------------------------------------------------------------------
  const allImageSrcs = new Set<string>();
  for (const slide of deck.slides) {
    for (const el of flattenElements(slide.elements)) {
      if (el.type === 'image') {
        allImageSrcs.add(el.data.src);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Fetch + add media; build src→mediaPath map.
  // -------------------------------------------------------------------------
  // src → the relative path under ppt/ (e.g. "media/image1.png")
  const srcToMediaPath = new Map<string, string>();

  if (allImageSrcs.size > 0) {
    if (!opts.fetchImage) {
      throw new Error(
        'exportPptx: deck contains image elements but `opts.fetchImage` is not provided. ' +
          'Supply a `fetchImage` implementation that returns { bytes, mime } for each image src.',
      );
    }
    for (const src of allImageSrcs) {
      const { bytes, mime } = await opts.fetchImage(src);
      const ext = extFromMime(mime);
      const mediaPath = writer.addMedia(bytes, ext);
      srcToMediaPath.set(src, mediaPath);
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Theme parts.
  //
  // The importer picks up the theme via a `theme` rel from
  // ppt/presentation.xml. We emit the deck's first theme (which, after an
  // import, is the imported theme). If there are no themes at all, fall back
  // to the built-in default-light via a minimal synthetic XML — importPptx
  // always populates at least BUILT_IN_THEMES so this path should be rare.
  // -------------------------------------------------------------------------
  const themes = deck.themes.length > 0 ? deck.themes.slice(0, 1) : [];
  const themePaths: string[] = [];
  for (let i = 0; i < themes.length; i++) {
    const theme = themes[i];
    const themePath = `ppt/theme/theme${i + 1}.xml`;
    writer.addPart(themePath, themeToXml(theme, i + 1), CT_THEME);
    themePaths.push(themePath);
  }

  // If no theme was available (extremely unlikely), emit a placeholder path
  // so the rest of the wiring doesn't need to branch.
  const primaryThemePath = themePaths[0] ?? null;

  // -------------------------------------------------------------------------
  // Step 4: Master + layout parts.
  //
  // We emit one master (the deck's first master or DEFAULT_MASTER) and all
  // layouts whose masterId matches. The rel chain expected by the importer:
  //   presentation → master (slideMaster)
  //   master → theme (theme)
  //   master → each layout (slideLayout)
  //   layout → master (slideMaster)
  //   slide → one layout (slideLayout)
  // -------------------------------------------------------------------------
  const masterObj = deck.masters.length > 0 ? deck.masters[0] : null;

  // Collect layouts for the single emitted master.
  const masterId = masterObj?.id ?? 'default';
  const masterLayouts = deck.layouts.filter((l) => l.masterId === masterId);
  // If there are no layouts for this master, emit at least one (blank)
  // so the archive is always valid.
  let layoutsToEmit = masterLayouts.length > 0 ? masterLayouts : deck.layouts.slice(0, 1);

  // Final guard: if the deck has no layouts at all, synthesise a minimal blank
  // layout so every slide's layout rel resolves to a valid part.
  const useFallbackLayout = layoutsToEmit.length === 0;
  const FALLBACK_LAYOUT_ID = '__fallback_blank__';

  const masterPath = 'ppt/slideMasters/slideMaster1.xml';

  // Emit master XML.
  const masterXml = masterObj
    ? masterToXml(masterObj, 0)
    : fallbackMasterXml();
  writer.addPart(masterPath, masterXml, CT_SLIDE_MASTER);

  // Emit layout XMLs and build layoutId → layoutPath map.
  const layoutIdToPath = new Map<string, string>();

  if (useFallbackLayout) {
    // No layouts at all — emit a single minimal blank layout so every slide's
    // layout rel resolves to a valid part.
    const layoutPath = 'ppt/slideLayouts/slideLayout1.xml';
    writer.addPart(layoutPath, fallbackLayoutXml(), CT_SLIDE_LAYOUT);
    layoutIdToPath.set(FALLBACK_LAYOUT_ID, layoutPath);
    writer.addRel(layoutPath, REL_TYPES.slideMaster, '../slideMasters/slideMaster1.xml');
  } else {
    for (let i = 0; i < layoutsToEmit.length; i++) {
      const layout = layoutsToEmit[i];
      const layoutPath = `ppt/slideLayouts/slideLayout${i + 1}.xml`;
      writer.addPart(layoutPath, layoutToXml(layout, i + 1), CT_SLIDE_LAYOUT);
      layoutIdToPath.set(layout.id, layoutPath);

      // layout → master rel
      writer.addRel(layoutPath, REL_TYPES.slideMaster, '../slideMasters/slideMaster1.xml');
    }
  }

  // master → theme rel (importer looks for this via `pickRelTarget(presRels,'theme')` on
  // ppt/presentation.xml, but also the master carries a theme rel for color mapping).
  if (primaryThemePath) {
    writer.addRel(masterPath, REL_TYPES.theme, '../theme/theme1.xml');
  }

  // master → layout rels
  if (useFallbackLayout) {
    writer.addRel(masterPath, REL_TYPES.slideLayout, '../slideLayouts/slideLayout1.xml');
  } else {
    for (let i = 0; i < layoutsToEmit.length; i++) {
      writer.addRel(
        masterPath,
        REL_TYPES.slideLayout,
        `../slideLayouts/slideLayout${i + 1}.xml`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: Slide parts — emit each slide, wire image + layout rels.
  // -------------------------------------------------------------------------
  const slideRIds: string[] = [];

  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const slidePath = `ppt/slides/slide${i + 1}.xml`;

    // Build the world-element lookup for connector geometry.
    const worldLookup = buildElementWorldLookup(slide.elements);

    // Build per-slide image rId resolver.
    // src → rId is slide-local (each slide has its own .rels file).
    const slideImageRIdCache = new Map<string, string>();
    function resolveImageRId(el: ImageElement): string {
      const src = el.data.src;
      const cached = slideImageRIdCache.get(src);
      if (cached) return cached;
      const mediaPath = srcToMediaPath.get(src);
      if (!mediaPath) {
        // Image src is not in the pre-scan map — this should not happen if all
        // elements were scanned, but guard with a clear error rather than an
        // invalid r:embed="" attribute.
        throw new Error(
          `exportPptx: image src not found in media map: ${src.slice(0, 120)}`,
        );
      }
      // Add an image rel for this slide (target is relative to slide's dir).
      const rId = writer.addRel(slidePath, REL_TYPES.image, `../${mediaPath}`);
      slideImageRIdCache.set(src, rId);
      return rId;
    }

    const ctx: ElementXmlCtx = {
      resolveImageRId,
      connectorFrame: (el) => computeConnectorFrame(el, worldLookup),
    };

    // Resolve the effective background fill (slide → layout → master →
    // role) so master/layout background edits round-trip; inheriting
    // slides carry no explicit fill in the model. Background *images* are
    // still not exported (see backgroundToXml).
    const slideForXml =
      slide.background.fill === undefined
        ? {
            ...slide,
            background: {
              ...slide.background,
              fill: resolveBackgroundFill(slide, deck),
            },
          }
        : slide;

    // Emit slide XML.
    writer.addPart(slidePath, slideToXml(slideForXml, ctx), CT_SLIDE);

    // Determine this slide's layout. Fall back to first layout or blank.
    const resolvedLayoutPath =
      layoutIdToPath.get(slide.layoutId) ?? 'ppt/slideLayouts/slideLayout1.xml';

    // Image rels are added during slideToXml() via resolveImageRId.
    // Add the layout rel after so it follows any image rels in rId order.
    writer.addRel(slidePath, REL_TYPES.slideLayout, `../${resolvedLayoutPath.slice('ppt/'.length)}`);

    // Notes slide — if the slide has non-empty notes, emit a notes part.
    if (slide.notes && slide.notes.length > 0) {
      const notesPath = `ppt/notesSlides/notesSlide${i + 1}.xml`;
      writer.addPart(notesPath, notesSlideToXml(slide.notes), CT_NOTES);
      writer.addRel(slidePath, REL_TYPES.notesSlide, `../notesSlides/notesSlide${i + 1}.xml`);
    }

    // Collect the rId for this slide in presentation.xml.rels (added below).
    const slideRId = writer.addRel(
      'ppt/presentation.xml',
      REL_TYPES.slide,
      `slides/slide${i + 1}.xml`,
    );
    slideRIds.push(slideRId);
  }

  // -------------------------------------------------------------------------
  // Step 6: presentation.xml → master rel + theme rel.
  // -------------------------------------------------------------------------
  const masterRId = writer.addRel(
    'ppt/presentation.xml',
    REL_TYPES.slideMaster,
    'slideMasters/slideMaster1.xml',
  );

  if (primaryThemePath) {
    writer.addRel('ppt/presentation.xml', REL_TYPES.theme, 'theme/theme1.xml');
  }

  // -------------------------------------------------------------------------
  // Step 7: presentation.xml part.
  // -------------------------------------------------------------------------
  writer.addPart(
    'ppt/presentation.xml',
    presentationToXml(deck, slideRIds, masterRId),
    CT_PRESENTATION,
  );

  // -------------------------------------------------------------------------
  // Step 8: Build and return the zip.
  // -------------------------------------------------------------------------
  return writer.build();
}

// ---------------------------------------------------------------------------
// Fallback layout XML (used when the deck has no layouts at all)
// ---------------------------------------------------------------------------

/**
 * Emit a bare-minimum blank slide layout when the deck has no layout records.
 * This ensures every slide's layout rel resolves to a valid part even for
 * programmatically constructed decks that omit layout data.
 */
function fallbackLayoutXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sldLayout` +
    ` xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"` +
    ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
    ` type="blank"` +
    `>` +
    `<p:cSld>` +
    `<p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `</p:spTree>` +
    `</p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
    `</p:sldLayout>`
  );
}

// ---------------------------------------------------------------------------
// Fallback master XML (used when the deck has no masters at all — rare)
// ---------------------------------------------------------------------------

/**
 * Emit a bare-minimum slide master when the deck has no master records.
 * This avoids a crash while still producing a structurally valid archive.
 */
function fallbackMasterXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sldMaster` +
    ` xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"` +
    ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
    `>` +
    `<p:cSld>` +
    `<p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg>` +
    `<p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `</p:spTree>` +
    `</p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:sldLayoutIdLst/>` +
    `</p:sldMaster>`
  );
}

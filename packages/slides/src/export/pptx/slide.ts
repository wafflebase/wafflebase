/**
 * PPTX slide + notes-slide serializer.
 *
 * `slideToXml` assembles a complete `<p:sld>` XML string from a `Slide`
 * model object. It handles:
 *   - The spTree boilerplate (nvGrpSpPr / grpSpPr roots).
 *   - Post-processing cNvPr id assignment: every element serializer emits
 *     `<p:cNvPr id="0" name="ELEMENT_ID">`. We scan the serialized spTree
 *     body in document order, replacing each `id="0"` with an incrementing
 *     integer starting at 2 (1 is reserved for the spTree root itself) and
 *     building a `spidMap: Map<string, number>` from element id → integer for
 *     animation targeting.
 *   - Transition + timing (animation) XML appended after `<p:cSld>`.
 *
 * `notesSlideToXml` emits a minimal `<p:notes>` shell carrying the speaker
 * notes text in a body placeholder shape.
 *
 * Namespace URIs mirror those in `build-minimal-pptx.ts` and the real
 * PowerPoint output to ensure the importer can round-trip the file.
 */

import type { Block } from '@wafflebase/docs';
import type { Background, Slide } from '../../model/presentation.js';
import type { TextBody } from '../../model/element.js';
import { representativeColor } from '../../model/theme.js';
import { solidFillXml } from './color.js';
import { elementToXml, type ElementXmlCtx } from './group.js';
import { animationsToTimingXml, transitionToXml } from './animation.js';
import { textBodyToXml } from './text.js';

// ---------------------------------------------------------------------------
// Namespace declarations (matching build-minimal-pptx.ts and real PPTX output)
// ---------------------------------------------------------------------------

const SLIDE_XMLNS =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"' +
  ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

// ---------------------------------------------------------------------------
// spTree root boilerplate
// ---------------------------------------------------------------------------

/**
 * The spTree's own NV group + grpSpPr. These are always id=1 with an
 * empty transform (PowerPoint convention for the slide-level group).
 */
const SPTREE_ROOT =
  `<p:nvGrpSpPr>` +
  `<p:cNvPr id="1" name=""/>` +
  `<p:cNvGrpSpPr/>` +
  `<p:nvPr/>` +
  `</p:nvGrpSpPr>` +
  `<p:grpSpPr>` +
  `<a:xfrm>` +
  `<a:off x="0" y="0"/>` +
  `<a:ext cx="0" cy="0"/>` +
  `<a:chOff x="0" y="0"/>` +
  `<a:chExt cx="0" cy="0"/>` +
  `</a:xfrm>` +
  `</p:grpSpPr>`;

// ---------------------------------------------------------------------------
// Background serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a `Background` to a `<p:bg>` element.
 *
 * The importer reads background via `parseSlideBackground`, which looks for
 * `<p:bg><p:bgPr><a:solidFill>` (or `<a:blipFill>` for image backgrounds).
 * We emit `<p:bgPr><a:solidFill>` here which round-trips correctly for
 * solid-fill backgrounds.
 *
 * Image backgrounds are not yet exported (the URL is frontend-only), so
 * we fall back to the fill for slides that have a background image — the
 * importer will re-create the same `DEFAULT_BACKGROUND` fill it would have
 * used if the image weren't present.
 *
 * A gradient background collapses to its representative (first-stop)
 * color — full gradient background export is a later task.
 */
function backgroundToXml(bg: Background): string {
  // Callers (export/pptx/index.ts) resolve the effective fill through the
  // slide → layout → master chain before calling this, so an absent fill
  // here means a genuinely fill-less background; default to the
  // `background` role for safety. Background *images* are not exported yet.
  const fill = bg.fill ?? { kind: 'role' as const, role: 'background' as const };
  const fillXml = solidFillXml(representativeColor(fill));
  return `<p:bg><p:bgPr>${fillXml}</p:bgPr></p:bg>`;
}

// ---------------------------------------------------------------------------
// cNvPr id renumbering
// ---------------------------------------------------------------------------

/**
 * Post-process the raw spTree body (all element XML concatenated) to assign
 * unique numeric ids to every `<p:cNvPr id="0" name="...">` occurrence.
 *
 * Rules:
 * - The spTree root itself occupies id=1 (in SPTREE_ROOT above).
 * - Element cNvPr ids start at 2 and increment in document order.
 * - `name` is the model element id; we capture it for the spidMap.
 * - `<p:cTn id="0">` elements inside timing XML use a SEPARATE counter and
 *   are NOT matched here (cTn has no `name` attribute).
 *
 * Returns the renumbered spTree body and the name→id map.
 */
function renumberCNvPrIds(body: string): { renumbered: string; spidMap: Map<string, number> } {
  const spidMap = new Map<string, number>();
  let counter = 1; // spTree root is 1; elements start at 2

  const renumbered = body.replace(
    /<p:cNvPr id="0" name="([^"]*)"/g,
    (_match, name: string) => {
      counter += 1;
      spidMap.set(name, counter);
      return `<p:cNvPr id="${counter}" name="${name}"`;
    },
  );

  return { renumbered, spidMap };
}

// ---------------------------------------------------------------------------
// cTn id renumbering (timing-local id space)
// ---------------------------------------------------------------------------

/**
 * Renumber all `<p:cTn id="0"` occurrences in a timing XML string.
 *
 * These ids are in a separate id-space from cNvPr ids and only need to be
 * unique within the timing block (the importer does not join them to cNvPr).
 */
function renumberCTnIds(timingXml: string): string {
  let counter = 0;
  return timingXml.replace(/<p:cTn id="0"/g, () => {
    counter += 1;
    return `<p:cTn id="${counter}"`;
  });
}

// ---------------------------------------------------------------------------
// Main slide serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a `Slide` to a complete OOXML `<p:sld>` XML string.
 *
 * The XML is self-contained and can be stored directly as a `.xml` part
 * inside a `.pptx` archive. The caller is responsible for adding the
 * appropriate `<Relationship>` entries in the slide's `.rels` file.
 */
export function slideToXml(slide: Slide, ctx: ElementXmlCtx): string {
  // 1. Serialize all elements (cNvPr ids are all "0" at this point).
  const rawBody = slide.elements.map((el) => elementToXml(el, ctx)).join('');

  // 2. Renumber cNvPr ids and build the spidMap for animation targeting.
  const { renumbered: bodyWithIds, spidMap } = renumberCNvPrIds(rawBody);

  // 3. Serialize timing; renumber the cTn ids inside it.
  const rawTiming = animationsToTimingXml(slide.animations ?? [], spidMap);
  const timing = rawTiming ? renumberCTnIds(rawTiming) : '';

  // 4. Transition.
  const transition = slide.transition ? transitionToXml(slide.transition) : '';

  // 5. Background.
  const bg = backgroundToXml(slide.background);

  // 6. Assemble.
  const cSld =
    `<p:cSld>` +
    bg +
    `<p:spTree>` +
    SPTREE_ROOT +
    bodyWithIds +
    `</p:spTree>` +
    `</p:cSld>`;

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld ${SLIDE_XMLNS}>` +
    cSld +
    transition +
    timing +
    `</p:sld>`
  );
}

// ---------------------------------------------------------------------------
// Notes slide serializer
// ---------------------------------------------------------------------------

/**
 * Serialize speaker notes to a `<p:notes>` XML string.
 *
 * The importer looks for a `<p:ph type="body">` shape in the notes spTree.
 * We emit a minimal shape carrying that placeholder type so a round-trip
 * re-import can find the notes text.
 *
 * Notes XML namespaces mirror the slide XML (same namespace URIs).
 */
export function notesSlideToXml(notes: Block[]): string {
  const textBody: TextBody = { blocks: notes };
  const txBodyXml = textBodyToXml(textBody, 'p:txBody');

  // Notes body placeholder shape. The placeholder type "body" tells the
  // importer to treat this shape's text as the notes content.
  const bodyShape =
    `<p:sp>` +
    `<p:nvSpPr>` +
    `<p:cNvPr id="2" name="Notes Placeholder 1"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="body" idx="1"/></p:nvPr>` +
    `</p:nvSpPr>` +
    `<p:spPr/>` +
    txBodyXml +
    `</p:sp>`;

  const spTree =
    `<p:spTree>` +
    `<p:nvGrpSpPr>` +
    `<p:cNvPr id="1" name=""/>` +
    `<p:cNvGrpSpPr/>` +
    `<p:nvPr/>` +
    `</p:nvGrpSpPr>` +
    `<p:grpSpPr>` +
    `<a:xfrm>` +
    `<a:off x="0" y="0"/>` +
    `<a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/>` +
    `<a:chExt cx="0" cy="0"/>` +
    `</a:xfrm>` +
    `</p:grpSpPr>` +
    bodyShape +
    `</p:spTree>`;

  const cSld = `<p:cSld>${spTree}</p:cSld>`;

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:notes ${SLIDE_XMLNS}>` +
    cSld +
    `</p:notes>`
  );
}

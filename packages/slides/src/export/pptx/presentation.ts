/**
 * PPTX presentation.xml serializer.
 *
 * `presentationToXml` emits a `<p:presentation>` element with the slide size,
 * slide master id list, and slide id list. Namespace URIs mirror those in
 * `build-minimal-pptx.ts` and the real PowerPoint output so the importer can
 * parse the file cleanly.
 */

import type { SlidesDocument } from '../../model/presentation.js';
import { deckSlideHeight } from '../../model/presentation.js';
import { pxToEmuY } from './units.js';

/** Fixed page width — the logical 1920-px canvas maps to 13.333". */
const SLIDE_CX = 12_192_000;
/** 16:9 and 4:3 heights, used to pick the `type` hint attribute. */
const CY_16_9 = 6_858_000;
const CY_4_3 = 9_144_000;

/** PowerPoint `type` hint for a `<p:sldSz>` height, or '' (custom). */
function slideSizeType(cy: number): string {
  if (cy === CY_16_9) return ' type="screen16x9"';
  if (cy === CY_4_3) return ' type="screen4x3"';
  return '';
}

/** First slide id (PowerPoint convention; stays fixed for all slides). */
const FIRST_SLIDE_ID = 256;

/** Fixed master id (arbitrary large int, matches PowerPoint convention). */
const MASTER_ID = 2147483648;

/**
 * Serialize a `SlidesDocument` metadata into a complete `<p:presentation>`
 * XML string.
 *
 * @param deck - The slides document. Used for the per-deck slide size
 *   (`meta.slideHeight`); rels are provided separately via the rId params.
 * @param slideRIds - Ordered list of relationship IDs for each slide (rId1,
 *   rId2, …) as emitted by the orchestrator's `addRel` calls on
 *   `ppt/presentation.xml`.
 * @param masterRId - Relationship ID for the single slide master.
 */
export function presentationToXml(
  deck: SlidesDocument,
  slideRIds: string[],
  masterRId: string,
): string {
  const masterIdLst =
    `<p:sldMasterIdLst>` +
    `<p:sldMasterId id="${MASTER_ID}" r:id="${masterRId}"/>` +
    `</p:sldMasterIdLst>`;

  const sldIdEntries = slideRIds
    .map((rId, i) => `<p:sldId id="${FIRST_SLIDE_ID + i}" r:id="${rId}"/>`)
    .join('');
  const sldIdLst = `<p:sldIdLst>${sldIdEntries}</p:sldIdLst>`;

  // Per-deck height: the logical slide height maps isotropically to EMU
  // (same 6350 EMU/px factor as width), so a 4:3 deck exports at 10" tall
  // with a matching `type` hint rather than a forced 16:9 7.5".
  const slideCy = pxToEmuY(deckSlideHeight(deck.meta));
  const sldSz = `<p:sldSz cx="${SLIDE_CX}" cy="${slideCy}"${slideSizeType(slideCy)}/>`;

  // Notes size (standard A4-portrait proportions matching PowerPoint default).
  const notesSz = `<p:notesSz cx="6858000" cy="9144000"/>`;

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:presentation` +
    ` xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
    ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
    `>` +
    masterIdLst +
    sldIdLst +
    sldSz +
    notesSz +
    `</p:presentation>`
  );
}

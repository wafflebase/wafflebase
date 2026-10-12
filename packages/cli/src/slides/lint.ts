import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { layoutReport, type SlidesDocument } from '@wafflebase/slides/node';
import { importPptx } from './pptx-import.js';

/**
 * `wafflebase slides layout-report` — the cheap, deterministic check of the
 * deck-authoring loop. Runs in Node on the slides layout engine (no browser,
 * no render) and reports what each element looks like once laid out. Line
 * breaks come from a font-free width estimate, so a finding is a reason to
 * look, and the PNG render (`slides render`, or the frontend's offline
 * `render:slides`) is the final word.
 */

/**
 * Read a deck from a local file: a `.pptx` (parsed with the same importer
 * `slides import` uses, images inlined) or a `.json` `SlidesDocument` — as
 * written by `slides content --format json`, or wrapped as `{ document }`.
 */
export async function readDeckFile(file: string): Promise<SlidesDocument> {
  const bytes = readFileSync(file);
  if (extname(file).toLowerCase() === '.pptx') {
    return (await importPptx(new Uint8Array(bytes))).document;
  }
  const parsed = JSON.parse(bytes.toString('utf8')) as
    | SlidesDocument
    | { document: SlidesDocument };
  const doc = 'document' in parsed ? parsed.document : parsed;
  if (!doc || !Array.isArray((doc as SlidesDocument).slides)) {
    throw new Error(`${file} is not a slides document (no "slides" array)`);
  }
  return doc;
}

/** `slides layout-report` rows: one per element, flat so `--format table` reads well. */
export function layoutRows(doc: SlidesDocument, slide?: number) {
  return layoutReport(doc)
    .filter((s) => slide === undefined || s.slideIndex === slide - 1)
    .flatMap((s) =>
      s.elements.map((e) => ({
        slide: s.slideIndex + 1,
        element: e.elementId,
        type: e.type,
        x: e.box.x,
        y: e.box.y,
        w: e.box.w,
        h: e.box.h,
        visible: e.visibleFraction,
        autofit: e.text?.autofit ?? '',
        lines: e.text?.lines ?? '',
        textHeight: e.text?.height ?? '',
        boxHeight: e.text?.boxHeight ?? '',
        shrink: e.text?.shrinkScale ?? '',
        overflows: e.text ? e.text.overflows : '',
      })),
    );
}

import type { Crop, ImageElement } from '../../model/element';
import { generateId } from '../../model/element';
import type { EmuScale } from './geometry';
import { parseXfrm } from './geometry';
import type { PptxArchive } from './unzip';
import type { PptxRel } from './rels';
import { resolveRelsTarget } from './rels';
import { ImportReport } from './report';
import type { UploadImage } from './index';
import { attrInt, child, NS } from './xml';

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

export interface ImageParseContext {
  archive: PptxArchive;
  /** The slide part path, used to resolve relative rels targets. */
  slidePartPath: string;
  rels: Map<string, PptxRel>;
  uploadImage?: UploadImage;
  scale: EmuScale;
  report: ImportReport;
}

/**
 * Parse `<p:pic>` into an `ImageElement`. Returns `undefined` and bumps
 * `report.skippedImages` when the blip is missing, the rel doesn't
 * resolve, or no `uploadImage` callback is configured.
 */
export async function parsePic(
  pic: Element,
  ctx: ImageParseContext,
): Promise<ImageElement | undefined> {
  const spPr = child(pic, 'spPr');
  const xfrm = spPr ? child(spPr, 'xfrm') : undefined;
  const frame = parseXfrm(xfrm, ctx.scale);

  const blipFill = child(pic, 'blipFill');
  const blip = blipFill ? child(blipFill, 'blip') : undefined;
  const rid = blip
    ? blip.getAttributeNS(NS.R, 'embed') || blip.getAttribute('r:embed') || undefined
    : undefined;

  if (!rid || !ctx.uploadImage) {
    ctx.report.skippedImages += 1;
    return undefined;
  }
  const rel = ctx.rels.get(rid);
  if (!rel) {
    ctx.report.skippedImages += 1;
    return undefined;
  }

  const mediaPath = resolveRelsTarget(ctx.slidePartPath, rel.target);
  const bytes = await ctx.archive.readBytes(mediaPath);
  if (!bytes) {
    ctx.report.skippedImages += 1;
    return undefined;
  }

  const ext = mediaPath.split('.').pop()?.toLowerCase() ?? '';
  const mime = EXT_TO_MIME[ext] ?? 'application/octet-stream';

  // Soft-skip on upload failure — a single broken image shouldn't tank
  // the whole import. Counts towards `report.skippedImages` and the
  // caller drops the element.
  let src: string;
  try {
    src = await ctx.uploadImage(bytes, mime);
  } catch (err) {
    ctx.report.skippedImages += 1;
    if (typeof console !== 'undefined') {
      console.warn(`pptx import: image upload failed for ${mediaPath}:`, err);
    }
    return undefined;
  }

  const crop = blipFill ? parseSrcRect(child(blipFill, 'srcRect')) : undefined;
  const opacity = blip ? parseAlphaModFix(child(blip, 'alphaModFix')) : undefined;

  return {
    id: generateId(),
    type: 'image',
    frame,
    data: {
      src,
      ...(crop ? { crop } : {}),
      ...(opacity !== undefined ? { opacity } : {}),
    },
  };
}

/**
 * `<a:alphaModFix amt="19000"/>` — `amt` is in thousandths of a
 * percent (100_000 = fully opaque). Returns `undefined` when missing
 * or when the value rounds to a no-op (>= 1) so default-opacity
 * images don't carry a redundant field.
 */
function parseAlphaModFix(alphaModFix: Element | undefined): number | undefined {
  if (!alphaModFix) return undefined;
  const amt = attrInt(alphaModFix, 'amt');
  if (typeof amt !== 'number') return undefined;
  const opacity = Math.max(0, Math.min(1, amt / 100_000));
  return opacity < 1 ? opacity : undefined;
}

/**
 * `<a:srcRect l="10000" t="0" r="0" b="0"/>` — each axis is in
 * thousandths of the image dimension. Our `Crop` is normalized to a
 * 0..1 sub-rectangle (origin + size).
 */
function parseSrcRect(srcRect: Element | undefined): Crop | undefined {
  if (!srcRect) return undefined;
  const l = (attrInt(srcRect, 'l') ?? 0) / 100_000;
  const t = (attrInt(srcRect, 't') ?? 0) / 100_000;
  const r = (attrInt(srcRect, 'r') ?? 0) / 100_000;
  const b = (attrInt(srcRect, 'b') ?? 0) / 100_000;
  if (l === 0 && t === 0 && r === 0 && b === 0) return undefined;
  return {
    x: l,
    y: t,
    w: Math.max(0, 1 - l - r),
    h: Math.max(0, 1 - t - b),
  };
}


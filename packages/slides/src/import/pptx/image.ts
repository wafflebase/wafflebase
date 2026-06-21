import type { Crop, Effects, ImageElement, ImageRecolor } from '../../model/element';
import { generateId } from '../../model/element';
import type { ClrMap } from './color';
import type { EmuScale } from './geometry';
import { parseXfrm } from './geometry';
import { parseEffects, parseImageAdjustments, readAltText } from './effects';
import type { PptxArchive } from './unzip';
import type { PptxRel } from './rels';
import { resolveRelsTarget } from './rels';
import { ImportReport } from './report';
import type { UploadImage } from './index';
import { attrInt, child, NS } from './xml';

export const EXT_TO_MIME: Record<string, string> = {
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
  /**
   * Master `<p:clrMap>` for resolving `<a:schemeClr>` shadow colors on
   * `<p:pic>` effects. Optional — background blip parsing (slide /
   * master) builds this context without it and never reads effects.
   */
  clrMap?: ClrMap;
}

/**
 * Resolved `<a:blipFill>` data, shared by `<p:pic>` (foreground image)
 * and `<p:bgPr>` (slide / master background) parsing.
 */
export type ParsedBlip = {
  src: string;
  opacity?: number;
  crop?: Crop;
  recolor?: ImageRecolor;
  brightness?: number;
  contrast?: number;
};

/**
 * Resolve `<a:blipFill>` → uploaded src + optional opacity/crop.
 * Returns `undefined` and bumps `report.skippedImages` when the blip
 * is missing, the rel doesn't resolve, or no `uploadImage` callback
 * is configured. Soft-fails on upload errors (logs and counts skip)
 * so a single broken image cannot tank the whole import.
 */
export async function parseBlipFill(
  blipFill: Element | undefined,
  ctx: ImageParseContext,
): Promise<ParsedBlip | undefined> {
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

  // Prefer `<a:srcRect>` (source crop); fall back to `<a:stretch><a:fillRect>`
  // (destination cover crop). PowerPoint expresses "Fill" cropping either way.
  const crop = blipFill
    ? parseSrcRect(child(blipFill, 'srcRect')) ?? parseStretchFillRect(blipFill)
    : undefined;
  const opacity = blip ? parseAlphaModFix(child(blip, 'alphaModFix')) : undefined;
  // Recolor / brightness / contrast live on `<a:blip>` itself, so both
  // `<p:pic>` and shape-`blipFill` images inherit them through here.
  const adjustments = parseImageAdjustments(blip);
  return {
    src,
    ...(crop ? { crop } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(adjustments ?? {}),
  };
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
  const blip = await parseBlipFill(blipFill, ctx);
  if (!blip) return undefined;

  // Drop shadow / reflection live on the host `<p:spPr>`, alt text on the
  // `<p:nvPicPr><p:cNvPr descr>` — not on the blip itself.
  const effects: Effects | undefined = parseEffects(spPr, ctx.scale, ctx.clrMap);
  const alt = readAltText(pic);

  return {
    id: generateId(),
    type: 'image',
    frame,
    data: {
      ...blip,
      ...(effects ? { effects } : {}),
      ...(alt ? { alt } : {}),
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

/**
 * `<a:stretch><a:fillRect l t r b/></a:stretch>` — insets (thousandths of a
 * percent) of the destination rectangle the image is stretched into, relative
 * to the shape bounds. NEGATIVE insets scale the image *past* the shape
 * (PowerPoint "Fill" / cover crop) and the shape clips it; this is the
 * destination-side dual of `<a:srcRect>`. We convert it to the equivalent
 * source `Crop` so the renderer's source-rect path reproduces the cover
 * region instead of stretching the whole image into a mismatched frame.
 *
 * The fill region maps image fraction `u` to shape fraction `x` via
 * `x = l + u·(1-l-r)`, so the shape window `x∈[0,1]` corresponds to source
 * `u∈[-l/fw, (1-l)/fw]` (with `fw = 1-l-r`). Only the cover case (resulting
 * crop within `[0,1]`) is representable: the default all-zero fillRect is a
 * no-op, and positive insets (image inset / letterbox) would sample outside
 * the image, so we skip them and fall back to a full stretch.
 */
function parseStretchFillRect(blipFill: Element): Crop | undefined {
  const stretch = child(blipFill, 'stretch');
  const fillRect = stretch ? child(stretch, 'fillRect') : undefined;
  if (!fillRect) return undefined;
  const l = (attrInt(fillRect, 'l') ?? 0) / 100_000;
  const t = (attrInt(fillRect, 't') ?? 0) / 100_000;
  const r = (attrInt(fillRect, 'r') ?? 0) / 100_000;
  const b = (attrInt(fillRect, 'b') ?? 0) / 100_000;
  // Default fillRect (no-op): image fills the shape exactly, no crop needed.
  if (l === 0 && t === 0 && r === 0 && b === 0) return undefined;
  const fw = 1 - l - r;
  const fh = 1 - t - b;
  if (fw <= 0 || fh <= 0) return undefined;
  const crop: Crop = { x: -l / fw, y: -t / fh, w: 1 / fw, h: 1 / fh };
  // Only the cover case maps cleanly to a source sub-rectangle.
  const EPS = 1e-9;
  if (
    crop.x < -EPS ||
    crop.y < -EPS ||
    crop.x + crop.w > 1 + EPS ||
    crop.y + crop.h > 1 + EPS
  ) {
    return undefined;
  }
  return crop;
}


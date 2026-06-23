import type { Crop, ImageElement } from '../../model/element.js';
import { xfrmXml } from './shape.js';
import { effectsToXml } from './effects.js';
import { attr, escapeXmlAttr } from './xml.js';

/**
 * Serialize an {@link ImageElement} to a `<p:pic>` element.
 *
 * The orchestrator (Task 12) is responsible for resolving the image bytes,
 * adding the media file + relationship to the zip, and passing the resulting
 * `embedRId` here.
 *
 * **Crop convention** (verified against `src/import/pptx/image.ts`
 * `parseSrcRect`):
 *   - OOXML `<a:srcRect l t r b>` values are in thousandths-of-a-percent,
 *     i.e. `100_000` = 100 % of the image dimension.
 *   - `l` = `crop.x * 100_000`, `t` = `crop.y * 100_000`,
 *     `r` = `(1 - crop.x - crop.w) * 100_000`,
 *     `b` = `(1 - crop.y - crop.h) * 100_000`.
 *   This is the exact inverse of the importer's `l / 100_000` → `crop.x` etc.
 *
 * **Opacity** (`<a:alphaModFix>`): stored as `[0, 1]`, emitted as `100_000`ths.
 *   Omitted when `opacity === undefined || opacity >= 1`.
 *
 * **Recolor** (verified against `parseImageAdjustments`):
 *   - `'grayscale'` → `<a:grayscl/>` (direct inverse of `child(blip,'grayscl')`).
 *   - `'sepia'` → `<a:duotone>` with canonical warm-brown srgbClr tones
 *     (`4C2B1E` dark + `C8A882` light). The importer's `isSepiaDuotone`
 *     detects sepia by `R > G ≥ B && R-B > 24`; both of these tones pass
 *     that check, and the import round-trip will re-classify them as `'sepia'`.
 *
 * **Brightness / contrast** (`<a:lum>`): stored as `[-1, 1]`, emitted as
 *   `Math.round(v * 100_000)`. Exact inverse of `bright / 100_000` in importer.
 */
export function imageToXml(el: ImageElement, embedRId: string): string {
  const { data, frame } = el;

  // Build <a:blip> children
  const blipChildren: string[] = [];

  // Opacity → <a:alphaModFix>
  if (data.opacity !== undefined && data.opacity < 1) {
    blipChildren.push(`<a:alphaModFix amt="${Math.round(data.opacity * 100_000)}"/>`);
  }

  // Recolor → <a:grayscl> or <a:duotone>
  if (data.recolor === 'grayscale') {
    blipChildren.push('<a:grayscl/>');
  } else if (data.recolor === 'sepia') {
    // Two warm-brown tones that `isSepiaDuotone` in the importer will
    // recognize as sepia (R > G ≥ B, R-B > 24 for both).
    blipChildren.push(
      '<a:duotone>' +
        '<a:srgbClr val="4C2B1E"/>' +  // dark brown
        '<a:srgbClr val="C8A882"/>' +  // tan / light brown
        '</a:duotone>',
    );
  }

  // Brightness / contrast → <a:lum>
  if (data.brightness !== undefined || data.contrast !== undefined) {
    const bright =
      data.brightness !== undefined ? ` bright="${Math.round(data.brightness * 100_000)}"` : '';
    const contrast =
      data.contrast !== undefined ? ` contrast="${Math.round(data.contrast * 100_000)}"` : '';
    blipChildren.push(`<a:lum${bright}${contrast}/>`);
  }

  const blip = `<a:blip r:embed="${embedRId}">${blipChildren.join('')}</a:blip>`;
  const srcRect = data.crop ? srcRectXml(data.crop) : '';

  // Non-visual props
  const descrAttr = attr('descr', data.alt);
  const nv =
    `<p:nvPicPr>` +
    `<p:cNvPr id="0" name="${escapeXmlAttr(el.id)}"${descrAttr}/>` +
    `<p:cNvPicPr/>` +
    `<p:nvPr/>` +
    `</p:nvPicPr>`;

  // Shape properties: transform + rect geometry + optional effects
  const spPr =
    `<p:spPr>` +
    xfrmXml(frame) +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    effectsToXml(data.effects) +
    `</p:spPr>`;

  return (
    `<p:pic>` +
    nv +
    `<p:blipFill>` +
    blip +
    srcRect +
    `<a:stretch><a:fillRect/></a:stretch>` +
    `</p:blipFill>` +
    spPr +
    `</p:pic>`
  );
}

/**
 * Inverse of `parseSrcRect` in `src/import/pptx/image.ts`.
 *
 * OOXML `<a:srcRect l t r b>` insets are in thousandths-of-a-percent
 * (`100_000` = 100 % of the image dimension on that axis). Given our
 * model Crop `{ x, y, w, h }` (all in `[0, 1]`):
 *   - `l = crop.x`  → left edge offset
 *   - `t = crop.y`  → top edge offset
 *   - `r = 1 − crop.x − crop.w` → right edge distance from image right
 *   - `b = 1 − crop.y − crop.h` → bottom edge distance from image bottom
 */
function srcRectXml(crop: Crop): string {
  const l = Math.round(crop.x * 100_000);
  const t = Math.round(crop.y * 100_000);
  const r = Math.round((1 - crop.x - crop.w) * 100_000);
  const b = Math.round((1 - crop.y - crop.h) * 100_000);
  return `<a:srcRect l="${l}" t="${t}" r="${r}" b="${b}"/>`;
}

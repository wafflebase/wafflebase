import { BadRequestException } from '@nestjs/common';
import { parseRef } from '@wafflebase/sheets';
import type { SheetImage } from '@wafflebase/sheets';

/**
 * Validation for the floating-image collection of one worksheet.
 *
 * A `SheetImage` is a picture anchored to a cell with a pixel offset, which
 * the workspace image endpoints know nothing about: `POST .../images` stores
 * bytes and hands back a URL, and until this module nothing could place that
 * URL on a grid. `src` is that URL, stored verbatim — the same string the
 * editor stores — so an image is uploaded once and referenced from as many
 * worksheets as the caller likes.
 */

function reject(message: string): never {
  throw new BadRequestException(message);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    reject(`image '${field}' must be a non-empty string`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    reject(`image '${field}' must be a finite number`);
  }
  return value;
}

function requirePositive(value: unknown, field: string): number {
  const n = requireNumber(value, field);
  if (n <= 0) reject(`image '${field}' must be positive`);
  return n;
}

function parseImage(raw: unknown, index: number): SheetImage {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    reject(`images[${index}] must be an object`);
  }
  const i = raw as Record<string, unknown>;

  const anchor = requireString(i.anchor, 'anchor');
  try {
    parseRef(anchor); // throws a plain Error on a malformed A1 anchor
  } catch {
    reject(`image 'anchor' must be a valid A1 reference; got "${anchor}"`);
  }

  const image: SheetImage = {
    id: requireString(i.id, 'id'),
    src: requireString(i.src, 'src'),
    anchor,
    offsetX: requireNumber(i.offsetX, 'offsetX'),
    offsetY: requireNumber(i.offsetY, 'offsetY'),
    width: requirePositive(i.width, 'width'),
    height: requirePositive(i.height, 'height'),
    // The natural size the renderer keeps the aspect ratio against. Defaulted
    // to the placed size rather than required: a caller that just wants a
    // picture on a cell should not have to know the file's pixel dimensions,
    // and a square-one ratio is what the editor computes for that case anyway.
    originalWidth: requirePositive(
      i.originalWidth ?? i.width,
      'originalWidth',
    ),
    originalHeight: requirePositive(
      i.originalHeight ?? i.height,
      'originalHeight',
    ),
  };

  if (i.alt !== undefined) {
    if (typeof i.alt !== 'string') reject("image 'alt' must be a string");
    image.alt = i.alt;
  }

  return image;
}

/**
 * Validate a `{ images: SheetImage[] }` body. The list replaces the whole
 * image collection (keyed by each image's `id`), so an omitted image is
 * deleted — the same replace semantics `charts` has.
 */
export function parseImages(body: unknown): SheetImage[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('body must be an object { images: [...] }');
  }
  const images = (body as Record<string, unknown>).images;
  if (!Array.isArray(images)) {
    throw new BadRequestException("'images' must be an array");
  }
  const seen = new Set<string>();
  return images.map((raw, i) => {
    const image = parseImage(raw, i);
    if (seen.has(image.id)) {
      throw new BadRequestException(`duplicate image id "${image.id}"`);
    }
    seen.add(image.id);
    return image;
  });
}

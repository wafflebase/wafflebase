// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { importPptx } from '../../../src/import/pptx/index.js';
import { exportPptx } from '../../../src/export/pptx/index.js';
import { buildMinimalPptx } from '../../import/pptx/__fixtures__/build-minimal-pptx.js';
import { fromDataUrl } from './normalize.js';
import type { ImageElement } from '../../../src/model/element.js';

/**
 * A fitted image exported to PPTX and imported back renders the same: `cover`
 * returns as the equivalent crop, `contain` as the letterboxed frame. The
 * exporter reads the natural size from the fetched bytes, so this runs the
 * whole path rather than `imageToXml` alone.
 */

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
// A 400x200 PNG header — all the exporter reads.
const png = new Uint8Array([
  0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a,
  ...be32(13), ...ascii('IHDR'), ...be32(400), ...be32(200), 8, 6, 0, 0, 0,
]);
const src = `data:image/png;base64,${btoa(String.fromCharCode(...png))}`;
const keepAsDataUrl = {
  uploadImage: async (bytes: Uint8Array, mime: string) =>
    `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`,
};

async function roundTripImage(fit: 'cover' | 'contain'): Promise<ImageElement> {
  const a = (await importPptx(await buildMinimalPptx())).document;
  const image: ImageElement = {
    id: 'img',
    type: 'image',
    frame: { x: 100, y: 100, w: 600, h: 600, rotation: 0 },
    data: { src, fit },
  };
  const deck = { ...a, slides: [{ ...a.slides[0], elements: [image] }] };
  const bytes = await exportPptx(deck, { fetchImage: fromDataUrl });
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const b = (await importPptx(buf, keepAsDataUrl)).document;
  const out = b.slides[0].elements.find((e) => e.type === 'image');
  expect(out).toBeDefined();
  return out as ImageElement;
}

describe('image fit PPTX round-trip', () => {
  it("'cover' comes back as the centred crop over the same frame", async () => {
    const el = await roundTripImage('cover');
    expect(el.data.crop?.x).toBeCloseTo(0.25, 4);
    expect(el.data.crop?.w).toBeCloseTo(0.5, 4);
    expect(el.data.crop?.y ?? 0).toBeCloseTo(0, 4);
    expect(el.data.crop?.h ?? 1).toBeCloseTo(1, 4);
    expect(el.frame.w).toBeCloseTo(600, 0);
    expect(el.frame.h).toBeCloseTo(600, 0);
  });

  it("'contain' comes back as the letterboxed frame, uncropped", async () => {
    const el = await roundTripImage('contain');
    expect(el.data.crop).toBeUndefined();
    // 400x200 into 600x600 is never upscaled → 400x200 centred.
    expect(el.frame.x).toBeCloseTo(200, 0);
    expect(el.frame.y).toBeCloseTo(300, 0);
    expect(el.frame.w).toBeCloseTo(400, 0);
    expect(el.frame.h).toBeCloseTo(200, 0);
  });
});

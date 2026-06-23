// @vitest-environment jsdom

/**
 * Model-equivalence round-trip suite for the PPTX exporter.
 *
 * For each fixture: import → export → re-import, then assert
 * normalize(b) deep-equals normalize(a) under the documented lossy
 * exclusions in normalize.ts.
 */

import { describe, it, expect } from 'vitest';
import { importPptx } from '../../../src/import/pptx/index.js';
import { exportPptx } from '../../../src/export/pptx/index.js';
import { buildMinimalPptx } from '../../import/pptx/__fixtures__/build-minimal-pptx.js';
import { buildRichPptx } from '../../import/pptx/__fixtures__/build-rich-pptx.js';
import { normalize, fromDataUrl } from './normalize.js';
import type { SlidesDocument } from '../../../src/model/presentation.js';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function roundTrip(buf: ArrayBuffer): Promise<{ a: SlidesDocument; b: SlidesDocument }> {
  const a = (await importPptx(buf)).document;
  const bytes = await exportPptx(a, { fetchImage: fromDataUrl });
  const ab = toArrayBuffer(bytes);
  const b = (await importPptx(ab)).document;
  return { a, b };
}

describe('fromDataUrl', () => {
  it('decodes a standard base64 data URL', async () => {
    const b64 = btoa('hello');
    const src = `data:image/png;base64,${b64}`;
    const { mime, bytes } = await fromDataUrl(src);
    expect(mime).toBe('image/png');
    expect(bytes).toEqual(Uint8Array.from('hello', (c) => c.charCodeAt(0)));
  });

  it('handles a data URL with extra MIME params (e.g. charset)', async () => {
    // Some encoders emit data:image/png;charset=utf-8;base64,...
    const b64 = btoa('world');
    const src = `data:image/png;charset=utf-8;base64,${b64}`;
    const { mime, bytes } = await fromDataUrl(src);
    expect(mime).toBe('image/png');
    expect(bytes).toEqual(Uint8Array.from('world', (c) => c.charCodeAt(0)));
  });

  it('throws for a non-base64 data URL', async () => {
    await expect(fromDataUrl('data:text/plain,hello')).rejects.toThrow('not a base64 data URL');
  });
});

describe('PPTX round-trip (model equivalence)', () => {
  it('minimal deck round-trips', async () => {
    const { a, b } = await roundTrip(await buildMinimalPptx());
    expect(normalize(b)).toEqual(normalize(a));
  });

  it('shape (roundRect, fill, text) round-trips', async () => {
    const buf = await buildRichPptx();
    const a = (await importPptx(buf)).document;
    // Only test slide 1 (shape).
    const slideA = { ...a, slides: [a.slides[0]] };

    const bytes = await exportPptx({ ...a, slides: [a.slides[0]] }, { fetchImage: fromDataUrl });
    const ab = toArrayBuffer(bytes);
    const b = (await importPptx(ab)).document;
    const slideB = { ...b, slides: [b.slides[0]] };

    expect(normalize(slideB)).toEqual(normalize(slideA));
  });

  it('text box (txBox, bold run, grow autofit) round-trips', async () => {
    const buf = await buildRichPptx();
    const a = (await importPptx(buf)).document;
    const slide2 = a.slides[1];
    const deckA = { ...a, slides: [slide2] };

    const bytes = await exportPptx(deckA, { fetchImage: fromDataUrl });
    const ab = toArrayBuffer(bytes);
    const b = (await importPptx(ab)).document;
    const deckB = { ...b, slides: [b.slides[0]] };

    expect(normalize(deckB)).toEqual(normalize(deckA));
  });

  it('table (merged cell, tableStyleId) round-trips', async () => {
    const buf = await buildRichPptx();
    const a = (await importPptx(buf)).document;
    const slide3 = a.slides[2];
    const deckA = { ...a, slides: [slide3] };

    const bytes = await exportPptx(deckA, { fetchImage: fromDataUrl });
    const ab = toArrayBuffer(bytes);
    const b = (await importPptx(ab)).document;
    const deckB = { ...b, slides: [b.slides[0]] };

    expect(normalize(deckB)).toEqual(normalize(deckA));
  });

  it('image round-trips', async () => {
    const buf = await buildRichPptx();
    const a = (await importPptx(buf, {
      uploadImage: async (bytes, mime) => {
        const b64 = btoa(String.fromCharCode(...bytes));
        return `data:${mime};base64,${b64}`;
      },
    })).document;
    const slide4 = a.slides[3];
    const deckA = { ...a, slides: [slide4] };

    const bytes = await exportPptx(deckA, { fetchImage: fromDataUrl });
    const ab = toArrayBuffer(bytes);
    const b = (await importPptx(ab, {
      uploadImage: async (imgBytes, mime) => {
        const b64 = btoa(String.fromCharCode(...imgBytes));
        return `data:${mime};base64,${b64}`;
      },
    })).document;
    const deckB = { ...b, slides: [b.slides[0]] };

    expect(normalize(deckB)).toEqual(normalize(deckA));
  });

  it('group (containing a shape child) round-trips', async () => {
    const buf = await buildRichPptx();
    const a = (await importPptx(buf)).document;
    const slide5 = a.slides[4];
    const deckA = { ...a, slides: [slide5] };

    const bytes = await exportPptx(deckA, { fetchImage: fromDataUrl });
    const ab = toArrayBuffer(bytes);
    const b = (await importPptx(ab)).document;
    const deckB = { ...b, slides: [b.slides[0]] };

    expect(normalize(deckB)).toEqual(normalize(deckA));
  });

  it('connector (straight, stroke color) round-trips', async () => {
    const buf = await buildRichPptx();
    const a = (await importPptx(buf)).document;
    const slide6 = a.slides[5];
    const deckA = { ...a, slides: [slide6] };

    const bytes = await exportPptx(deckA, { fetchImage: fromDataUrl });
    const ab = toArrayBuffer(bytes);
    const b = (await importPptx(ab)).document;
    const deckB = { ...b, slides: [b.slides[0]] };

    expect(normalize(deckB)).toEqual(normalize(deckA));
  });

  it('text box with lineHeight, marL/indent, highlight, and bullet marker round-trips', async () => {
    const buf = await buildRichPptx();
    const a = (await importPptx(buf)).document;
    const slide7 = a.slides[6];
    const deckA = { ...a, slides: [slide7] };

    const bytes = await exportPptx(deckA, { fetchImage: fromDataUrl });
    const ab = toArrayBuffer(bytes);
    const b = (await importPptx(ab)).document;
    const deckB = { ...b, slides: [b.slides[0]] };

    expect(normalize(deckB)).toEqual(normalize(deckA));
  });


  it('shape with drop shadow and reflection (effects) round-trips', async () => {
    const buf = await buildRichPptx();
    const a = (await importPptx(buf)).document;
    const slide8 = a.slides[7];
    const deckA = { ...a, slides: [slide8] };

    const bytes = await exportPptx(deckA, { fetchImage: fromDataUrl });
    const ab = toArrayBuffer(bytes);
    const b = (await importPptx(ab)).document;
    const deckB = { ...b, slides: [b.slides[0]] };

    expect(normalize(deckB)).toEqual(normalize(deckA));
  });

  it('freeform custGeom (triangle M/L/L/Z path) round-trips', async () => {
    const buf = await buildRichPptx();
    const a = (await importPptx(buf)).document;
    const slide9 = a.slides[8];
    const deckA = { ...a, slides: [slide9] };

    const bytes = await exportPptx(deckA, { fetchImage: fromDataUrl });
    const ab = toArrayBuffer(bytes);
    const b = (await importPptx(ab)).document;
    const deckB = { ...b, slides: [b.slides[0]] };

    expect(normalize(deckB)).toEqual(normalize(deckA));
  });

  it('image with crop, recolor, opacity, and brightness round-trips', async () => {
    const buf = await buildRichPptx();
    const a = (await importPptx(buf, {
      uploadImage: async (bytes, mime) => {
        const b64 = btoa(String.fromCharCode(...bytes));
        return `data:${mime};base64,${b64}`;
      },
    })).document;
    const slide10 = a.slides[9];
    const deckA = { ...a, slides: [slide10] };

    const bytes = await exportPptx(deckA, { fetchImage: fromDataUrl });
    const ab = toArrayBuffer(bytes);
    const b = (await importPptx(ab, {
      uploadImage: async (imgBytes, mime) => {
        const b64 = btoa(String.fromCharCode(...imgBytes));
        return `data:${mime};base64,${b64}`;
      },
    })).document;
    const deckB = { ...b, slides: [b.slides[0]] };

    expect(normalize(deckB)).toEqual(normalize(deckA));
  });

  it('slide transition and object animations round-trip', async () => {
    const buf = await buildRichPptx();
    const a = (await importPptx(buf)).document;
    const slide11 = a.slides[10];
    const deckA = { ...a, slides: [slide11] };

    const bytes = await exportPptx(deckA, { fetchImage: fromDataUrl });
    const ab = toArrayBuffer(bytes);
    const b = (await importPptx(ab)).document;
    const deckB = { ...b, slides: [b.slides[0]] };

    expect(normalize(deckB)).toEqual(normalize(deckA));
  });

  it('full rich deck (all 11 slides) round-trips', async () => {
    const buf = await buildRichPptx();
    const { a, b } = await roundTrip(buf);
    expect(normalize(b)).toEqual(normalize(a));
  });
});

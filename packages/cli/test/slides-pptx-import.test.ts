import { describe, it, expect } from 'vitest';
import {
  importPptx,
  inlineBase64SlidesUploader,
  InvalidPptxError,
} from '../src/slides/pptx-import.js';

describe('inlineBase64SlidesUploader', () => {
  it('returns a data URL with the supplied mime type', async () => {
    const url = await inlineBase64SlidesUploader(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      'image/png',
    );
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('falls back to application/octet-stream when mime is empty', async () => {
    const url = await inlineBase64SlidesUploader(
      new Uint8Array([0x00]),
      '',
    );
    expect(url.startsWith('data:application/octet-stream;base64,')).toBe(true);
  });
});

describe('importPptx (wrapper)', () => {
  it('wraps parser errors in InvalidPptxError', async () => {
    // A handful of arbitrary bytes is not a valid ZIP/pptx layout —
    // the underlying parser throws, and the wrapper translates the
    // error class so callers can branch on `INVALID_PPTX`.
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(importPptx(garbage)).rejects.toBeInstanceOf(InvalidPptxError);
  });

  it('attaches a stable error code', async () => {
    const garbage = new Uint8Array([0]);
    try {
      await importPptx(garbage);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidPptxError);
      expect((e as InvalidPptxError).code).toBe('INVALID_PPTX');
    }
  });
});

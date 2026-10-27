import { describe, it, expect } from 'vitest';
import { imageNaturalSize } from '../../../src/export/pptx/image-size.js';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

function pngHeader(w: number, h: number): Uint8Array {
  return new Uint8Array([
    0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a,
    ...be32(13), ...ascii('IHDR'), ...be32(w), ...be32(h), 8, 6, 0, 0, 0,
  ]);
}

describe('imageNaturalSize', () => {
  it('reads PNG', () => {
    expect(imageNaturalSize(pngHeader(640, 480))).toEqual({ w: 640, h: 480 });
  });

  it('reads GIF', () => {
    const gif = new Uint8Array([...ascii('GIF89a'), ...le16(320), ...le16(200), 0, 0, 0]);
    expect(imageNaturalSize(gif)).toEqual({ w: 320, h: 200 });
  });

  it('reads JPEG, skipping segments before the SOF marker', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0, length 4
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, // SOF0: h=300, w=400
      0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(imageNaturalSize(jpeg)).toEqual({ w: 400, h: 300 });
  });

  it('reads WebP VP8X (extended)', () => {
    const webp = new Uint8Array([
      ...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8X'),
      10, 0, 0, 0, 0, 0, 0, 0, ...le24(1919), ...le24(1079), 0, 0,
    ]);
    expect(imageNaturalSize(webp)).toEqual({ w: 1920, h: 1080 });
  });

  it('reads WebP VP8L (lossless)', () => {
    const bits = (100 - 1) | ((50 - 1) << 14);
    const webp = new Uint8Array([
      ...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8L'),
      0, 0, 0, 0, 0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255,
      0, 0, 0, 0, 0,
    ]);
    expect(imageNaturalSize(webp)).toEqual({ w: 100, h: 50 });
  });

  it('returns null for formats it cannot read (SVG, truncated)', () => {
    expect(imageNaturalSize(new Uint8Array(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>')))).toBeNull();
    expect(imageNaturalSize(pngHeader(10, 10).subarray(0, 12))).toBeNull();
  });

  it('reads WebP VP8 (lossy)', () => {
    const webp = new Uint8Array([
      ...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8 '),
      0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(640), ...le16(360),
    ]);
    expect(imageNaturalSize(webp)).toEqual({ w: 640, h: 360 });
  });

  describe('JPEG', () => {
    const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, ...be16(300), ...be16(400), 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    // APP1 EXIF with a single IFD0 entry: Orientation (0x0112, SHORT, 1) = v.
    function exif(v: number, le: boolean): number[] {
      const u16 = (n: number) => (le ? le16(n) : be16(n));
      const u32 = (n: number) => (le ? [...le16(n & 0xffff), ...le16(n >>> 16)] : be32(n));
      const tiff = [
        ...(le ? ascii('II') : ascii('MM')), ...u16(42), ...u32(8),
        ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(v), 0, 0,
        ...u32(0),
      ];
      const payload = [...ascii('Exif'), 0, 0, ...tiff];
      return [0xff, 0xe1, ...be16(payload.length + 2), ...payload];
    }
    const jpeg = (...segments: number[][]) =>
      new Uint8Array([0xff, 0xd8, ...segments.flat()]);

    it('swaps the coded size for a quarter-turn EXIF orientation', () => {
      for (const le of [false, true]) {
        for (const v of [5, 6, 7, 8]) {
          expect(imageNaturalSize(jpeg(exif(v, le), sof))).toEqual({ w: 300, h: 400 });
        }
        for (const v of [1, 2, 3, 4]) {
          expect(imageNaturalSize(jpeg(exif(v, le), sof))).toEqual({ w: 400, h: 300 });
        }
      }
    });

    it('skips 0xFF fill bytes and standalone markers', () => {
      expect(imageNaturalSize(jpeg([0xff, 0xff], [0xff, 0xd0], sof))).toEqual({ w: 400, h: 300 });
    });

    it('steps over DHT rather than reading it as a frame', () => {
      const dht = [0xff, 0xc4, 0x00, 0x04, 0x00, 0x00];
      expect(imageNaturalSize(jpeg(dht, sof))).toEqual({ w: 400, h: 300 });
    });

    it('returns null for a malformed segment walk', () => {
      // A zero length would never advance the walk.
      expect(imageNaturalSize(jpeg([0xff, 0xe0, 0x00, 0x00], sof))).toBeNull();
      // A byte that is not a marker where one must be.
      expect(imageNaturalSize(jpeg([0x12, 0x34], sof))).toBeNull();
      // A SOF cut off before its dimensions.
      expect(imageNaturalSize(jpeg(sof.slice(0, 6)))).toBeNull();
      // A malformed EXIF block is ignored, not trusted.
      expect(imageNaturalSize(jpeg([0xff, 0xe1, 0x00, 0x08, ...ascii('Exif'), 0, 0], sof))).toEqual({ w: 400, h: 300 });
    });
  });
});

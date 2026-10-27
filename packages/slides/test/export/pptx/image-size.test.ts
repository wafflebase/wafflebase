import { describe, it, expect } from 'vitest';
import { imageNaturalSize } from '../../../src/export/pptx/image-size.js';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
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
});

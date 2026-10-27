/**
 * Natural pixel size of an encoded image, read from its header bytes.
 *
 * The exporter needs it to bake an image's `fit` into OOXML (a `'cover'`
 * crop or a `'contain'` frame) but runs in Node with no decoder, so this
 * reads the four formats the workspace image uploader accepts — PNG, JPEG,
 * GIF and WebP. Anything else (SVG, a truncated file) returns `null`, and
 * the caller exports the image stretched, as it did before `fit` existed.
 */
export function imageNaturalSize(
  bytes: Uint8Array,
): { w: number; h: number } | null {
  const b = bytes;
  const u16be = (o: number) => (b[o] << 8) | b[o + 1];
  const u16le = (o: number) => b[o] | (b[o + 1] << 8);
  const u24le = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  const u32be = (o: number) =>
    ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const ascii = (o: number, n: number) =>
    String.fromCharCode(...b.subarray(o, o + n));
  const ok = (w: number, h: number) => (w > 0 && h > 0 ? { w, h } : null);

  // PNG: signature, then the IHDR chunk's width/height.
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG') {
    return ok(u32be(16), u32be(20));
  }
  // GIF: logical screen width/height, little-endian.
  if (b.length >= 10 && ascii(0, 3) === 'GIF') {
    return ok(u16le(6), u16le(8));
  }
  // WebP: RIFF container, then one of three chunk kinds.
  if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4);
    if (kind === 'VP8 ') return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff);
    if (kind === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return ok((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (kind === 'VP8X') return ok(u24le(24) + 1, u24le(27) + 1);
    return null;
  }
  // JPEG: walk the segments to the first start-of-frame marker.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null;
      const marker = b[o + 1];
      // SOF0–SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return ok(u16be(o + 7), u16be(o + 5));
      }
      o += 2 + u16be(o + 2);
    }
  }
  return null;
}

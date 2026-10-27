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
    // EXIF Orientation 5–8 is a quarter turn. Browsers apply it before
    // reporting `naturalWidth/Height` — the size the canvas renderer fits
    // with — so the exporter must swap the coded size to match.
    let quarterTurn = false;
    let o = 2;
    while (o + 4 <= b.length) {
      if (b[o] !== 0xff) return null;
      const marker = b[o + 1];
      // 0xFF fill bytes may pad before a marker.
      if (marker === 0xff) {
        o += 1;
        continue;
      }
      // Standalone markers (TEM, RST0–7) carry no length.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        o += 2;
        continue;
      }
      const len = u16be(o + 2);
      if (len < 2) return null;
      if (marker === 0xe1) quarterTurn ||= exifQuarterTurn(b, o + 4, o + 2 + len);
      // SOF0–SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        if (o + 9 > b.length) return null;
        const w = u16be(o + 7);
        const h = u16be(o + 5);
        return quarterTurn ? ok(h, w) : ok(w, h);
      }
      o += 2 + len;
    }
  }
  return null;
}

/**
 * Whether the APP1 payload `b[start, end)` is an EXIF block whose IFD0
 * Orientation (tag 0x0112) is 5–8, i.e. rotates the picture a quarter turn.
 * Anything malformed reads as "no rotation".
 */
function exifQuarterTurn(b: Uint8Array, start: number, end: number): boolean {
  end = Math.min(end, b.length);
  // "Exif\0\0", then the TIFF header.
  const tiff = start + 6;
  if (tiff + 8 > end) return false;
  if (
    b[start] !== 0x45 || b[start + 1] !== 0x78 ||
    b[start + 2] !== 0x69 || b[start + 3] !== 0x66 ||
    b[start + 4] !== 0 || b[start + 5] !== 0
  ) {
    return false;
  }
  const le = b[tiff] === 0x49 && b[tiff + 1] === 0x49; // "II"
  if (!le && !(b[tiff] === 0x4d && b[tiff + 1] === 0x4d)) return false; // "MM"
  const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) =>
    (le
      ? b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)
      : (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return false;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return false;
    if (u16(entry) === 0x0112) {
      const v = u16(entry + 8);
      return v >= 5 && v <= 8;
    }
  }
  return false;
}

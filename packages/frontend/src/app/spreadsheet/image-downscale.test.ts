import { describe, it, expect, vi } from "vitest";
import {
  downscaleImageFile,
  type ImageCodec,
  type DecodedImage,
} from "./image-downscale";

const LIMIT = 1000;

/**
 * A file whose bytes are a still PNG — enough for the animation sniff to read
 * it — but whose reported size is whatever the test needs.
 */
function fileOf(size: number, type: string, name = "shot.png"): File {
  const file = new File([stillPngBytes()], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function bytesOf(...parts: Array<string | number[]>): Uint8Array<ArrayBuffer> {
  const flat = parts.flatMap((part) =>
    typeof part === "string" ? [...part].map((ch) => ch.charCodeAt(0)) : part,
  );
  return new Uint8Array(flat);
}

/** A WebP header, extended (`VP8X`) or not, with the ANIM flag set or not. */
function webpFile(opts: { extended: boolean; animation: boolean }): File {
  const header = opts.extended
    ? bytesOf(
        "RIFF",
        [0, 0, 0, 0],
        "WEBP",
        "VP8X",
        [10, 0, 0, 0],
        [opts.animation ? 0x02 : 0x00],
        new Array(64).fill(0),
      )
    : bytesOf("RIFF", [0, 0, 0, 0], "WEBP", "VP8 ", new Array(64).fill(0));
  const file = new File([header], "sticker.webp", { type: "image/webp" });
  Object.defineProperty(file, "size", { value: LIMIT * 5 });
  return file;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function charCodes(text: string): number[] {
  return [...text].map((ch) => ch.charCodeAt(0));
}

/** A length-prefixed PNG chunk: length, type, payload, and a zeroed CRC. */
function pngChunk(type: string, data: number[] = []): number[] {
  const n = data.length;
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
    ...charCodes(type),
    ...data,
    0,
    0,
    0,
    0,
  ];
}

function pngFileOf(...chunks: number[][]): File {
  const bytes = new Uint8Array([...PNG_SIGNATURE, ...chunks.flat()]);
  const file = new File([bytes], "shot.png", { type: "image/png" });
  Object.defineProperty(file, "size", { value: LIMIT * 5 });
  return file;
}

const IHDR = pngChunk("IHDR", new Array(13).fill(0));
const IDAT = pngChunk("IDAT", new Array(8).fill(0));
const ACTL = pngChunk("acTL", new Array(8).fill(0));

function stillPngBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([...PNG_SIGNATURE, ...IHDR, ...IDAT]);
}

/**
 * Real bytes, not a faked `size` — `downscaleImageFile` re-wraps the blob in a
 * `File`, which recomputes its size from the actual content.
 */
function blobOf(size: number, type: string): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

/**
 * A codec whose encoded size shrinks with the drawn pixel count, the way a
 * real one does: `bytesPerPixel` × width × height.
 */
function codecOf(
  image: DecodedImage,
  bytesPerPixel: number,
  outType?: string,
): ImageCodec & { calls: Array<{ width: number; height: number }> } {
  const calls: Array<{ width: number; height: number }> = [];
  return {
    calls,
    decode: vi.fn().mockResolvedValue(image),
    encode: vi.fn(async (_img, width, height, type) => {
      calls.push({ width, height });
      return blobOf(
        Math.round(width * height * bytesPerPixel),
        outType ?? type,
      );
    }),
  };
}

describe("downscaleImageFile", () => {
  it("returns a file that already fits untouched, without decoding it", async () => {
    const codec = codecOf({ width: 100, height: 100 }, 1);
    const file = fileOf(LIMIT, "image/png");

    expect(await downscaleImageFile(file, LIMIT, codec)).toBe(file);
    expect(codec.decode).not.toHaveBeenCalled();
  });

  it("never re-encodes a GIF, because a canvas keeps only its first frame", async () => {
    const codec = codecOf({ width: 100, height: 100 }, 0.001);
    const file = fileOf(LIMIT * 5, "image/gif", "loop.gif");

    expect(await downscaleImageFile(file, LIMIT, codec)).toBe(file);
    expect(codec.encode).not.toHaveBeenCalled();
  });

  it("leaves an animated WebP alone but still shrinks a still one", async () => {
    const animated = webpFile({ extended: true, animation: true });
    const still = webpFile({ extended: true, animation: false });
    const codecA = codecOf({ width: 10, height: 10 }, 0.001);
    const codecS = codecOf({ width: 10, height: 10 }, 0.001);

    expect(await downscaleImageFile(animated, LIMIT, codecA)).toBe(animated);
    expect(codecA.encode).not.toHaveBeenCalled();
    expect(await downscaleImageFile(still, LIMIT, codecS)).not.toBe(still);
  });

  it("leaves an APNG alone but still shrinks a plain PNG", async () => {
    const apng = pngFileOf(IHDR, ACTL, IDAT);
    const plain = pngFileOf(IHDR, IDAT);
    const codecA = codecOf({ width: 10, height: 10 }, 0.001);
    const codecP = codecOf({ width: 10, height: 10 }, 0.001);

    expect(await downscaleImageFile(apng, LIMIT, codecA)).toBe(apng);
    expect(codecA.encode).not.toHaveBeenCalled();
    expect(await downscaleImageFile(plain, LIMIT, codecP)).not.toBe(plain);
  });

  it("does not mistake the letters acTL inside a chunk payload for animation", async () => {
    const withMetadata = pngFileOf(
      IHDR,
      pngChunk("iTXt", charCodes("Comment\0made from an acTL sample")),
      IDAT,
    );
    const codec = codecOf({ width: 10, height: 10 }, 0.001);

    expect(await downscaleImageFile(withMetadata, LIMIT, codec)).not.toBe(
      withMetadata,
    );
  });

  it("does not call a PNG still just because acTL sits past the sniff window", async () => {
    // A colour profile fat enough to push `acTL` out of the read window: the
    // chunk chain runs off the end, which is undetermined, not "still".
    const apng = pngFileOf(
      IHDR,
      pngChunk("iCCP", new Array(100 * 1024).fill(0)),
      ACTL,
      IDAT,
    );
    const codec = codecOf({ width: 10, height: 10 }, 0.001);

    expect(await downscaleImageFile(apng, LIMIT, codec)).toBe(apng);
    expect(codec.encode).not.toHaveBeenCalled();
  });

  it("declines to shrink a file it cannot read rather than risk flattening it", async () => {
    const file = fileOf(LIMIT * 2, "image/webp", "unreadable.webp");
    file.slice = () =>
      ({
        arrayBuffer: () => Promise.reject(new Error("gone")),
      }) as unknown as Blob;
    const codec = codecOf({ width: 10, height: 10 }, 0.001);

    expect(await downscaleImageFile(file, LIMIT, codec)).toBe(file);
    expect(codec.encode).not.toHaveBeenCalled();
  });

  it("re-encodes at full size when that alone gets under the limit", async () => {
    const image = { width: 100, height: 100 };
    const codec = codecOf(image, 0.05); // 100×100 → 500 bytes
    const out = await downscaleImageFile(
      fileOf(LIMIT * 4, "image/png"),
      LIMIT,
      codec,
    );

    expect(out.size).toBe(500);
    expect(codec.calls).toEqual([{ width: 100, height: 100 }]);
  });

  it("escalates through scale steps until an encode fits", async () => {
    const image = { width: 100, height: 100 };
    const codec = codecOf(image, 0.3); // full size → 3000 bytes, 0.5 → 750
    const out = await downscaleImageFile(
      fileOf(LIMIT * 9, "image/png"),
      LIMIT,
      codec,
    );

    expect(out.size).toBeLessThanOrEqual(LIMIT);
    expect(codec.calls).toEqual([
      { width: 100, height: 100 },
      { width: 70, height: 70 },
      { width: 50, height: 50 },
    ]);
  });

  it("caps the longest side at 4096 before applying the scale steps", async () => {
    const image = { width: 8192, height: 4096 };
    const codec = codecOf(image, 0.0001);
    await downscaleImageFile(fileOf(LIMIT * 50, "image/png"), LIMIT, codec);

    expect(codec.calls[0]).toEqual({ width: 4096, height: 2048 });
  });

  it("hands back the smallest attempt when even the last step overshoots", async () => {
    const image = { width: 1000, height: 1000 };
    const codec = codecOf(image, 1); // smallest step (0.25) still 62500 bytes
    const original = fileOf(LIMIT * 1000, "image/png");
    const out = await downscaleImageFile(original, LIMIT, codec);

    expect(codec.calls).toHaveLength(5);
    expect(out).not.toBe(original);
    expect(out.size).toBe(250 * 250);
  });

  it("never hands back something bigger than what it was given", async () => {
    // A re-encode can overshoot the source (a lossless PNG of flat colour
    // beats WebP at it). Keeping the smaller of the two means the failure
    // message reports the user's own file rather than a worse copy of it.
    const image = { width: 10, height: 10 };
    const codec = codecOf(image, 1000); // every step encodes far over LIMIT * 2
    const original = fileOf(LIMIT * 2, "image/png");

    expect(await downscaleImageFile(original, LIMIT, codec)).toBe(original);
  });

  it("keeps alpha by encoding a PNG as WebP, and leaves a JPEG as JPEG", async () => {
    const image = { width: 10, height: 10 };
    const png = codecOf(image, 1);
    const jpeg = codecOf(image, 1);

    const fromPng = await downscaleImageFile(
      fileOf(LIMIT * 2, "image/png", "a.png"),
      LIMIT,
      png,
    );
    const fromJpeg = await downscaleImageFile(
      fileOf(LIMIT * 2, "image/jpeg", "b.jpg"),
      LIMIT,
      jpeg,
    );

    expect(fromPng.type).toBe("image/webp");
    expect(fromPng.name).toBe("a.webp");
    expect(fromJpeg.type).toBe("image/jpeg");
    expect(fromJpeg.name).toBe("b.jpg");
  });

  it("follows the encoder when it falls back to another type", async () => {
    // Safari's toBlob ignores an unsupported type and emits PNG instead;
    // storing those bytes under a .webp name would serve the wrong type.
    const codec = codecOf({ width: 10, height: 10 }, 1, "image/png");
    const out = await downscaleImageFile(
      fileOf(LIMIT * 2, "image/png", "a.png"),
      LIMIT,
      codec,
    );

    expect(out.type).toBe("image/png");
    expect(out.name).toBe("a.png");
  });

  it("returns the original when the image cannot be decoded", async () => {
    const codec = codecOf({ width: 10, height: 10 }, 1);
    codec.decode = vi.fn().mockRejectedValue(new Error("corrupt"));
    const file = fileOf(LIMIT * 2, "image/png");

    expect(await downscaleImageFile(file, LIMIT, codec)).toBe(file);
  });

  it("returns the original when encoding fails outright", async () => {
    const codec = codecOf({ width: 10, height: 10 }, 1);
    codec.encode = vi.fn().mockRejectedValue(new Error("no context"));
    const file = fileOf(LIMIT * 2, "image/png");

    expect(await downscaleImageFile(file, LIMIT, codec)).toBe(file);
  });

  it("returns the original when the encoder yields no blob", async () => {
    const codec = codecOf({ width: 10, height: 10 }, 1);
    codec.encode = vi.fn().mockResolvedValue(null);
    const file = fileOf(LIMIT * 2, "image/png");

    expect(await downscaleImageFile(file, LIMIT, codec)).toBe(file);
  });

  it("releases the decoded bitmap even when encoding throws", async () => {
    const close = vi.fn();
    const codec = codecOf({ width: 10, height: 10, close }, 1);
    codec.encode = vi.fn().mockRejectedValue(new Error("no context"));
    await downscaleImageFile(fileOf(LIMIT * 2, "image/png"), LIMIT, codec);

    expect(close).toHaveBeenCalledTimes(1);
  });
});

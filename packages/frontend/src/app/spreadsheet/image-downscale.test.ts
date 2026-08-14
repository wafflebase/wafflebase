import { describe, it, expect, vi } from "vitest";
import {
  downscaleImageFile,
  type ImageCodec,
  type DecodedImage,
} from "./image-downscale";

const LIMIT = 1000;

function fileOf(size: number, type: string, name = "shot.png"): File {
  const file = new File(["x"], name, { type });
  // `File` in jsdom sizes itself from its parts; the tests care about the
  // size/type pair, not the bytes.
  Object.defineProperty(file, "size", { value: size });
  return file;
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
      return blobOf(Math.round(width * height * bytesPerPixel), outType ?? type);
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

  it("re-encodes at full size when that alone gets under the limit", async () => {
    const image = { width: 100, height: 100 };
    const codec = codecOf(image, 0.05); // 100×100 → 500 bytes
    const out = await downscaleImageFile(fileOf(LIMIT * 4, "image/png"), LIMIT, codec);

    expect(out.size).toBe(500);
    expect(codec.calls).toEqual([{ width: 100, height: 100 }]);
  });

  it("escalates through scale steps until an encode fits", async () => {
    const image = { width: 100, height: 100 };
    const codec = codecOf(image, 0.3); // full size → 3000 bytes, 0.5 → 750
    const out = await downscaleImageFile(fileOf(LIMIT * 9, "image/png"), LIMIT, codec);

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

    const fromPng = await downscaleImageFile(fileOf(LIMIT * 2, "image/png", "a.png"), LIMIT, png);
    const fromJpeg = await downscaleImageFile(fileOf(LIMIT * 2, "image/jpeg", "b.jpg"), LIMIT, jpeg);

    expect(fromPng.type).toBe("image/webp");
    expect(fromPng.name).toBe("a.webp");
    expect(fromJpeg.type).toBe("image/jpeg");
    expect(fromJpeg.name).toBe("b.jpg");
  });

  it("follows the encoder when it falls back to another type", async () => {
    // Safari's toBlob ignores an unsupported type and emits PNG instead;
    // storing those bytes under a .webp name would serve the wrong type.
    const codec = codecOf({ width: 10, height: 10 }, 1, "image/png");
    const out = await downscaleImageFile(fileOf(LIMIT * 2, "image/png", "a.png"), LIMIT, codec);

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

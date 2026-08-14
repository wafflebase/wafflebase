import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/api/auth", () => ({ fetchWithAuth: vi.fn() }));
vi.mock("./image-downscale", () => ({ downscaleImageFile: vi.fn() }));

import { uploadImageFile } from "./image-upload";
import { downscaleImageFile } from "./image-downscale";
import { fetchWithAuth } from "@/api/auth";

const MB = 1024 * 1024;

function fileOf(size: number, type = "image/png", name = "shot.png"): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/**
 * The upload path probes the image's natural size through an `<img>`, which
 * jsdom never loads. Fire `onload` with fixed dimensions instead.
 */
function stubImageDimensions(width = 320, height = 240) {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  Object.defineProperty(Image.prototype, "src", {
    configurable: true,
    set(this: HTMLImageElement) {
      Object.defineProperty(this, "naturalWidth", { value: width });
      Object.defineProperty(this, "naturalHeight", { value: height });
      queueMicrotask(() => this.onload?.(new Event("load")));
    },
  });
}

function stubUploadResponse() {
  vi.mocked(fetchWithAuth).mockResolvedValue({
    ok: true,
    json: async () => ({ id: "img-1", url: "/api/v1/img-1" }),
  } as Response);
}

describe("uploadImageFile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(downscaleImageFile).mockReset();
    vi.mocked(fetchWithAuth).mockReset();
    stubImageDimensions();
    stubUploadResponse();
  });

  it("rejects an unsupported type before trying to downscale it", async () => {
    await expect(uploadImageFile(fileOf(1, "image/svg+xml"), "ws-1")).rejects.toThrow(
      "Unsupported file type: image/svg+xml",
    );
    expect(downscaleImageFile).not.toHaveBeenCalled();
  });

  it("uploads a file under the limit as-is, without downscaling", async () => {
    const file = fileOf(2 * MB);
    await uploadImageFile(file, "ws-1");

    expect(downscaleImageFile).not.toHaveBeenCalled();
    const body = vi.mocked(fetchWithAuth).mock.calls[0][1]?.body as FormData;
    expect(body.get("file")).toBe(file);
  });

  it("uploads the downscaled bytes when the original is over the limit", async () => {
    const shrunk = fileOf(3 * MB, "image/webp", "shot.webp");
    vi.mocked(downscaleImageFile).mockResolvedValue(shrunk);

    const result = await uploadImageFile(fileOf(40 * MB), "ws-1");

    expect(downscaleImageFile).toHaveBeenCalledWith(expect.anything(), 10 * MB);
    const body = vi.mocked(fetchWithAuth).mock.calls[0][1]?.body as FormData;
    expect(body.get("file")).toBe(shrunk);
    expect(result).toMatchObject({ id: "img-1", width: 320, height: 240 });
  });

  it("names the limit and both sizes when downscaling ran and fell short", async () => {
    vi.mocked(downscaleImageFile).mockResolvedValue(fileOf(12.5 * MB));

    await expect(uploadImageFile(fileOf(40 * MB), "ws-1")).rejects.toThrow(
      "Image is still 12.5 MB after downscaling (was 40 MB), over the 10 MB limit",
    );
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("names the limit and the actual size when downscaling was not possible", async () => {
    // A GIF comes back untouched — the same object it went in as.
    const gif = fileOf(14.2 * MB, "image/gif", "loop.gif");
    vi.mocked(downscaleImageFile).mockResolvedValue(gif);

    await expect(uploadImageFile(gif, "ws-1")).rejects.toThrow(
      "Image is 14.2 MB, over the 10 MB limit",
    );
  });
});

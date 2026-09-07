import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/api/auth", () => ({ fetchWithAuth: vi.fn() }));

import {
  insertImageFromFile,
  shareTokenImageUploader,
} from "./image-insert";
import { fetchWithAuth } from "@/api/auth";
import type { EditorAPI } from "@wafflebase/docs";

const SRC_SEEN: string[] = [];

function pngFile(name = "shot.png"): File {
  return new File(["x"], name, { type: "image/png" });
}

/**
 * jsdom never loads an `<img>`, so resolve every `src` assignment with fixed
 * dimensions — and record what was assigned, which is what lets the test below
 * assert that no *network* URL is ever probed.
 */
function stubImageLoads(width = 320, height = 240) {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  Object.defineProperty(Image.prototype, "src", {
    configurable: true,
    set(this: HTMLImageElement, value: string) {
      SRC_SEEN.push(value);
      Object.defineProperty(this, "naturalWidth", { value: width });
      Object.defineProperty(this, "naturalHeight", { value: height });
      queueMicrotask(() => this.onload?.(new Event("load")));
    },
  });
}

function fakeEditor() {
  return {
    insertImage: vi.fn(),
    focus: vi.fn(),
  } as unknown as EditorAPI & { insertImage: ReturnType<typeof vi.fn> };
}

describe("shareTokenImageUploader", () => {
  beforeEach(() => {
    SRC_SEEN.length = 0;
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "img-1.png",
          url: "/api/v1/workspaces/ws-1/images/img-1.png",
        }),
      } as Response),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the share-token route with the token url-encoded", async () => {
    await shareTokenImageUploader("a b/c")(pngFile());

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    // Prefixed with `VITE_BACKEND_API_URL` when one is configured, which it is
    // in this test env — assert the path and the encoding, not the origin.
    expect(String(url)).toMatch(
      /\/api\/v1\/shared\/images\?token=a%20b%2Fc$/,
    );
    expect(init?.method).toBe("POST");
  });

  it("never routes through fetchWithAuth", async () => {
    // fetchWithAuth turns a 401/403 into logout() + redirect to /login, which
    // for a visitor whose only credential is the link destroys their access.
    await shareTokenImageUploader("tok")(pngFile());
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("surfaces the server's message, not the raw JSON body", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      text: async () =>
        '{"message":"This share link is read-only","statusCode":403}',
    } as Response);

    await expect(shareTokenImageUploader("tok")(pngFile())).rejects.toThrow(
      "This share link is read-only",
    );
  });
});

describe("insertImageFromFile", () => {
  beforeEach(() => {
    SRC_SEEN.length = 0;
    vi.restoreAllMocks();
    stubImageLoads();
  });

  it("measures the local file and never probes the uploaded URL", async () => {
    // The share-link URL is workspace-scoped and readable only with the
    // visitor's `?token=` appended, which the stored URL deliberately does not
    // carry — so probing it over the network would 403 and lose the insert
    // after a successful upload (issue #1037).
    const editor = fakeEditor();
    const upload = vi
      .fn()
      .mockResolvedValue("/api/v1/workspaces/ws-1/images/img-1.png");

    await insertImageFromFile(editor, pngFile(), undefined, upload);

    expect(SRC_SEEN).toEqual(["blob:local"]);
    expect(editor.insertImage).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws-1/images/img-1.png",
      320,
      240,
      expect.objectContaining({ originalWidth: 320, originalHeight: 240 }),
    );
  });

  it("uses the passed uploader rather than the owner default", async () => {
    const editor = fakeEditor();
    const upload = vi.fn().mockResolvedValue("/shared.png");

    await insertImageFromFile(editor, pngFile(), undefined, upload);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("inserts nothing when the upload is refused", async () => {
    const editor = fakeEditor();
    const upload = vi.fn().mockRejectedValue(new Error("read-only"));

    await insertImageFromFile(editor, pngFile(), undefined, upload);

    expect(editor.insertImage).not.toHaveBeenCalled();
  });
});

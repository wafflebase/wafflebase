import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchWithAuth = vi.fn();
vi.mock("../../src/api/auth", () => ({
  fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...a),
}));

import { uploadFile, fileUrl } from "../../src/api/files";

describe("files api", () => {
  beforeEach(() => fetchWithAuth.mockReset());

  it("POSTs multipart form data and returns the id", async () => {
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({ id: "x.pdf" }) });
    const file = new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" });
    const res = await uploadFile(file);
    expect(res).toEqual({ id: "x.pdf" });
    const [url, opts] = fetchWithAuth.mock.calls[0];
    expect(String(url)).toMatch(/\/files$/);
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it("throws on a non-ok response", async () => {
    fetchWithAuth.mockResolvedValue({
      ok: false,
      status: 413,
      statusText: "Too Large",
      headers: { get: () => null },
      text: async () => "",
    });
    const file = new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" });
    await expect(uploadFile(file)).rejects.toThrow(/File upload failed/);
  });

  it("builds a document-scoped file url", () => {
    expect(fileUrl("d1")).toMatch(/\/documents\/d1\/file$/);
  });
});

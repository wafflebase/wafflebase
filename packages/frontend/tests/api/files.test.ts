import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchWithAuth = vi.fn();
vi.mock("../../src/api/auth", () => ({
  fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...a),
}));

import { uploadPdf, pdfFileUrl } from "../../src/api/files";

describe("files api", () => {
  beforeEach(() => fetchWithAuth.mockReset());

  it("POSTs multipart form data and returns the id", async () => {
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({ id: "x.pdf" }) });
    const file = new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" });
    const res = await uploadPdf(file);
    expect(res).toEqual({ id: "x.pdf" });
    const [url, opts] = fetchWithAuth.mock.calls[0];
    expect(String(url)).toMatch(/\/files$/);
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it("throws on a non-ok response", async () => {
    fetchWithAuth.mockResolvedValue({ ok: false, status: 413, statusText: "Too Large" });
    const file = new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" });
    await expect(uploadPdf(file)).rejects.toThrow(/413/);
  });

  it("builds a document-scoped file url", () => {
    expect(pdfFileUrl("d1")).toMatch(/\/documents\/d1\/file$/);
  });
});

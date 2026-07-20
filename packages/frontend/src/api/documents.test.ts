import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./auth", () => ({ fetchWithAuth: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { fetchWithAuth } from "./auth";
import { moveDocuments, deleteDocuments } from "./documents";

const mockFetch = vi.mocked(fetchWithAuth);

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("moveDocuments", () => {
  beforeEach(() => mockFetch.mockReset());

  it("PATCHes documents/move with ids + target", async () => {
    mockFetch.mockResolvedValue(okJson({ moved: ["a", "b"] }));
    const res = await moveDocuments(["a", "b"], { folderId: "fld1" });
    expect(res).toEqual({ moved: ["a", "b"] });
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/documents\/move$/);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init!.body as string)).toEqual({
      ids: ["a", "b"],
      folderId: "fld1",
    });
  });
});

describe("deleteDocuments", () => {
  beforeEach(() => mockFetch.mockReset());

  it("POSTs documents/delete with ids", async () => {
    mockFetch.mockResolvedValue(okJson({ deleted: ["a"] }));
    const res = await deleteDocuments(["a"]);
    expect(res).toEqual({ deleted: ["a"] });
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/documents\/delete$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({ ids: ["a"] });
  });
});

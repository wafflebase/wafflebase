import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./auth", () => ({ fetchWithAuth: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { fetchWithAuth } from "./auth";
import {
  moveDocuments,
  deleteDocuments,
  copyDocument,
  copyDocuments,
  BulkCopyError,
} from "./documents";

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

describe("copyDocument", () => {
  beforeEach(() => mockFetch.mockReset());

  it("POSTs documents/:id/copy and returns the created document", async () => {
    mockFetch.mockResolvedValue(okJson({ id: "copy-1", title: "R (copy)" }));
    const res = await copyDocument("src-1");
    expect(res).toEqual({ id: "copy-1", title: "R (copy)" });
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/documents\/src-1\/copy$/);
    expect(init?.method).toBe("POST");
    // No body: the server derives title, workspace and folder from the source.
    expect(init?.body).toBeUndefined();
  });

  it("throws when the server rejects the copy", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ message: "nope" }),
      text: async () => '{"message":"nope"}',
    } as Response);
    await expect(copyDocument("src-1")).rejects.toThrow("nope");
  });
});

describe("copyDocuments", () => {
  beforeEach(() => mockFetch.mockReset());

  it("copies sequentially, one request per id, in order", async () => {
    const order: string[] = [];
    mockFetch.mockImplementation(async (...args) => {
      const id = String(args[0]).replace(/^.*\/documents\/(.*)\/copy$/, "$1");
      order.push(id);
      return okJson({ id: `${id}-copy` });
    });
    const res = await copyDocuments(["a", "b", "c"]);
    expect(order).toEqual(["a", "b", "c"]);
    expect(res.map((d) => d.id)).toEqual(["a-copy", "b-copy", "c-copy"]);
  });

  it("reports the copies already created when one fails part-way", async () => {
    mockFetch
      .mockResolvedValueOnce(okJson({ id: "a-copy" }))
      .mockRejectedValueOnce(new Error("network down"));
    const err = await copyDocuments(["a", "b", "c"]).catch((e) => e);
    expect(err).toBeInstanceOf(BulkCopyError);
    expect((err as BulkCopyError).copied.map((d) => d.id)).toEqual(["a-copy"]);
    // It stops at the first failure — "c" is never attempted.
    expect(mockFetch).toHaveBeenCalledTimes(2);
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

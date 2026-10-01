import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./auth", () => ({ fetchWithAuth: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/offline-erase", () => ({ purgeOfflineDocuments: vi.fn() }));

import { purgeOfflineDocuments } from "@/lib/offline-erase";

import { fetchWithAuth } from "./auth";
import {
  moveDocuments,
  deleteDocuments,
  copyDocument,
  copyDocuments,
  fetchDocument,
  renameDocument,
  deleteDocument,
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

/**
 * Route-param ids are pinned to their own path segment, the same rule the CLI
 * enforces: a session-carrying request must reach the endpoint the caller
 * named, not one an id walked it onto.
 */
describe("id encoding in document routes", () => {
  beforeEach(() => mockFetch.mockReset());

  const traversal = "../../workspaces/other-ws/api-keys/key-1";
  const encoded =
    "..%2F..%2Fworkspaces%2Fother-ws%2Fapi-keys%2Fkey-1";

  it("keeps a traversal id inside one segment on GET/PATCH/DELETE/copy", async () => {
    mockFetch.mockResolvedValue(okJson({ id: "d" }));

    await fetchDocument(traversal);
    await renameDocument(traversal, "t");
    await copyDocument(traversal);
    await deleteDocument(traversal);

    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toMatch(new RegExp(`/documents/${encoded}$`));
    expect(urls[1]).toMatch(new RegExp(`/documents/${encoded}$`));
    expect(urls[2]).toMatch(new RegExp(`/documents/${encoded}/copy$`));
    expect(urls[3]).toMatch(new RegExp(`/documents/${encoded}$`));
    // Survives WHATWG normalization: the request still targets /documents/<id>.
    for (const u of urls) {
      expect(new URL(u, "https://api.example.test").pathname).toContain(
        `/documents/${encoded}`,
      );
    }
  });

  it("refuses a dot-segment id rather than sending a walked-up request", async () => {
    await expect(fetchDocument("..")).rejects.toThrow("Invalid path segment");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("deleteDocuments", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.mocked(purgeOfflineDocuments).mockReset();
  });

  it("POSTs documents/delete with ids", async () => {
    mockFetch.mockResolvedValue(okJson({ deleted: ["a"] }));
    const res = await deleteDocuments(["a"]);
    expect(res).toEqual({ deleted: ["a"] });
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/documents\/delete$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({ ids: ["a"] });
  });

  it("drops the local copy of only what the server says it deleted", async () => {
    // The route is manager-gated per id, so a partial answer is ordinary.
    // Dropping the local copy of a document that is still there would delete
    // unsent work the user can still push.
    mockFetch.mockResolvedValue(okJson({ deleted: ["a"] }));
    await deleteDocuments(["a", "b"]);
    expect(purgeOfflineDocuments).toHaveBeenCalledWith(["a"]);
  });

  it("drops nothing when the server deleted nothing", async () => {
    mockFetch.mockResolvedValue(okJson({ deleted: [] }));
    await deleteDocuments(["a"]);
    expect(purgeOfflineDocuments).toHaveBeenCalledWith([]);
  });

  it("survives a response with no deleted list", async () => {
    mockFetch.mockResolvedValue(okJson({}));
    await expect(deleteDocuments(["a"])).resolves.toEqual({});
    expect(purgeOfflineDocuments).toHaveBeenCalledWith([]);
  });
});

describe("deleteDocument", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.mocked(purgeOfflineDocuments).mockReset();
  });

  it("drops the local copy once the server has accepted the deletion", async () => {
    mockFetch.mockResolvedValue(okJson({}));
    await deleteDocument("a");
    expect(purgeOfflineDocuments).toHaveBeenCalledWith(["a"]);
  });

  it("keeps the local copy when the deletion was refused", async () => {
    // A refused delete leaves the document — and the user's unsent work in it —
    // in place. Purging on the failure path would destroy the only copy of it.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ message: "nope" }),
    } as Response);
    await expect(deleteDocument("a")).rejects.toThrow();
    expect(purgeOfflineDocuments).not.toHaveBeenCalled();
  });
});

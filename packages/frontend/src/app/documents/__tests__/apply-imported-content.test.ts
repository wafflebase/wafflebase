import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared mock state must be hoisted: vi.mock factories run before top-level
// consts initialize, and several factories reference these spies eagerly.
const h = vi.hoisted(() => {
  type FakeDoc = {
    key: string;
    root: Record<string, unknown>;
    update: (fn: (r: Record<string, unknown>) => void) => void;
  };
  return {
    client: {
      activate: vi.fn(async () => {}),
      attach: vi.fn(async () => {}),
      detach: vi.fn(async () => {}),
      deactivate: vi.fn(async () => {}),
    },
    ensureSlidesRoot: vi.fn(),
    setDocument: vi.fn(),
    state: {
      lastDoc: null as FakeDoc | null,
      attachedRoots: [] as unknown[],
    },
  };
});

// Yorkie SDK: spy client + a Document whose update() runs against a plain root.
// Use `function` (not arrows) so `new Client()` / `new Document()` construct.
vi.mock("@yorkie-js/sdk", () => ({
  Client: vi.fn(function () {
    return h.client;
  }),
  Document: vi.fn(function (key: string) {
    const doc = {
      key,
      root: {} as Record<string, unknown>,
      update: vi.fn((fn: (r: Record<string, unknown>) => void) => fn(doc.root)),
    };
    h.state.lastDoc = doc;
    return doc;
  }),
}));
vi.mock("@/api/auth", () => ({ fetchYorkieToken: vi.fn(async () => "tok") }));
vi.mock("@wafflebase/sheets", () => ({
  initialSpreadsheetDocument: () => ({ seed: "sheet" }),
}));
vi.mock("@/types/docs-document", () => ({
  initialDocsRoot: () => ({ seed: "docs" }),
}));
vi.mock("@/app/docs/yorkie-doc-store", () => ({
  YorkieDocStore: vi.fn(function () {
    return { setDocument: h.setDocument };
  }),
}));
vi.mock("@/app/slides/yorkie-slides-store", () => ({
  ensureSlidesRoot: h.ensureSlidesRoot,
}));

// Import after the mocks are registered.
import { applyImportedContent } from "@/app/documents/apply-imported-content";
import { Client, Document } from "@yorkie-js/sdk";
import { YorkieDocStore } from "@/app/docs/yorkie-doc-store";

beforeEach(() => {
  vi.clearAllMocks();
  h.client.activate.mockResolvedValue(undefined);
  h.client.attach.mockImplementation(
    async (_doc: unknown, opts: { initialRoot: unknown }) => {
      h.state.attachedRoots.push(opts?.initialRoot);
    },
  );
  h.client.detach.mockResolvedValue(undefined);
  h.client.deactivate.mockResolvedValue(undefined);
  h.state.attachedRoots.length = 0;
  h.state.lastDoc = null;
});

describe("applyImportedContent", () => {
  it("writes the sheet root and runs the full client lifecycle", async () => {
    await applyImportedContent("id1", {
      type: "sheet",
      document: {
        tabs: { t1: {} },
        tabOrder: ["t1"],
        sheets: { t1: {} },
      } as never,
    });

    expect(Document).toHaveBeenCalledWith("sheet-id1");
    expect(h.client.activate).toHaveBeenCalledTimes(1);
    expect(h.state.attachedRoots[0]).toEqual({ seed: "sheet" });
    expect(h.state.lastDoc?.root).toEqual({
      tabs: { t1: {} },
      tabOrder: ["t1"],
      sheets: { t1: {} },
    });
    expect(h.client.detach).toHaveBeenCalledTimes(1);
    expect(h.client.deactivate).toHaveBeenCalledTimes(1);
    expect(Client).toHaveBeenCalledTimes(1);
  });

  it("applies docs via YorkieDocStore.setDocument", async () => {
    const parsed = { blocks: [] } as never;
    await applyImportedContent("id2", { type: "doc", document: parsed });

    expect(Document).toHaveBeenCalledWith("doc-id2");
    expect(h.state.attachedRoots[0]).toEqual({ seed: "docs" });
    expect(YorkieDocStore).toHaveBeenCalledWith(h.state.lastDoc);
    expect(h.setDocument).toHaveBeenCalledWith(parsed);
    expect(h.client.detach).toHaveBeenCalledTimes(1);
    expect(h.client.deactivate).toHaveBeenCalledTimes(1);
  });

  it("writes the slides root and backfills via ensureSlidesRoot", async () => {
    await applyImportedContent("id3", {
      type: "slides",
      document: {
        meta: { title: "T" },
        themes: [],
        masters: [],
        layouts: [],
        slides: [],
      } as never,
    });

    expect(Document).toHaveBeenCalledWith("slides-id3");
    expect(h.state.lastDoc?.root).toMatchObject({
      meta: { title: "T" },
      themes: [],
      masters: [],
      layouts: [],
      slides: [],
    });
    expect(h.ensureSlidesRoot).toHaveBeenCalledWith(h.state.lastDoc);
    expect(h.client.detach).toHaveBeenCalledTimes(1);
    expect(h.client.deactivate).toHaveBeenCalledTimes(1);
  });

  it("deactivates the client even when attach fails, and surfaces the error", async () => {
    h.client.attach.mockRejectedValueOnce(new Error("attach failed"));

    await expect(
      applyImportedContent("id4", {
        type: "sheet",
        document: { tabs: {}, tabOrder: [], sheets: {} } as never,
      }),
    ).rejects.toThrow("attach failed");

    expect(h.client.deactivate).toHaveBeenCalledTimes(1); // cleanup still ran
  });

  it("does not deactivate a client that never activated", async () => {
    h.client.activate.mockRejectedValueOnce(new Error("activate failed"));

    await expect(
      applyImportedContent("id5", {
        type: "sheet",
        document: { tabs: {}, tabOrder: [], sheets: {} } as never,
      }),
    ).rejects.toThrow("activate failed");

    // activate() is outside the try/finally, so no deactivate on a
    // never-activated client (which would mask the real error).
    expect(h.client.deactivate).not.toHaveBeenCalled();
  });
});

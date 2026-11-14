import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The default `deleteDoc` both import paths use to clean up an orphaned,
 * half-created document.
 *
 * `deleteDocument` is a soft delete that toasts "Moved to Trash", so using it
 * here parked every failed import in the Trash and showed a success toast next
 * to the import error, and `deleteDocumentForever` alone 404s on a live
 * document. Cleanup must remove the orphan permanently and silently through
 * `discardDocument`, so these tests leave `deleteDoc` un-injected and assert which API
 * helper the production default reaches.
 */
const api = vi.hoisted(() => ({
  deleteDocument: vi.fn(async () => {}),
  deleteDocumentForever: vi.fn(async () => {}),
  discardDocument: vi.fn(async () => {}),
}));

vi.mock("@/api/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/documents")>()),
  deleteDocument: api.deleteDocument,
  deleteDocumentForever: api.deleteDocumentForever,
  discardDocument: api.discardDocument,
}));

import * as q from "@/app/documents/upload-queue";
import { startMiroImport } from "@/app/documents/miro-import-runner";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("orphan cleanup default", () => {
  beforeEach(() => {
    q.__resetForTest();
    api.deleteDocument.mockClear();
    api.deleteDocumentForever.mockClear();
    api.discardDocument.mockClear();
  });

  it("upload queue deletes a dismissed orphan permanently, not to Trash", async () => {
    const [item] = q.enqueue([new File([new Uint8Array([1])], "a.xlsx")], "ws1");
    q.startUploads(undefined, {
      importSheetFile: vi.fn(async (f: File) => ({
        document: { tabOrder: ["t"] },
        fileName: f.name,
      })) as never,
      createDoc: vi.fn(async (_ws, p) => ({
        id: "doc-x",
        title: p.title,
        type: p.type,
      })) as never,
      getDocumentPath: () => "/p",
      applyContent: vi.fn(async () => {
        throw new Error("apply failed");
      }) as never,
    });
    await flush();
    await flush();
    expect(q.getSnapshot().find((i) => i.id === item.id)?.docId).toBe("doc-x");

    q.dismissItem(item.id);

    expect(api.discardDocument).toHaveBeenCalledWith("doc-x");
    expect(api.deleteDocument).not.toHaveBeenCalled();
  });

  it("Miro import deletes the orphan permanently, not to Trash", async () => {
    const { finished } = await startMiroImport(
      {
        workspaceId: "ws-1",
        token: "t",
        boardUrl: "https://miro.com/app/board/B=/",
      },
      {
        openStream: vi.fn(async () => ({ ok: true }) as unknown as Response),
        readStream: vi.fn(async () => ({
          items: [{ id: "m1" }],
          connectors: [],
          notes: [],
        })) as never,
        mapItems: vi.fn(() => ({
          inits: [{ type: "shape" }],
          skipped: {},
          approximated: {},
        })) as never,
        resolveImageUrl: (url: string) => url,
        createDoc: vi.fn(async () => ({ id: "doc-9", type: "board" })),
        applyContent: (async () => {
          throw new Error("Yorkie attach failed");
        }) as never,
        getDocumentPath: (doc: { id: string | number }) => `/b/${doc.id}`,
        isAuthExpired: (() => false) as never,
      },
    );
    await finished;

    expect(api.discardDocument).toHaveBeenCalledWith("doc-9");
    expect(api.deleteDocument).not.toHaveBeenCalled();
  });
});

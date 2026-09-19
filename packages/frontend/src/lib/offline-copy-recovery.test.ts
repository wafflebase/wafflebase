import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import yorkie, { Document, Text } from "@yorkie-js/sdk";

const created: Array<{ workspaceId: string; title: string; type?: string }> = [];

/** Workspaces the server would list for this user, for the fallback to find. */
let workspaces: Array<{ id: string }> = [{ id: "ws-fallback" }];
const applied: Array<{ docId: string; content: unknown }> = [];

/** Note documents are seeded through a live client; this stands in for it. */
const attached: Array<Document<{ content?: Text }>> = [];

vi.mock("@yorkie-js/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yorkie-js/sdk")>();
  class FakeClient {
    async activate() {}
    async attach(doc: Document<{ content?: Text }>) {
      attached.push(doc);
    }
    async detach() {}
    isActive() {
      return true;
    }
    async deactivate() {}
  }
  return { ...actual, Client: FakeClient };
});

/**
 * The real create endpoint, standing in for the one the backend actually has.
 *
 * `POST /documents` requires a `workspaceId`; recovery used to omit it, so
 * every "Save a copy" answered 400. This mock refuses a missing workspace for
 * the same reason the DTO does — a stub that accepted one would let the bug
 * back in unnoticed.
 */
vi.mock("@/api/workspaces", () => ({
  createWorkspaceDocument: (
    workspaceId: string,
    payload: { title: string; type?: string },
  ) => {
    if (!workspaceId) {
      return Promise.reject(new Error("workspaceId must not be blank"));
    }
    created.push({ workspaceId, ...payload });
    return Promise.resolve({ id: `new-${created.length}`, ...payload });
  },
  fetchWorkspaces: () => Promise.resolve(workspaces),
}));

vi.mock("@/app/documents/apply-imported-content", () => ({
  applyImportedContent: (docId: string, content: unknown) => {
    applied.push({ docId, content });
    return Promise.resolve({ droppedConnectors: 0 });
  },
}));

vi.mock("@/api/auth", () => ({
  fetchYorkieToken: () => Promise.resolve("token"),
}));

import { YorkieDocStore } from "@/app/docs/yorkie-doc-store";
import type { YorkieDocsRoot } from "@/types/docs-document";
import { WafflebaseDocStore } from "./wafflebase-doc-store";
import { listRecoverableWork } from "./offline-copy";
import {
  describeArchivedDocument,
  recoverOfflineCopy,
} from "./offline-copy-recovery";

/**
 * The last stage: archived bytes become a document the user can open.
 *
 * What these guard is mostly the ordering. The archive is the only copy of
 * work the SDK already gave up on, so every step has to be survivable — the
 * worst outcome available is a duplicate document, never a deleted one.
 */

let counter = 0;

function freshStore(): WafflebaseDocStore {
  counter += 1;
  return new WafflebaseDocStore({
    dbName: `wafflebase-recover-${counter}`,
    userId: "user-1",
  });
}

type SheetRoot = { tabs?: Record<string, unknown>; tabOrder?: Array<string> };

/** Archives a sheet with an edit made after its snapshot. */
async function archiveSheet(
  store: WafflebaseDocStore,
  docKey: string,
): Promise<void> {
  const doc = new Document<SheetRoot>(docKey);
  doc.setActor("000000000000000000000001");
  doc.update((root) => {
    root.tabs = { one: { name: "Sheet1" } };
    root.tabOrder = ["one"];
  });
  await store.saveSnapshot(docKey, doc.toBytes());

  const before = doc.getPendingChangesAfter(0).length;
  doc.update((root) => {
    root.tabOrder = ["one", "typed-offline"];
  });
  for (const change of doc.getPendingChangesAfter(0).slice(before)) {
    await store.appendChange(docKey, {
      clientSeq: change.clientSeq,
      bytes: new TextEncoder().encode(JSON.stringify(change.struct)),
    });
  }

  store.expectLoss(docKey);

  await store.remove(docKey);
}

/**
 * Archives any document shape, with one edit made after the snapshot.
 *
 * The post-snapshot edit is the part that matters: the snapshot alone is the
 * document as it stood *before* the unsent work, so a reader that dropped the
 * replayed log would hand back precisely what the user did not lose.
 */
async function archiveDocument<R>(
  store: WafflebaseDocStore,
  docKey: string,
  seed: (doc: Document<R>) => void,
  edit: (doc: Document<R>) => void,
): Promise<void> {
  const doc = new Document<R>(docKey);
  doc.setActor("000000000000000000000001");
  seed(doc);
  await store.saveSnapshot(docKey, doc.toBytes());

  const before = doc.getPendingChangesAfter(0).length;
  edit(doc);
  for (const change of doc.getPendingChangesAfter(0).slice(before)) {
    await store.appendChange(docKey, {
      clientSeq: change.clientSeq,
      bytes: new TextEncoder().encode(JSON.stringify(change.struct)),
    });
  }

  store.expectLoss(docKey);
  await store.remove(docKey);
}

beforeEach(() => {
  created.length = 0;
  applied.length = 0;
  attached.length = 0;
  workspaces = [{ id: "ws-fallback" }];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handing the work back", () => {
  it("creates a copy carrying the edits made after the snapshot", async () => {
    // The whole point of the feature. A copy holding only the snapshot would
    // be the state the user did not lose.
    const store = freshStore();
    await archiveSheet(store, "sheet-7");
    const [work] = await listRecoverableWork(store);

    const outcome = await recoverOfflineCopy(store, work, {
      title: "Quarterly plan",
      type: "sheet",
      workspaceId: "ws-1",
    });

    expect(outcome.documentId).toBe("new-1");
    expect(created[0].title).toBe("Quarterly plan (offline copy)");
    expect(created[0].type).toBe("sheet");
    // The copy belongs where the original did. Creating a document at all
    // requires saying where; sending no workspace is how this path answered
    // 400 on every attempt.
    expect(created[0].workspaceId).toBe("ws-1");
    const content = applied[0].content as { document: SheetRoot };
    expect(content.document.tabOrder).toEqual(["one", "typed-offline"]);
  });

  it("forgets the archive only after the content is written", async () => {
    const store = freshStore();
    await archiveSheet(store, "sheet-7");
    const [work] = await listRecoverableWork(store);

    await recoverOfflineCopy(store, work, {
      title: "Quarterly plan",
      type: "sheet",
    });

    expect(await listRecoverableWork(store)).toEqual([]);
  });

  it("keeps the archive when writing the content fails", async () => {
    // The archive is the only copy of work the SDK already gave up on. If the
    // hand-back fails, offering it again is right; dropping it trades the
    // archive for nothing. A duplicate document is a far smaller harm than a
    // deleted one, so the ordering errs that way on purpose.
    const store = freshStore();
    await archiveSheet(store, "sheet-7");
    const [work] = await listRecoverableWork(store);

    const apply = await import("@/app/documents/apply-imported-content");
    vi.spyOn(apply, "applyImportedContent").mockRejectedValue(
      new Error("network"),
    );

    await expect(
      recoverOfflineCopy(store, work, {
        title: "Quarterly plan",
        type: "sheet",
      }),
    ).rejects.toThrow();

    expect(await listRecoverableWork(store)).not.toEqual([]);
  });

  it("reports an incomplete recovery rather than presenting it as whole", async () => {
    // A copy silently missing an edit is worse than one labelled incomplete:
    // the user cannot tell, and will assume the rest was never there.
    const store = freshStore();
    const doc = new Document<SheetRoot>("sheet-8");
    doc.setActor("000000000000000000000001");
    doc.update((root) => {
      root.tabs = { one: {} };
    });
    await store.saveSnapshot("sheet-8", doc.toBytes());
    // A log with a hole in it, as an eviction or a torn append leaves.
    await store.appendChange("sheet-8", {
      clientSeq: 4,
      bytes: new TextEncoder().encode("{}"),
    });
    store.expectLoss("sheet-8");
    await store.remove("sheet-8");

    const [work] = await listRecoverableWork(store);
    const outcome = await recoverOfflineCopy(store, work, {
      title: "Quarterly plan",
      type: "sheet",
    });

    expect(outcome.complete).toBe(false);
  });

  it("says the archive was empty rather than blaming the type", async () => {
    // Both answers used to be `unsupported-type`, and a sheet whose snapshot
    // carries no tabs is by far the reachable one — the toast then tells
    // somebody their spreadsheet is a kind of document that cannot be
    // recovered. It is not, and the archive stays, so the same wrong sentence
    // comes back every session.
    const store = freshStore();
    const doc = new Document<SheetRoot>("sheet-11");
    doc.setActor("000000000000000000000001");
    doc.update((root) => {
      root.tabOrder = [];
    });
    await store.saveSnapshot("sheet-11", doc.toBytes());
    store.expectLoss("sheet-11");
    await store.remove("sheet-11");

    const [work] = await listRecoverableWork(store);
    const outcome = await recoverOfflineCopy(store, work, {
      title: "Quarterly plan",
      type: "sheet",
    });

    expect(outcome.refused).toBe("empty");
    expect(created).toEqual([]);
  });

  it("creates nothing for a type it cannot rebuild", async () => {
    // Better an archive the user still has than a document presented as their
    // work with nothing of it inside.
    const store = freshStore();
    await archiveSheet(store, "image-7");
    const [work] = await listRecoverableWork(store);

    const outcome = await recoverOfflineCopy(store, work, {
      title: "A picture",
      type: "image",
    });

    expect(outcome.refused).toBe("unsupported-type");
    expect(created).toEqual([]);
    expect(await listRecoverableWork(store)).not.toEqual([]);
  });

  it("falls back to a workspace the user still has when the original is gone", async () => {
    // "The document was deleted upstream" is one of the three ways an archive
    // comes to exist, so the caller often has no workspace to name. Refusing
    // then would strand the work for exactly the loss path it was archived
    // for.
    const store = freshStore();
    await archiveSheet(store, "sheet-12");
    const [work] = await listRecoverableWork(store);

    const outcome = await recoverOfflineCopy(store, work, {
      title: "Quarterly plan",
      type: "sheet",
    });

    expect(outcome.documentId).toBe("new-1");
    expect(created[0].workspaceId).toBe("ws-fallback");
  });

  it("keeps the archive when there is nowhere to put the copy", async () => {
    const store = freshStore();
    await archiveSheet(store, "sheet-13");
    const [work] = await listRecoverableWork(store);
    workspaces = [];

    await expect(
      recoverOfflineCopy(store, work, {
        title: "Quarterly plan",
        type: "sheet",
      }),
    ).rejects.toThrow();

    expect(created).toEqual([]);
    expect(await listRecoverableWork(store)).not.toEqual([]);
  });

  it("creates nothing when the archive cannot be read", async () => {
    const store = freshStore();
    await store.saveSnapshot("sheet-9", new Uint8Array([1, 2, 3]));
    store.expectLoss("sheet-9");
    await store.remove("sheet-9");
    const [work] = await listRecoverableWork(store);

    const outcome = await recoverOfflineCopy(store, work, {
      title: "Quarterly plan",
      type: "sheet",
    });

    expect(outcome.refused).toBe("unreadable");
    expect(created).toEqual([]);
  });
});

/**
 * Every type has its own reader, and a wrong one does not throw.
 *
 * That is the whole reason these exist. The readers disagree about shape, not
 * about validity — pointing the sheet reader at a docs root yields a plausible
 * document that is not what the user wrote, handed back as the *last* copy of
 * work the SDK has already dropped.
 */
describe("rebuilding each document type", () => {
  it("rebuilds a docs document through the docs store", async () => {
    const store = freshStore();
    // Seeded through `YorkieDocStore` itself rather than by hand-building a
    // Tree: the tree's node shape is the store's own private contract, and a
    // fixture that guesses it tests the guess.
    await archiveDocument<YorkieDocsRoot>(
      store,
      "doc-7",
      (doc) => {
        const writer = new YorkieDocStore(doc as never);
        writer.setDocument({
          blocks: [{ id: "b1", type: "paragraph", inlines: [{ text: "before", style: {} }] }],
        });
        writer.dispose();
      },
      (doc) => {
        const writer = new YorkieDocStore(doc as never);
        writer.setDocument({
          blocks: [
            { id: "b1", type: "paragraph", inlines: [{ text: "before offline", style: {} }] },
          ],
        });
        writer.dispose();
      },
    );
    const [work] = await listRecoverableWork(store);

    const outcome = await recoverOfflineCopy(store, work, {
      title: "Plan",
      type: "doc",
    });

    expect(outcome.documentId).toBe("new-1");
    expect(created[0].type).toBe("doc");
    const content = applied[0].content as {
      type: string;
      document: { blocks: Array<{ inlines: Array<{ text?: string }> }> };
    };
    expect(content.type).toBe("doc");
    // The post-snapshot edit is present, which is what proves the log was
    // replayed rather than only the snapshot read.
    expect(
      content.document.blocks
        .flatMap((block) => block.inlines.map((inline) => inline.text ?? ""))
        .join(""),
    ).toContain("offline");
  });

  it("rebuilds a slides document through the slides store", async () => {
    const store = freshStore();
    await archiveDocument<{
      meta?: { title?: string };
      slides?: Array<Record<string, unknown>>;
    }>(
      store,
      "slides-7",
      (doc) => doc.update((root) => {
        root.meta = { title: "Deck" };
        root.slides = [
          { id: "s1", layoutId: "blank", background: {}, elements: [], notes: [] },
        ];
      }),
      (doc) => doc.update((root) => {
        root.slides!.push({
          id: "s2",
          layoutId: "blank",
          background: {},
          elements: [],
          notes: [],
        });
      }),
    );
    const [work] = await listRecoverableWork(store);

    const outcome = await recoverOfflineCopy(store, work, {
      title: "Deck",
      type: "slides",
    });

    expect(outcome.documentId).toBe("new-1");
    expect(created[0].type).toBe("slides");
    const content = applied[0].content as {
      type: string;
      document: { slides: Array<{ id: string }> };
    };
    expect(content.type).toBe("slides");
    expect(content.document.slides.map((slide) => slide.id)).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("rebuilds a board document as the elements of its one slide", async () => {
    const store = freshStore();
    await archiveDocument<{
      meta?: { title?: string };
      elements?: Array<Record<string, unknown>>;
    }>(
      store,
      "board-7",
      (doc) => doc.update((root) => {
        root.meta = { title: "Board" };
        root.elements = [];
      }),
      (doc) => doc.update((root) => {
        root.elements!.push({
          id: "e1",
          kind: "shape",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          rotation: 0,
          data: { shape: "rect" },
        });
      }),
    );
    const [work] = await listRecoverableWork(store);

    const outcome = await recoverOfflineCopy(store, work, {
      title: "Board",
      type: "board",
    });

    expect(outcome.documentId).toBe("new-1");
    expect(created[0].type).toBe("board");
    const content = applied[0].content as {
      type: string;
      elements: Array<{ id: string }>;
    };
    expect(content.type).toBe("board");
    expect(content.elements.map((element) => element.id)).toEqual(["e1"]);
  });

  it("rebuilds a note as markdown written straight into a new note", async () => {
    // A note is not an engine document — it is one Yorkie `Text` at
    // `root.content` — so `applyImportedContent` has no branch for it and the
    // caller seeds it with a single edit instead.
    const store = freshStore();
    await archiveDocument<{ content?: Text }>(
      store,
      "note-7",
      (doc) => doc.update((root) => {
        root.content = new yorkie.Text();
        root.content.edit(0, 0, "# Title");
      }),
      (doc) => doc.update((root) => {
        root.content!.edit(7, 7, "\n\ntyped offline");
      }),
    );
    const [work] = await listRecoverableWork(store);

    const outcome = await recoverOfflineCopy(store, work, {
      title: "Ideas",
      type: "note",
      workspaceId: "ws-notes",
    });

    expect(outcome.documentId).toBe("new-1");
    expect(created[0]).toEqual({
      workspaceId: "ws-notes",
      title: "Ideas (offline copy)",
      type: "note",
    });
    // Notes bypass `applyImportedContent` entirely.
    expect(applied).toEqual([]);
    const seeded = attached[0].getRoot().content?.toString() ?? "";
    expect(seeded).toContain("# Title");
    expect(seeded).toContain("typed offline");
  });

  it("creates nothing for a note whose archive rebuilt empty", async () => {
    // An empty document is not work to hand back, and creating one would fill
    // the user's list with blank copies they then have to clean up.
    const store = freshStore();
    await archiveDocument<{ content?: Text }>(
      store,
      "note-8",
      (doc) => doc.update((root) => {
        root.content = new yorkie.Text();
      }),
      (doc) => doc.update((root) => {
        root.content!.edit(0, 0, "");
      }),
    );
    const [work] = await listRecoverableWork(store);

    const outcome = await recoverOfflineCopy(store, work, {
      title: "Ideas",
      type: "note",
    });

    expect(outcome.refused).toBe("empty");
    expect(created).toEqual([]);
    expect(await listRecoverableWork(store)).not.toEqual([]);
  });
});

describe("reading a type off an archived key", () => {
  it("answers the document and its type for every persisted key shape", () => {
    // Read off the key rather than fetched, because "the document was deleted
    // upstream" is one of the three paths that produce an archive at all — so
    // the server is exactly the thing that may no longer be able to answer.
    expect(describeArchivedDocument("pk/wb:1:sheet-7/sheet-7")).toEqual({
      id: "7",
      type: "sheet",
    });
    expect(describeArchivedDocument("doc-abc")).toEqual({
      id: "abc",
      type: "doc",
    });
    expect(describeArchivedDocument("slides-abc")?.type).toBe("slides");
    expect(describeArchivedDocument("board-abc")?.type).toBe("board");
    expect(describeArchivedDocument("note-abc")?.type).toBe("note");
  });

  it("refuses a key it cannot read rather than guessing", () => {
    // A guess writes the user's content into the wrong engine's shape, which
    // does not throw — it produces a plausible document that is not theirs.
    expect(describeArchivedDocument("pdf-7")).toBeUndefined();
    expect(describeArchivedDocument("mystery")).toBeUndefined();
    expect(describeArchivedDocument("sheet-")).toBeUndefined();
  });
});

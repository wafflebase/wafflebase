import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Document } from "@yorkie-js/sdk";

const created: Array<{ title: string; type?: string }> = [];
const applied: Array<{ docId: string; content: unknown }> = [];

vi.mock("@/api/documents", () => ({
  createDocument: (payload: { title: string; type?: string }) => {
    created.push(payload);
    return Promise.resolve({ id: `new-${created.length}`, ...payload });
  },
}));

vi.mock("@/app/documents/apply-imported-content", () => ({
  applyImportedContent: (docId: string, content: unknown) => {
    applied.push({ docId, content });
    return Promise.resolve({ droppedConnectors: 0 });
  },
}));

import { WafflebaseDocStore } from "./wafflebase-doc-store";
import { listRecoverableWork } from "./offline-copy";
import { recoverOfflineCopy } from "./offline-copy-recovery";

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

  await store.remove(docKey);
}

beforeEach(() => {
  created.length = 0;
  applied.length = 0;
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
    });

    expect(outcome.documentId).toBe("new-1");
    expect(created[0].title).toBe("Quarterly plan (offline copy)");
    expect(created[0].type).toBe("sheet");
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
    await store.remove("sheet-8");

    const [work] = await listRecoverableWork(store);
    const outcome = await recoverOfflineCopy(store, work, {
      title: "Quarterly plan",
      type: "sheet",
    });

    expect(outcome.complete).toBe(false);
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

  it("creates nothing when the archive cannot be read", async () => {
    const store = freshStore();
    await store.saveSnapshot("sheet-9", new Uint8Array([1, 2, 3]));
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

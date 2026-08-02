import { describe, it, expect, vi, beforeEach } from "vitest";
import * as q from "@/app/documents/upload-queue";
import {
  startMiroImport,
  MIRO_ITEM_LABEL,
  type MiroImportRunnerDeps,
} from "@/app/documents/miro-import-runner";
import type { MiroImportProgress } from "@/api/miro";
import type { UploadItem } from "@/app/documents/upload-queue";

/**
 * The Miro import driver, tested with no React and no network.
 *
 * The driver is deliberately a module function rather than a hook, so that a
 * running import survives the dialog closing and the user navigating away.
 * These tests exercise it the same way production does — call it, let it run
 * to a terminal state — and assert on the queue rows it leaves behind.
 */

const TOKEN = "miro-secret-token-value";

/** A queue double that records every patch, so progress can be replayed. */
function fakeQueue() {
  const patches: Partial<UploadItem>[] = [];
  const settled: string[] = [];
  const removed: string[] = [];
  let item: UploadItem | undefined;
  return {
    patches,
    settled,
    removed,
    get item() {
      return item;
    },
    deps: {
      enqueue: (input: {
        fileName: string;
        kind: UploadItem["kind"];
        workspaceId?: string;
        folderId?: string | null;
      }) => {
        item = {
          id: "x1",
          fileName: input.fileName,
          kind: input.kind,
          workspaceId: input.workspaceId,
          folderId: input.folderId,
          status: "parsing",
          done: 0,
          total: 0,
        };
        return item.id;
      },
      patch: (id: string, patch: Partial<UploadItem>) => {
        expect(id).toBe("x1");
        patches.push(patch);
        if (item) item = { ...item, ...patch };
      },
      remove: (id: string) => removed.push(id),
      settle: (id: string) => settled.push(id),
    } satisfies Partial<MiroImportRunnerDeps>,
  };
}

const RESULT = {
  items: [{ id: "m1" }],
  connectors: [],
  notes: [],
};

/** Deps that succeed end to end, with per-test overrides. */
function happyDeps(
  overrides: Partial<MiroImportRunnerDeps> = {},
): Partial<MiroImportRunnerDeps> {
  return {
    openStream: vi.fn(async () => ({ ok: true }) as unknown as Response),
    readStream: vi.fn(async () => RESULT) as never,
    mapItems: vi.fn(() => ({
      inits: [{ type: "shape" }],
      skipped: {},
      approximated: {},
    })) as never,
    resolveImageUrl: (url: string) => `https://api.example${url}`,
    createDoc: vi.fn(async () => ({ id: "doc-9", type: "board" })),
    applyContent: vi.fn(async () => ({ droppedConnectors: 0 })) as never,
    deleteDoc: vi.fn(async () => undefined) as never,
    getDocumentPath: (doc: { id: string | number }) => `/b/${doc.id}`,
    isAuthExpired: () => false,
    ...overrides,
  };
}

const INPUT = {
  workspaceId: "ws-1",
  folderId: "folder-3",
  token: TOKEN,
  boardUrl: "https://miro.com/app/board/B=/",
};

describe("startMiroImport — handoff boundary", () => {
  beforeEach(() => q.__resetForTest());

  it("creates the panel row only once the stream has opened", async () => {
    const queue = fakeQueue();
    const { itemId, finished } = await startMiroImport(INPUT, {
      ...happyDeps(),
      ...queue.deps,
    });
    await finished;

    expect(itemId).toBe("x1");
    expect(queue.item).toMatchObject({
      fileName: MIRO_ITEM_LABEL,
      kind: "board",
      workspaceId: "ws-1",
      folderId: "folder-3",
    });
  });

  it("rejects a PRE-stream failure to the caller without creating a row", async () => {
    // The user still has the form open and can fix these (a rejected token, no
    // access, a board that does not exist). Parking them in the panel would
    // strand the input they need to correct.
    const queue = fakeQueue();
    const boom = new Error("The Miro token was rejected (invalid or expired)");
    await expect(
      startMiroImport(INPUT, {
        ...happyDeps({
          openStream: vi.fn(async () => {
            throw boom;
          }),
        }),
        ...queue.deps,
      }),
    ).rejects.toBe(boom);

    expect(queue.item).toBeUndefined();
    expect(queue.patches).toEqual([]);
  });

  it("hands the token to the request and to nothing else", async () => {
    const queue = fakeQueue();
    const openStream = vi.fn(async () => ({}) as unknown as Response);
    const { finished } = await startMiroImport(INPUT, {
      ...happyDeps({ openStream }),
      ...queue.deps,
    });
    await finished;

    expect(openStream).toHaveBeenCalledWith("ws-1", {
      token: TOKEN,
      boardUrl: INPUT.boardUrl,
    });
    // Nothing the driver writes to the row may carry the credential.
    expect(JSON.stringify(queue.patches)).not.toContain(TOKEN);
    expect(JSON.stringify(queue.item)).not.toContain(TOKEN);
  });
});

describe("startMiroImport — progress mapping", () => {
  beforeEach(() => q.__resetForTest());

  it("maps each streamed stage onto a row status, counts, and wording", async () => {
    const ticks: MiroImportProgress[] = [
      { stage: "items", done: 1250 },
      { stage: "connectors", done: 40 },
      { stage: "images", done: 3, total: 12 },
    ];
    const queue = fakeQueue();
    const { finished } = await startMiroImport(INPUT, {
      ...happyDeps({
        readStream: (async (
          _res: Response,
          onProgress?: (p: MiroImportProgress) => void,
        ) => {
          for (const tick of ticks) onProgress?.(tick);
          return RESULT;
        }) as never,
      }),
      ...queue.deps,
    });
    await finished;

    expect(queue.patches.slice(0, 3)).toEqual([
      {
        status: "parsing",
        done: 1250,
        total: 0,
        detail: "Reading board… 1,250 items",
      },
      {
        status: "parsing",
        done: 40,
        total: 0,
        detail: "Reading connectors… 40",
      },
      {
        // Only the image stage knows its size up front, so it is the only one
        // that can drive the panel's done/total fraction.
        status: "uploading",
        done: 3,
        total: 12,
        detail: "Importing images… 3/12",
      },
    ]);
  });
});

describe("startMiroImport — terminal states", () => {
  beforeEach(() => q.__resetForTest());

  it("finishes with the created document and clears the progress wording", async () => {
    const queue = fakeQueue();
    const createDoc = vi.fn(async () => ({ id: "doc-9", type: "board" }));
    const { finished } = await startMiroImport(INPUT, {
      ...happyDeps({ createDoc }),
      ...queue.deps,
    });
    await finished;

    expect(createDoc).toHaveBeenCalledWith("ws-1", {
      title: "Imported Miro board",
      type: "board",
      folderId: "folder-3",
    });
    expect(queue.item).toMatchObject({
      status: "done",
      docId: "doc-9",
      docPath: "/b/doc-9",
      detail: undefined,
      warning: undefined,
    });
    expect(queue.settled).toEqual(["x1"]);
  });

  it("carries the skip/note summary as the row's warning", async () => {
    // The summary is what tells the user the import was not clean. Losing it
    // when the dialog went away would make a degraded import look perfect.
    const queue = fakeQueue();
    const { finished } = await startMiroImport(INPUT, {
      ...happyDeps({
        readStream: (async () => ({
          ...RESULT,
          notes: [{ reason: "image-failed", count: 2 }],
        })) as never,
        mapItems: (() => ({
          inits: [],
          skipped: { embed: 3 },
          approximated: { "shape-kind": 1 },
        })) as never,
        applyContent: (async () => ({ droppedConnectors: 1 })) as never,
      }),
      ...queue.deps,
    });
    await finished;

    const warning = queue.item?.warning ?? "";
    expect(queue.item?.status).toBe("done");
    expect(warning).toContain("3 embeds skipped");
    expect(warning).toContain("imported as rectangles");
    expect(warning).toContain("1 connector dropped");
    expect(warning).toContain("2 image(s) failed");
  });

  it("reports an in-band stream failure on the row, with the server's message", async () => {
    const queue = fakeQueue();
    const { finished } = await startMiroImport(INPUT, {
      ...happyDeps({
        readStream: (async () => {
          throw new Error("Miro rate limit reached — try again in a minute");
        }) as never,
      }),
      ...queue.deps,
    });
    await finished;

    expect(queue.item).toMatchObject({
      status: "error",
      reason: "Miro rate limit reached — try again in a minute",
      detail: undefined,
    });
    expect(queue.settled).toEqual(["x1"]);
  });

  it("deletes the orphaned document when applying the content fails", async () => {
    // The document exists but is empty at this point. Left behind, every
    // attempt adds another "Imported Miro board" to the user's list.
    const queue = fakeQueue();
    const deleteDoc = vi.fn(async () => undefined);
    const { finished } = await startMiroImport(INPUT, {
      ...happyDeps({
        applyContent: (async () => {
          throw new Error("Yorkie attach failed");
        }) as never,
        deleteDoc: deleteDoc as never,
      }),
      ...queue.deps,
    });
    await finished;

    expect(deleteDoc).toHaveBeenCalledWith("doc-9");
    expect(queue.item).toMatchObject({
      status: "error",
      reason: "Yorkie attach failed",
      // The document is gone, so the row must stop claiming one — dismissing
      // it would otherwise try to delete the same id a second time.
      docId: undefined,
    });
  });

  it("keeps the real error when the orphan cleanup itself fails", async () => {
    const queue = fakeQueue();
    const { finished } = await startMiroImport(INPUT, {
      ...happyDeps({
        applyContent: (async () => {
          throw new Error("Yorkie attach failed");
        }) as never,
        deleteDoc: (async () => {
          throw new Error("delete blew up");
        }) as never,
      }),
      ...queue.deps,
    });
    await finished;

    expect(queue.item?.reason).toBe("Yorkie attach failed");
  });

  it("removes the row on an expired session instead of reporting a failure", async () => {
    // The app is already redirecting to login. A panel row shouting about a
    // failed import is noise about the wrong problem, and would outlive the
    // redirect.
    const queue = fakeQueue();
    const { finished } = await startMiroImport(INPUT, {
      ...happyDeps({
        readStream: (async () => {
          const err = new Error("session expired");
          err.name = "AuthExpiredError";
          throw err;
        }) as never,
        isAuthExpired: (err: unknown) =>
          err instanceof Error && err.name === "AuthExpiredError",
      }),
      ...queue.deps,
    });
    await finished;

    expect(queue.removed).toEqual(["x1"]);
    expect(queue.settled).toEqual([]);
    expect(queue.patches.some((p) => p.status === "error")).toBe(false);
  });
});

describe("startMiroImport — against the real queue", () => {
  beforeEach(() => q.__resetForTest());

  it("never leaves the token anywhere in the queue snapshot", async () => {
    // The frontend half of the backend's "the response never contains the
    // token" assertion. The queue is a module singleton whose rows outlive the
    // dialog, so a credential parked here would live until the tab closes.
    const { finished } = await startMiroImport(INPUT, happyDeps());
    await finished;

    const snapshot = q.getSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain(TOKEN);
    expect(snapshot[0]).toMatchObject({ status: "done", docId: "doc-9" });
  });

  it("is never picked up by the file worker", async () => {
    // The row has no File. If the worker could claim it, `runItem` would
    // dereference `item.file!` and take the whole queue down.
    const { finished } = await startMiroImport(INPUT, {
      ...happyDeps({
        readStream: (async () => new Promise<never>(() => {})) as never,
      }),
    });
    void finished;

    expect(q.getSnapshot()[0].status).toBe("parsing");
    expect(q.nextPendingId()).toBeUndefined();
    // It is still real work, so it holds a concurrency slot.
    expect(q.activeCount()).toBe(1);
  });

  it("offers no retry affordance, because retrying would need the token", async () => {
    const { finished } = await startMiroImport(INPUT, {
      ...happyDeps({
        readStream: (async () => {
          throw new Error("stream died");
        }) as never,
      }),
    });
    await finished;

    const [item] = q.getSnapshot();
    expect(item.status).toBe("error");
    expect(q.isRetryable(item)).toBe(false);
    // Even a stray programmatic retry must not park it back in "pending",
    // where the file worker would try to run it.
    q.retry(item.id);
    expect(q.getSnapshot()[0].status).toBe("error");
    expect(q.nextPendingId()).toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as q from "@/app/documents/upload-queue";

function file(name: string, size = 1): File {
  return new File([new Uint8Array(size)], name);
}

describe("upload-queue store", () => {
  beforeEach(() => q.__resetForTest());

  it("enqueues every file as pending, including unknown types", () => {
    const items = q.enqueue([file("a.xlsx"), file("b.zip")], "ws1");
    expect(items.map((i) => i.status)).toEqual(["pending", "pending"]);
    expect(items.map((i) => i.kind)).toEqual(["sheet", "file"]);
    expect(items[1].reason).toBeUndefined();
  });

  it("fails an over-cap file at enqueue time without pinning its blob", () => {
    const [item] = q.enqueue([file("huge.zip", 60 * 1024 * 1024)]);
    expect(item.status).toBe("error");
    expect(item.reason).toBe("File is larger than the 50 MB limit");
    expect(item.file).toBeUndefined();
    expect(q.isRetryable(item)).toBe(false);
  });

  it("registers an externally driven item as active work the worker cannot claim", () => {
    // "parsing" rather than "pending" is load-bearing: the row carries no
    // File, and the worker's `runItem` dereferences `item.file!`. Only
    // `nextPendingId` feeds the worker, and it only ever selects "pending".
    const id = q.enqueueExternal({
      fileName: "Miro board",
      kind: "board",
      workspaceId: "ws1",
      folderId: "folder-2",
    });

    expect(q.getSnapshot()).toHaveLength(1);
    expect(q.getSnapshot()[0]).toMatchObject({
      id,
      fileName: "Miro board",
      kind: "board",
      workspaceId: "ws1",
      folderId: "folder-2",
      status: "parsing",
      done: 0,
      total: 0,
    });
    expect(q.getSnapshot()[0].file).toBeUndefined();
    expect(q.nextPendingId()).toBeUndefined();
    // It is genuinely running, so it counts against the concurrency cap.
    expect(q.activeCount()).toBe(1);
  });

  it("never offers to retry an item it cannot replay", () => {
    const [fileItem] = q.enqueue([file("a.xlsx")], "ws1");
    const externalId = q.enqueueExternal({
      fileName: "Miro board",
      kind: "board",
    });
    q.patchItem(fileItem.id, { status: "error", reason: "boom" });
    q.patchItem(externalId, { status: "error", reason: "stream died" });

    const byId = (id: string) => q.getSnapshot().find((i) => i.id === id)!;
    expect(q.isRetryable(byId(fileItem.id))).toBe(true);
    expect(q.isRetryable(byId(externalId))).toBe(false);

    // A stray retry on the unreplayable row must be a no-op, not a row parked
    // in "pending" that the worker would then try (and fail) to run.
    q.retry(externalId);
    expect(byId(externalId).status).toBe("error");
    expect(q.nextPendingId()).toBeUndefined();
    // The file-backed row is untouched by that no-op and still replayable
    // (the worker suite covers the replay itself).
    expect(byId(fileItem.id).status).toBe("error");
    expect(q.isRetryable(byId(fileItem.id))).toBe(true);
  });

  it("keeps externally driven rows out of a file batch's pending queue", () => {
    q.enqueueExternal({ fileName: "Miro board", kind: "board" });
    const [pending] = q.enqueue([file("a.xlsx")], "ws1");
    expect(q.nextPendingId()).toBe(pending.id);
  });

  it("emits to subscribers and changes snapshot identity on mutation", () => {
    const cb = vi.fn();
    const unsub = q.subscribe(cb);
    const before = q.getSnapshot();
    q.enqueue([file("a.docx")]);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(q.getSnapshot()).not.toBe(before);
    unsub();
    q.enqueue([file("c.pdf")]);
    expect(cb).toHaveBeenCalledTimes(1); // unsubscribed
  });

  it("patchItem updates status/progress and clearFinished prunes terminals", () => {
    const [item] = q.enqueue([file("a.pptx")]);
    q.patchItem(item.id, { status: "uploading", done: 2, total: 5 });
    expect(q.getSnapshot()[0]).toMatchObject({ status: "uploading", done: 2 });
    q.patchItem(item.id, { status: "done" });
    q.clearFinished();
    expect(q.getSnapshot()).toHaveLength(0);
  });

  it("clearFinished prunes done items but retains pending/in-flight/errored", () => {
    const [done, pending, uploading, errored] = q.enqueue([
      file("a.xlsx"),
      file("c.xlsx"),
      file("d.xlsx"),
      file("e.xlsx"),
    ]);
    q.patchItem(done.id, { status: "done" });
    q.patchItem(uploading.id, { status: "uploading" });
    q.patchItem(errored.id, { status: "error" });

    q.clearFinished();

    const remainingIds = q.getSnapshot().map((i) => i.id);
    expect(remainingIds).not.toContain(done.id);
    expect(remainingIds).toEqual(
      expect.arrayContaining([pending.id, uploading.id, errored.id]),
    );
  });
});

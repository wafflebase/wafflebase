import { describe, it, expect, beforeEach, vi } from "vitest";
import * as q from "@/app/documents/upload-queue";

function file(name: string): File {
  return new File([new Uint8Array([1])], name);
}

describe("upload-queue store", () => {
  beforeEach(() => q.__resetForTest());

  it("enqueues supported files as pending and unsupported as skipped", () => {
    const items = q.enqueue([file("a.xlsx"), file("b.png")], "ws1");
    expect(items.map((i) => i.status)).toEqual(["pending", "skipped"]);
    expect(items[0].kind).toBe("sheet");
    expect(items[0].workspaceId).toBe("ws1");
    expect(items[1].reason).toBe("Unsupported file type");
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

  it("clearFinished prunes done and skipped items but retains pending/in-flight/error items", () => {
    const [done, skipped, pending, uploading, errored] = q.enqueue([
      file("a.pptx"),
      file("b.png"), // unsupported -> auto "skipped"
      file("c.docx"),
      file("d.xlsx"),
      file("e.pdf"),
    ]);
    q.patchItem(done.id, { status: "done" });
    expect(q.getSnapshot().find((i) => i.id === skipped.id)?.status).toBe(
      "skipped",
    );
    q.patchItem(uploading.id, { status: "uploading", done: 1, total: 2 });
    q.patchItem(errored.id, { status: "error", reason: "boom" });

    q.clearFinished();

    const remainingIds = q.getSnapshot().map((i) => i.id);
    expect(remainingIds).not.toContain(done.id);
    expect(remainingIds).not.toContain(skipped.id);
    expect(remainingIds).toContain(pending.id);
    expect(remainingIds).toContain(uploading.id);
    expect(remainingIds).toContain(errored.id);
  });
});

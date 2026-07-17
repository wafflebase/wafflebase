import { describe, it, expect, beforeEach, vi } from "vitest";
import * as q from "@/app/documents/upload-queue";

function file(name: string): File {
  return new File([new Uint8Array([1])], name);
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("upload-queue worker", () => {
  beforeEach(() => q.__resetForTest());

  it("processes a mixed batch to done/skipped", async () => {
    const deps = {
      importXlsx: vi.fn(async (f: File) => ({
        document: { tabOrder: ["t"] },
        fileName: f.name,
      })),
      importDocx: vi.fn(async (f: File) => ({ doc: {}, fileName: f.name })),
      importPptxFile: vi.fn(async (f: File) => ({
        document: {},
        report: { summary: () => "" },
        fileName: f.name,
      })),
      uploadPdf: vi.fn(async () => ({ id: "file1" })),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "d" + p.title,
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: (d: { id: string }) => `/path/${d.id}`,
      stashSheet: vi.fn(),
      stashDoc: vi.fn(),
      stashSlides: vi.fn(),
    };
    q.enqueue([file("a.xlsx"), file("b.png"), file("c.pdf")], "ws1");
    q.startUploads(undefined, deps as never);
    await flush();
    await flush();
    await flush();

    const snap = q.getSnapshot();
    expect(snap.find((i) => i.fileName === "a.xlsx")?.status).toBe("done");
    expect(snap.find((i) => i.fileName === "c.pdf")?.status).toBe("done");
    expect(snap.find((i) => i.fileName === "b.png")?.status).toBe("skipped");
    expect(deps.createDoc).toHaveBeenCalledTimes(2); // xlsx + pdf, not png
  });

  it("marks an item error when its importer throws and keeps others going", async () => {
    const deps = {
      importDocx: vi.fn(async () => {
        throw new Error("corrupt");
      }),
      importXlsx: vi.fn(async (f: File) => ({
        document: { tabOrder: ["t"] },
        fileName: f.name,
      })),
      importPptxFile: vi.fn(),
      uploadPdf: vi.fn(),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "d",
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: () => "/p",
      stashSheet: vi.fn(),
      stashDoc: vi.fn(),
      stashSlides: vi.fn(),
    };
    q.enqueue([file("bad.docx"), file("ok.xlsx")], "ws1");
    q.startUploads(undefined, deps as never);
    await flush();
    await flush();
    await flush();

    const snap = q.getSnapshot();
    expect(snap.find((i) => i.fileName === "bad.docx")?.status).toBe("error");
    expect(snap.find((i) => i.fileName === "bad.docx")?.reason).toContain(
      "corrupt",
    );
    expect(snap.find((i) => i.fileName === "ok.xlsx")?.status).toBe("done");
  });

  it("never runs more than MAX_CONCURRENCY importers at once", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const deps = {
      importXlsx: vi.fn(async (f: File) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active--;
        return { document: { tabOrder: ["t"] }, fileName: f.name };
      }),
      importDocx: vi.fn(),
      importPptxFile: vi.fn(),
      uploadPdf: vi.fn(),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "d" + p.title,
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: (d: { id: string }) => `/path/${d.id}`,
      stashSheet: vi.fn(),
      stashDoc: vi.fn(),
      stashSlides: vi.fn(),
    };
    q.enqueue(
      [file("a.xlsx"), file("b.xlsx"), file("c.xlsx")],
      "ws1",
    );
    q.startUploads(undefined, deps as never);

    // Synchronously (no flush needed): pump() claims slots up to the cap in
    // one tick, so exactly MAX_CONCURRENCY importers should have started and
    // be parked on their un-resolved promise, with the 3rd item still queued.
    expect(releases.length).toBe(2);
    expect(active).toBe(2);
    expect(maxActive).toBe(2);
    let snap = q.getSnapshot();
    expect(snap.find((i) => i.fileName === "c.xlsx")?.status).toBe("pending");

    // Release the first two importers; this should free a slot for the 3rd
    // item's importer to start, but the cap must never be exceeded.
    releases.shift()!();
    releases.shift()!();
    await flush();
    await flush();

    expect(maxActive).toBe(2); // never exceeded the cap, even after refill
    expect(releases.length).toBe(1); // the 3rd item's importer is now parked

    releases.shift()!();
    await flush();
    await flush();

    snap = q.getSnapshot();
    expect(snap.every((i) => i.status === "done")).toBe(true);
    expect(deps.createDoc).toHaveBeenCalledTimes(3);
  });

  it("retrying after a stash failure reuses the created document (no duplicate createDoc)", async () => {
    let stashCalls = 0;
    const deps = {
      importXlsx: vi.fn(async (f: File) => ({
        document: { tabOrder: ["t"] },
        fileName: f.name,
      })),
      importDocx: vi.fn(),
      importPptxFile: vi.fn(),
      uploadPdf: vi.fn(),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "doc-" + p.title,
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: (d: { id: string }) => `/path/${d.id}`,
      stashSheet: vi.fn(() => {
        stashCalls++;
        if (stashCalls === 1) throw new Error("stash failed");
      }),
      stashDoc: vi.fn(),
      stashSlides: vi.fn(),
    };
    const [item] = q.enqueue([file("dup.xlsx")], "ws1");
    q.startUploads(undefined, deps as never);
    await flush();
    await flush();

    let snap = q.getSnapshot();
    let current = snap.find((i) => i.id === item.id);
    expect(current?.status).toBe("error");
    expect(current?.reason).toContain("stash failed");
    expect(deps.createDoc).toHaveBeenCalledTimes(1);
    const docIdAfterFirstAttempt = current?.docId;
    expect(docIdAfterFirstAttempt).toBeTruthy();

    q.retry(item.id);
    await flush();
    await flush();

    snap = q.getSnapshot();
    current = snap.find((i) => i.id === item.id);
    expect(current?.status).toBe("done");
    expect(deps.createDoc).toHaveBeenCalledTimes(1); // still just once, not 2
    expect(current?.docId).toBe(docIdAfterFirstAttempt); // same document reused
    expect(deps.stashSheet).toHaveBeenCalledTimes(2); // 1st threw, 2nd succeeded
  });
});

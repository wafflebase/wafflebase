import { describe, it, expect, beforeEach, vi } from "vitest";
import * as q from "@/app/documents/upload-queue";
import { CLIENT_PARSE_MAX_BYTES } from "@/app/documents/upload-kind";

function file(name: string): File {
  return new File([new Uint8Array([1])], name);
}
/**
 * A file that *reports* `size` without allocating it. `File.size` is read-only,
 * and the size branch only ever reads it — allocating megabytes per case would
 * buy nothing.
 */
function sized(name: string, size: number): File {
  const f = file(name);
  Object.defineProperty(f, "size", { value: size });
  return f;
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
      importSheetViaBackend: vi.fn(),
      importCsvFile: vi.fn(async (f: File) => ({
        document: { tabOrder: ["t"] },
        fileName: f.name,
      })),
      importDocx: vi.fn(async (f: File) => ({ doc: {}, fileName: f.name })),
      importPptxFile: vi.fn(async (f: File) => ({
        document: {},
        report: { summary: () => "" },
        fileName: f.name,
      })),
      uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(async () => ({ id: "file1" })),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "d" + p.title,
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: (d: { id: string }) => `/path/${d.id}`,
      applyContent: vi.fn(async () => {}),
    };
    q.enqueue([file("a.xlsx"), file("b.png"), file("c.pdf")], "ws1");
    q.startUploads(undefined, deps as never);
    await flush();
    await flush();
    await flush();

    const snap = q.getSnapshot();
    expect(snap.find((i) => i.fileName === "a.xlsx")?.status).toBe("done");
    expect(snap.find((i) => i.fileName === "c.pdf")?.status).toBe("done");
    expect(snap.find((i) => i.fileName === "b.png")?.status).toBe("done");
    // xlsx + png + pdf all create a document now.
    expect(deps.createDoc).toHaveBeenCalledTimes(3);
    // Content is applied only for the parsed sheet; the png and pdf store
    // their bytes server-side at create time.
    expect(deps.applyContent).toHaveBeenCalledTimes(1);
    // docId = "d" + stripExt("a.xlsx") = "d" + "a" = "da"
    expect(deps.applyContent).toHaveBeenCalledWith(
      "da",
      expect.objectContaining({ type: "sheet" }),
    );
  });

  it("creates dropped documents in the folder the list is viewing", async () => {
    const deps = {
      importXlsx: vi.fn(async (f: File) => ({
        document: { tabOrder: ["t"] },
        fileName: f.name,
      })),
      importSheetViaBackend: vi.fn(),
      importCsvFile: vi.fn(async (f: File) => ({
        document: { tabOrder: ["t"] },
        fileName: f.name,
      })),
      importDocx: vi.fn(),
      importPptxFile: vi.fn(),
      uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(async () => ({ id: "blob-1" })),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "d" + p.title,
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: (d: { id: string }) => `/path/${d.id}`,
      applyContent: vi.fn(async () => {}),
    };
    // Enqueue while viewing folder "folder-7": the created document must land
    // in that folder, not the workspace root.
    q.enqueue([file("a.xlsx"), file("c.pdf")], "ws1", "folder-7");
    q.startUploads(undefined, deps as never);
    await flush();
    await flush();
    await flush();

    expect(deps.createDoc).toHaveBeenCalledWith(
      "ws1",
      expect.objectContaining({ type: "sheet", folderId: "folder-7" }),
    );
    expect(deps.createDoc).toHaveBeenCalledWith(
      "ws1",
      expect.objectContaining({ type: "pdf", folderId: "folder-7" }),
    );
  });

  it("uploads an image blob and creates an image document", async () => {
    const deps = {
      importXlsx: vi.fn(),
      importSheetViaBackend: vi.fn(),
      importCsvFile: vi.fn(),
      importDocx: vi.fn(),
      importPptxFile: vi.fn(),
      uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(async () => ({ id: "img-1" })),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "d" + p.title,
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: (d: { id: string }) => `/path/${d.id}`,
      applyContent: vi.fn(async () => {}),
    };
    q.enqueue([file("cat.png")], "ws1");
    q.startUploads(undefined, deps as never);
    await flush();
    await flush();
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
    expect(deps.createDoc).toHaveBeenCalledWith(
      "ws1",
      expect.objectContaining({ type: "image", fileId: "img-1" }),
    );
    expect(deps.applyContent).not.toHaveBeenCalled();
  });

  it("retries a rate-limited (429) image upload with backoff", async () => {
    const rateLimited = Object.assign(new Error("Too Many Requests"), {
      status: 429,
    });
    let calls = 0;
    const deps = {
      importXlsx: vi.fn(),
      importSheetViaBackend: vi.fn(),
      importCsvFile: vi.fn(),
      importDocx: vi.fn(),
      importPptxFile: vi.fn(),
      uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw rateLimited;
        return { id: "img-1" };
      }),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "d" + p.title,
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: (d: { id: string }) => `/path/${d.id}`,
      applyContent: vi.fn(async () => {}),
      sleep: vi.fn(async () => {}),
    };
    q.enqueue([file("cat.png")], "ws1");
    q.startUploads(undefined, deps as never);
    await flush();
    await flush();
    await flush();
    const snap = q.getSnapshot();
    expect(deps.uploadFile).toHaveBeenCalledTimes(2); // failed once, retried
    expect(deps.sleep).toHaveBeenCalledTimes(1);
    expect(snap.find((i) => i.fileName === "cat.png")?.status).toBe("done");
  });

  it("marks the item error after 429 retries are exhausted", async () => {
    const rateLimited = Object.assign(new Error("Too Many Requests"), {
      status: 429,
    });
    const deps = {
      importXlsx: vi.fn(),
      importSheetViaBackend: vi.fn(),
      importCsvFile: vi.fn(),
      importDocx: vi.fn(),
      importPptxFile: vi.fn(),
      uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(async () => {
        throw rateLimited; // always 429
      }),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "d" + p.title,
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: (d: { id: string }) => `/path/${d.id}`,
      applyContent: vi.fn(async () => {}),
      sleep: vi.fn(async () => {}),
    };
    q.enqueue([file("cat.png")], "ws1");
    q.startUploads(undefined, deps as never);
    // Flush enough microtask turns for all 6 backoff attempts to settle.
    for (let i = 0; i < 10; i++) await flush();
    const snap = q.getSnapshot();
    expect(deps.sleep).toHaveBeenCalledTimes(6); // MAX_RATE_RETRIES
    expect(deps.uploadFile).toHaveBeenCalledTimes(7); // initial + 6 retries
    expect(snap.find((i) => i.fileName === "cat.png")?.status).toBe("error");
  });

  it("honors Retry-After (retryAfterMs) for the backoff delay", async () => {
    const rateLimited = Object.assign(new Error("Too Many Requests"), {
      status: 429,
      retryAfterMs: 1234,
    });
    let calls = 0;
    const deps = {
      importXlsx: vi.fn(),
      importSheetViaBackend: vi.fn(),
      importCsvFile: vi.fn(),
      importDocx: vi.fn(),
      importPptxFile: vi.fn(),
      uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw rateLimited;
        return { id: "img-1" };
      }),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "d" + p.title,
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: (d: { id: string }) => `/path/${d.id}`,
      applyContent: vi.fn(async () => {}),
      sleep: vi.fn(async () => {}),
    };
    q.enqueue([file("cat.png")], "ws1");
    q.startUploads(undefined, deps as never);
    for (let i = 0; i < 6; i++) await flush();
    expect(deps.sleep).toHaveBeenCalledWith(1234); // header value, not exp fallback
    expect(q.getSnapshot().find((i) => i.fileName === "cat.png")?.status).toBe(
      "done",
    );
  });

  it("retries a 429 on createDoc without re-uploading the blob", async () => {
    const rateLimited = Object.assign(new Error("Too Many Requests"), {
      status: 429,
    });
    let createCalls = 0;
    const deps = {
      importXlsx: vi.fn(),
      importSheetViaBackend: vi.fn(),
      importCsvFile: vi.fn(),
      importDocx: vi.fn(),
      importPptxFile: vi.fn(),
      uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(async () => ({ id: "img-1" })),
      createDoc: vi.fn(async (_ws, p) => {
        createCalls += 1;
        if (createCalls === 1) throw rateLimited;
        return { id: "d" + p.title, title: p.title, type: p.type };
      }),
      getDocumentPath: (d: { id: string }) => `/path/${d.id}`,
      applyContent: vi.fn(async () => {}),
      sleep: vi.fn(async () => {}),
    };
    q.enqueue([file("cat.png")], "ws1");
    q.startUploads(undefined, deps as never);
    await flush();
    await flush();
    await flush();
    await flush();
    const snap = q.getSnapshot();
    expect(deps.uploadFile).toHaveBeenCalledTimes(1); // blob NOT re-uploaded
    expect(deps.createDoc).toHaveBeenCalledTimes(2); // failed once, retried
    expect(snap.find((i) => i.fileName === "cat.png")?.status).toBe("done");
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
      importSheetViaBackend: vi.fn(),
      importCsvFile: vi.fn(async (f: File) => ({
        document: { tabOrder: ["t"] },
        fileName: f.name,
      })),
      importPptxFile: vi.fn(),
      uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "d",
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: () => "/p",
      applyContent: vi.fn(async () => {}),
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
      importSheetViaBackend: vi.fn(),
      importCsvFile: vi.fn(),
      importDocx: vi.fn(),
      importPptxFile: vi.fn(),
      uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "d" + p.title,
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: (d: { id: string }) => `/path/${d.id}`,
      applyContent: vi.fn(async () => {}),
    };
    q.enqueue([file("a.xlsx"), file("b.xlsx"), file("c.xlsx")], "ws1");
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

  it("retrying after an apply failure reuses the created document (no duplicate createDoc)", async () => {
    let applyCalls = 0;
    const deps = {
      importXlsx: vi.fn(async (f: File) => ({
        document: { tabOrder: ["t"] },
        fileName: f.name,
      })),
      importSheetViaBackend: vi.fn(),
      importCsvFile: vi.fn(async (f: File) => ({
        document: { tabOrder: ["t"] },
        fileName: f.name,
      })),
      importDocx: vi.fn(),
      importPptxFile: vi.fn(),
      uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "doc-" + p.title,
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: (d: { id: string }) => `/path/${d.id}`,
      applyContent: vi.fn(async () => {
        applyCalls++;
        if (applyCalls === 1) throw new Error("apply failed");
      }),
    };
    const [item] = q.enqueue([file("dup.xlsx")], "ws1");
    q.startUploads(undefined, deps as never);
    await flush();
    await flush();

    let snap = q.getSnapshot();
    let current = snap.find((i) => i.id === item.id);
    expect(current?.status).toBe("error");
    expect(current?.reason).toContain("apply failed");
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
    expect(deps.applyContent).toHaveBeenCalledTimes(2); // 1st threw, 2nd succeeded
  });

  it("retrying a PDF whose createDoc failed does not re-upload the blob", async () => {
    let createCalls = 0;
    const deps = {
      importXlsx: vi.fn(),
      importSheetViaBackend: vi.fn(),
      importCsvFile: vi.fn(),
      importDocx: vi.fn(),
      importPptxFile: vi.fn(),
      uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(async () => ({ id: "blob-1" })),
      createDoc: vi.fn(async (_ws, p) => {
        createCalls++;
        if (createCalls === 1) throw new Error("create failed");
        return { id: "doc-1", title: p.title, type: p.type };
      }),
      getDocumentPath: (d: { id: string }) => `/path/${d.id}`,
      applyContent: vi.fn(async () => {}),
    };
    const [item] = q.enqueue([file("a.pdf")], "ws1");
    q.startUploads(undefined, deps as never);
    await flush();
    await flush();

    let snap = q.getSnapshot();
    let current = snap.find((i) => i.id === item.id);
    expect(current?.status).toBe("error");
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
    expect(current?.fileId).toBe("blob-1"); // fileId persisted for resume

    q.retry(item.id);
    await flush();
    await flush();

    snap = q.getSnapshot();
    current = snap.find((i) => i.id === item.id);
    expect(current?.status).toBe("done");
    // The blob was uploaded exactly once across the failure + retry; the
    // second attempt reused the persisted fileId instead of orphaning a copy.
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
    expect(deps.createDoc).toHaveBeenCalledTimes(2);
  });

  it("fires the settled callback on both done and error", async () => {
    const settled: Array<{ name: string; status: string }> = [];
    const deps = {
      importXlsx: vi.fn(async (f: File) => ({
        document: { tabOrder: ["t"] },
        fileName: f.name,
      })),
      importSheetViaBackend: vi.fn(),
      importCsvFile: vi.fn(async (f: File) => ({
        document: { tabOrder: ["t"] },
        fileName: f.name,
      })),
      importDocx: vi.fn(async () => {
        throw new Error("boom");
      }),
      importPptxFile: vi.fn(),
      uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "d" + p.title,
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: (d: { id: string }) => `/path/${d.id}`,
      applyContent: vi.fn(async () => {}),
    };
    q.enqueue([file("ok.xlsx"), file("bad.docx")], "ws1");
    q.startUploads(
      (item) => settled.push({ name: item.fileName, status: item.status }),
      deps as never,
    );
    await flush();
    await flush();
    await flush();

    expect(settled).toContainEqual({ name: "ok.xlsx", status: "done" });
    expect(settled).toContainEqual({ name: "bad.docx", status: "error" });
  });

  it("dismissing an errored item that created a doc deletes the orphan", async () => {
    const deleteDoc = vi.fn(async () => {});
    const deps = {
      importXlsx: vi.fn(async (f: File) => ({
        document: { tabOrder: ["t"] },
        fileName: f.name,
      })),
      importSheetViaBackend: vi.fn(),
      importCsvFile: vi.fn(async (f: File) => ({
        document: { tabOrder: ["t"] },
        fileName: f.name,
      })),
      importDocx: vi.fn(),
      importPptxFile: vi.fn(),
      uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "doc-x",
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: () => "/p",
      applyContent: vi.fn(async () => {
        throw new Error("apply failed");
      }),
      deleteDoc,
    };
    const [item] = q.enqueue([file("a.xlsx")], "ws1");
    q.startUploads(undefined, deps as never);
    await flush();
    await flush();

    const errored = q.getSnapshot().find((i) => i.id === item.id);
    expect(errored?.status).toBe("error");
    expect(errored?.docId).toBe("doc-x");

    q.dismissItem(item.id);
    expect(deleteDoc).toHaveBeenCalledWith("doc-x");
    expect(q.getSnapshot().find((i) => i.id === item.id)).toBeUndefined();
  });

  it("dismissing a skipped item removes it without any remote delete", async () => {
    const deleteDoc = vi.fn(async () => {});
    q.startUploads(undefined, { deleteDoc } as never);
    const [item] = q.enqueue([file("x.zip")]); // unsupported -> skipped
    q.dismissItem(item.id);
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(q.getSnapshot()).toHaveLength(0);
  });

  it("surfaces a lossy PPTX import summary as a warning on the done item", async () => {
    const deps = {
      importXlsx: vi.fn(),
      importSheetViaBackend: vi.fn(),
      importCsvFile: vi.fn(),
      importDocx: vi.fn(),
      importPptxFile: vi.fn(async (f: File) => ({
        document: {},
        report: { summary: () => "2 fallbacks applied." },
        fileName: f.name,
      })),
      uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(),
      createDoc: vi.fn(async (_ws, p) => ({
        id: "d",
        title: p.title,
        type: p.type,
      })),
      getDocumentPath: () => "/p",
      applyContent: vi.fn(async () => {}),
    };
    const [item] = q.enqueue([file("deck.pptx")], "ws1");
    q.startUploads(undefined, deps as never);
    await flush();
    await flush();

    const current = q.getSnapshot().find((i) => i.id === item.id);
    expect(current?.status).toBe("done");
    expect(current?.warning).toBe("2 fallbacks applied.");
  });

  // `.tsv` shares the CSV importer — the delimiter is detected, not declared.
  it.each(["sales.csv", "sales.tsv"])(
    "routes a %s item through the CSV importer and strips the extension",
    async (fileName) => {
      const deps = {
        importXlsx: vi.fn(),
        importSheetViaBackend: vi.fn(),
        importCsvFile: vi.fn(async (f: File) => ({
          document: { tabOrder: ["t"] },
          fileName: f.name,
          rowCount: 3,
          truncated: false,
        })),
        importDocx: vi.fn(),
        importPptxFile: vi.fn(),
        uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(),
        createDoc: vi.fn(async (_ws, p) => ({
          id: "d",
          title: p.title,
          type: p.type,
        })),
        getDocumentPath: () => "/p",
        applyContent: vi.fn(async () => {}),
      };
      q.enqueue([file(fileName)], "ws1");
      q.startUploads(undefined, deps as never);
      await flush();
      await flush();

      expect(deps.importCsvFile).toHaveBeenCalledTimes(1);
      expect(deps.importXlsx).not.toHaveBeenCalled();
      expect(deps.createDoc).toHaveBeenCalledWith(
        "ws1",
        expect.objectContaining({ title: "sales", type: "sheet" }),
      );
    },
  );

  describe("oversized sheet routing", () => {
    const OVER = CLIENT_PARSE_MAX_BYTES + 1;

    // Sizes are derived from the constant, not hard-coded, so the threshold can
    // be re-measured (see the TODO on it) without rewriting these cases.
    function backendDeps() {
      return {
        importXlsx: vi.fn(async (f: File) => ({
          document: { tabOrder: ["t"] },
          fileName: f.name,
        })),
        importCsvFile: vi.fn(async (f: File) => ({
          document: { tabOrder: ["t"] },
          fileName: f.name,
          rowCount: 3,
          truncated: false,
        })),
        importSheetViaBackend: vi.fn(async () => ({
          document: { tabOrder: ["t"] },
          rowCount: 10,
          truncated: false,
        })),
        importDocx: vi.fn(),
        importPptxFile: vi.fn(),
        uploadImportFile: vi.fn(async () => ({ id: "blob-1" })),
      uploadFile: vi.fn(async () => ({ id: "blob-1" })),
        createDoc: vi.fn(async (_ws, p) => ({
          id: "d",
          title: p.title,
          type: p.type,
        })),
        getDocumentPath: () => "/p",
        applyContent: vi.fn(async () => {}),
      };
    }

    it("sends an oversized CSV to the backend instead of parsing it", async () => {
      const deps = backendDeps();
      q.enqueue([sized("big.csv", OVER)], "ws1");
      q.startUploads(undefined, deps as never);
      await flush();
      await flush();

      expect(deps.uploadImportFile).toHaveBeenCalledWith("ws1", expect.any(File));
      expect(deps.importSheetViaBackend).toHaveBeenCalledWith("ws1", "blob-1");
      expect(deps.importCsvFile).not.toHaveBeenCalled();
      expect(q.getSnapshot()[0].status).toBe("done");
    });

    // The guard that matters: XLSX has no backend parser at all, so size must
    // never move it off the client path.
    it("parses an oversized XLSX in the browser, never via the backend", async () => {
      const deps = backendDeps();
      q.enqueue([sized("big.xlsx", OVER)], "ws1");
      q.startUploads(undefined, deps as never);
      await flush();
      await flush();

      expect(deps.importXlsx).toHaveBeenCalledTimes(1);
      expect(deps.importSheetViaBackend).not.toHaveBeenCalled();
      expect(deps.uploadImportFile).not.toHaveBeenCalled();
    });

    it("parses a CSV at exactly the threshold in the browser", async () => {
      const deps = backendDeps();
      q.enqueue([sized("edge.csv", CLIENT_PARSE_MAX_BYTES)], "ws1");
      q.startUploads(undefined, deps as never);
      await flush();
      await flush();

      // The branch is `>`, so the boundary itself stays client-side.
      expect(deps.importCsvFile).toHaveBeenCalledTimes(1);
      expect(deps.importSheetViaBackend).not.toHaveBeenCalled();
    });

    // The preview endpoint is workspace-scoped for authorization, so an item
    // enqueued outside a workspace has nowhere to send the blob.
    // The preview is workspace-scoped, so there is nowhere to send the blob —
    // and past the threshold the browser cannot read the file either. Failing
    // with a sentence beats attempting a parse that dies inside `File.text()`.
    it("fails clearly when an oversized CSV has no workspace to send it to", async () => {
      const deps = backendDeps();
      q.enqueue([sized("big.csv", OVER)], undefined);
      q.startUploads(undefined, deps as never);
      await flush();
      await flush();

      const item = q.getSnapshot()[0];
      expect(item.status).toBe("error");
      expect(item.reason).toMatch(/too large to import outside a workspace/);
      expect(deps.importCsvFile).not.toHaveBeenCalled();
      expect(deps.importSheetViaBackend).not.toHaveBeenCalled();
      expect(deps.uploadImportFile).not.toHaveBeenCalled();
    });

    it("surfaces a truncated preview as a warning on the done item", async () => {
      const deps = backendDeps();
      deps.importSheetViaBackend = vi.fn(async () => ({
        document: { tabOrder: ["t"] },
        rowCount: 5000,
        truncated: true,
      }));
      q.enqueue([sized("big.csv", OVER)], "ws1");
      q.startUploads(undefined, deps as never);
      await flush();
      await flush();

      const current = q.getSnapshot()[0];
      expect(current.status).toBe("done");
      expect(current.warning).toBe("Only the first 5,000 rows were imported.");
    });

    it("reuses the uploaded blob when a failed preview is retried", async () => {
      const deps = backendDeps();
      deps.importSheetViaBackend = vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({
          document: { tabOrder: ["t"] },
          rowCount: 10,
          truncated: false,
        });
      q.enqueue([sized("big.csv", OVER)], "ws1");
      q.startUploads(undefined, deps as never);
      await flush();
      await flush();
      expect(q.getSnapshot()[0].status).toBe("error");

      q.retry(q.getSnapshot()[0].id);
      await flush();
      await flush();

      // The blob is persisted before the parse, so the retry must not re-upload.
      expect(deps.uploadImportFile).toHaveBeenCalledTimes(1);
      expect(q.getSnapshot()[0].status).toBe("done");
    });

    // The complement of the case above: staged blobs expire after a day, so an
    // id kept forever makes a late retry re-preview something the server can
    // never resolve. Reusing it is right only while it still exists.
    it("re-uploads instead of reusing a blob the server says is gone", async () => {
      const deps = backendDeps();
      const gone = Object.assign(new Error("This upload has expired."), {
        status: 410,
      });
      deps.importSheetViaBackend = vi
        .fn()
        .mockRejectedValueOnce(gone)
        .mockResolvedValueOnce({
          document: { tabOrder: ["t"] },
          rowCount: 10,
          truncated: false,
        });
      q.enqueue([sized("big.csv", OVER)], "ws1");
      q.startUploads(undefined, deps as never);
      await flush();
      await flush();

      expect(q.getSnapshot()[0].status).toBe("error");
      // Cleared, or the retry below would replay the dead id forever.
      expect(q.getSnapshot()[0].fileId).toBeUndefined();

      q.retry(q.getSnapshot()[0].id);
      await flush();
      await flush();

      expect(deps.uploadImportFile).toHaveBeenCalledTimes(2);
      expect(q.getSnapshot()[0].status).toBe("done");
    });
  });
});

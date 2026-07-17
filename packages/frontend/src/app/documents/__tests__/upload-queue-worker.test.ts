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
});

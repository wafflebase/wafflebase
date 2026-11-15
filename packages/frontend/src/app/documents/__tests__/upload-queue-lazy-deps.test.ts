import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The production defaults for the importers and the content writer.
 *
 * They are `import()` wrappers, so the editor engines stay out of the
 * signed-in Layout's graph until an upload needs them. Every other queue test
 * injects its own importers, so these tests leave them un-injected and assert
 * that each wrapper reaches the real module's export with the file (and the
 * progress callback) it was given. A wrong specifier, a renamed export or a
 * dropped argument fails here instead of on a user's first upload.
 */
const mods = vi.hoisted(() => ({
  importSheetFile: vi.fn(async (f: File) => ({
    document: { tabOrder: ["t"] },
    fileName: f.name,
  })),
  importDocx: vi.fn(async () => ({ doc: { blocks: [] } })),
  importPptxFile: vi.fn(async () => ({
    document: { slides: [] },
    report: { summary: () => "Imported with no fallbacks." },
  })),
  applyImportedContent: vi.fn(async () => ({})),
}));

vi.mock("@/app/spreadsheet/sheet-import-actions", () => ({
  importSheetFile: mods.importSheetFile,
}));
vi.mock("@/app/docs/docx-actions", () => ({ importDocx: mods.importDocx }));
vi.mock("@/app/slides/pptx-actions", () => ({
  importPptxFile: mods.importPptxFile,
}));
vi.mock("@/app/documents/apply-imported-content", () => ({
  applyImportedContent: mods.applyImportedContent,
}));

import * as q from "@/app/documents/upload-queue";

async function settle(id: string) {
  await vi.waitFor(() => {
    const item = q.getSnapshot().find((i) => i.id === id);
    expect(item?.status).toBe("done");
  });
}

function startWithDefaultImporters() {
  q.startUploads(undefined, {
    createDoc: vi.fn(async (_ws, p) => ({
      id: `doc-${p.type}`,
      title: p.title,
      type: p.type,
    })) as never,
    getDocumentPath: () => "/p",
  });
}

describe("upload queue lazy default deps: real modules", () => {
  // The cases below replace each module with a factory, which would keep
  // passing if the real export were renamed or the module moved. These
  // read the real modules through the same specifiers the wrappers use.
  it.each([
    ["@/app/spreadsheet/sheet-import-actions", "importSheetFile"],
    ["@/app/docs/docx-actions", "importDocx"],
    ["@/app/slides/pptx-actions", "importPptxFile"],
    ["@/app/documents/apply-imported-content", "applyImportedContent"],
  ])("%s exports %s", async (specifier, name) => {
    const real = await vi.importActual<Record<string, unknown>>(specifier);
    expect(typeof real[name]).toBe("function");
  });
});

describe("upload queue lazy default deps", () => {
  beforeEach(() => {
    q.__resetForTest();
    vi.clearAllMocks();
  });

  it("imports a spreadsheet through the lazily loaded importer and writer", async () => {
    const file = new File([new Uint8Array([1])], "Budget.xlsx");
    const [item] = q.enqueue([file], "ws1");
    startWithDefaultImporters();
    await settle(item.id);

    expect(mods.importSheetFile).toHaveBeenCalledWith(file);
    expect(mods.applyImportedContent).toHaveBeenCalledWith("doc-sheet", {
      type: "sheet",
      document: { tabOrder: ["t"] },
    });
  });

  it("passes the file and the progress callback to the docx importer", async () => {
    const file = new File([new Uint8Array([1])], "Spec.docx");
    const [item] = q.enqueue([file], "ws1");
    startWithDefaultImporters();
    await settle(item.id);

    expect(mods.importDocx).toHaveBeenCalledWith(file, expect.any(Function));
    expect(mods.applyImportedContent).toHaveBeenCalledWith("doc-doc", {
      type: "doc",
      document: { blocks: [] },
    });
  });

  it("passes the file and the progress callback to the pptx importer", async () => {
    const file = new File([new Uint8Array([1])], "Deck.pptx");
    const [item] = q.enqueue([file], "ws1");
    startWithDefaultImporters();
    await settle(item.id);

    expect(mods.importPptxFile).toHaveBeenCalledWith(
      file,
      expect.any(Function),
    );
    expect(mods.applyImportedContent).toHaveBeenCalledWith("doc-slides", {
      type: "slides",
      document: { slides: [] },
    });
  });
});

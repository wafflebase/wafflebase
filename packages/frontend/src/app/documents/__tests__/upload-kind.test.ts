import { describe, it, expect } from "vitest";
import { classifyUploadKind } from "@/app/documents/upload-kind";

describe("classifyUploadKind", () => {
  it("maps supported extensions case-insensitively", () => {
    expect(classifyUploadKind("Budget.XLSX")).toBe("sheet");
    expect(classifyUploadKind("records.JSON")).toBe("sheet");
    expect(classifyUploadKind("events.jsonl")).toBe("sheet");
    expect(classifyUploadKind("logs.NDJSON")).toBe("sheet");
    expect(classifyUploadKind("notes.docx")).toBe("doc");
    expect(classifyUploadKind("deck.pptx")).toBe("slides");
    expect(classifyUploadKind("report.pdf")).toBe("pdf");
  });

  it("maps image extensions to image", () => {
    expect(classifyUploadKind("photo.png")).toBe("image");
    expect(classifyUploadKind("pic.JPG")).toBe("image");
    expect(classifyUploadKind("pic.jpeg")).toBe("image");
    expect(classifyUploadKind("anim.gif")).toBe("image");
    expect(classifyUploadKind("shot.webp")).toBe("image");
  });
  it("falls back to file for anything else", () => {
    expect(classifyUploadKind("archive.zip")).toBe("file");
    expect(classifyUploadKind("vector.svg")).toBe("file");
    expect(classifyUploadKind("clip.mp4")).toBe("file");
    expect(classifyUploadKind("noext")).toBe("file");
    expect(classifyUploadKind("trailing.")).toBe("file");
  });
});

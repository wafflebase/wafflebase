import { describe, it, expect } from "vitest";
import { classifyUploadKind } from "@/app/documents/upload-kind";

describe("classifyUploadKind", () => {
  it("maps supported extensions case-insensitively", () => {
    expect(classifyUploadKind("Budget.XLSX")).toBe("sheet");
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
  it("returns null for unsupported types", () => {
    expect(classifyUploadKind("archive.zip")).toBeNull();
    expect(classifyUploadKind("vector.svg")).toBeNull();
    expect(classifyUploadKind("noext")).toBeNull();
  });
});

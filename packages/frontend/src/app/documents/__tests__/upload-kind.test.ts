import { describe, it, expect } from "vitest";
import { classifyUploadKind } from "@/app/documents/upload-kind";

describe("classifyUploadKind", () => {
  it("maps supported extensions case-insensitively", () => {
    expect(classifyUploadKind("Budget.XLSX")).toBe("sheet");
    expect(classifyUploadKind("notes.docx")).toBe("doc");
    expect(classifyUploadKind("deck.pptx")).toBe("slides");
    expect(classifyUploadKind("report.pdf")).toBe("pdf");
  });
  it("returns null for unsupported types", () => {
    expect(classifyUploadKind("photo.png")).toBeNull();
    expect(classifyUploadKind("archive.zip")).toBeNull();
    expect(classifyUploadKind("noext")).toBeNull();
  });
});

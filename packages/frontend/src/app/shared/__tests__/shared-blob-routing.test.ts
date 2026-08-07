import { describe, it, expect } from "vitest";
import { sharedBlobKind } from "@/app/shared/shared-document";

describe("sharedBlobKind", () => {
  it("routes pdf to its collaborative layout", () => {
    expect(sharedBlobKind("pdf")).toBe("pdf");
  });

  it("routes the viewer-less blob types away from any Yorkie document", () => {
    // Regression: both used to fall through to the `sheet-<id>` fallback and
    // render an empty spreadsheet.
    expect(sharedBlobKind("image")).toBe("blob");
    expect(sharedBlobKind("file")).toBe("blob");
  });

  it("leaves the CRDT types alone", () => {
    for (const type of ["sheet", "doc", "slides", "note", "board"]) {
      expect(sharedBlobKind(type)).toBe("crdt");
    }
  });
});

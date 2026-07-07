import { describe, expect, it } from "vitest";

import type { Document, DocumentType } from "@/types/documents";
import {
  compareDates,
  lastModified,
  matchesSearch,
  matchesTypes,
} from "@/app/documents/document-list-utils";

function doc(partial: Partial<Document>): Document {
  return {
    id: "1",
    title: "Untitled",
    type: "sheet",
    description: "",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    workspaceId: "w1",
    ...partial,
  };
}

describe("matchesSearch", () => {
  it("matches everything for an empty query", () => {
    expect(matchesSearch(doc({ title: "Budget" }), "")).toBe(true);
    expect(matchesSearch(doc({ title: "Budget" }), "   ")).toBe(true);
  });

  it("matches on the title, case-insensitively", () => {
    expect(matchesSearch(doc({ title: "Q3 Budget" }), "budget")).toBe(true);
    expect(matchesSearch(doc({ title: "Q3 Budget" }), "sales")).toBe(false);
  });

  it("does not match on the document type (that is the chips' job)", () => {
    // A sheet titled "Deck" must not surface when searching "sheet",
    // otherwise a type-name collision floods the list.
    expect(matchesSearch(doc({ title: "Deck", type: "sheet" }), "sheet")).toBe(
      false,
    );
  });

  it("normalizes NFC so decomposed input still matches", () => {
    // "é" composed vs decomposed (e + combining acute).
    expect(matchesSearch(doc({ title: "Café" }), "Café")).toBe(true);
  });
});

describe("matchesTypes", () => {
  const all = new Set<DocumentType>();
  it("passes everything when no type is selected", () => {
    expect(matchesTypes(doc({ type: "doc" }), all)).toBe(true);
  });

  it("filters to the selected types", () => {
    const selected = new Set<DocumentType>(["sheet", "slides"]);
    expect(matchesTypes(doc({ type: "sheet" }), selected)).toBe(true);
    expect(matchesTypes(doc({ type: "slides" }), selected)).toBe(true);
    expect(matchesTypes(doc({ type: "doc" }), selected)).toBe(false);
  });
});

describe("lastModified", () => {
  it("prefers updatedAt", () => {
    expect(
      lastModified({
        updatedAt: "2024-05-01T00:00:00.000Z",
        createdAt: "2024-01-01T00:00:00.000Z",
      }),
    ).toBe("2024-05-01T00:00:00.000Z");
  });

  it("falls back to createdAt when updatedAt is absent", () => {
    expect(
      lastModified({
        updatedAt: undefined as unknown as string,
        createdAt: "2024-01-01T00:00:00.000Z",
      }),
    ).toBe("2024-01-01T00:00:00.000Z");
  });
});

describe("compareDates", () => {
  it("orders older before newer", () => {
    expect(
      compareDates("2024-01-01T00:00:00Z", "2024-02-01T00:00:00Z"),
    ).toBeLessThan(0);
  });

  it("sorts undefined/empty as oldest", () => {
    expect(compareDates(undefined, "2024-01-01T00:00:00Z")).toBeLessThan(0);
    expect(compareDates("2024-01-01T00:00:00Z", undefined)).toBeGreaterThan(0);
  });
});

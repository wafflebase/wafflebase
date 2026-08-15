import { describe, expect, it } from "vitest";

import type { Document, DocumentType } from "@/types/documents";
import {
  compareDates,
  formatExactDate,
  formatFullDateTime,
  formatListDate,
  formatRelativeTime,
  getDocumentPath,
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

  it("treats an unparseable date as oldest, never returning NaN", () => {
    const result = compareDates("not-a-date", "2024-01-01T00:00:00Z");
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBeLessThan(0);
  });
});

describe("formatRelativeTime", () => {
  it("returns an em dash for missing values", () => {
    expect(formatRelativeTime(undefined)).toBe("—");
    expect(formatRelativeTime("")).toBe("—");
  });

  it("returns an em dash for an invalid date instead of throwing", () => {
    // formatDistanceToNow throws RangeError on an invalid Date; the guard
    // must swallow it so one bad row cannot blank the whole list.
    expect(() => formatRelativeTime("not-a-date")).not.toThrow();
    expect(formatRelativeTime("not-a-date")).toBe("—");
  });

  it("formats a valid date as a relative time", () => {
    expect(formatRelativeTime("2024-01-01T00:00:00.000Z")).toMatch(/ago$/);
  });
});

describe("formatExactDate", () => {
  const now = new Date("2026-08-12T00:00:00.000Z");

  it("omits the year for a date in the current calendar year", () => {
    const formatted = formatExactDate("2026-07-25T12:00:00.000Z", now);
    expect(formatted).not.toMatch(/2026/);
    expect(formatted).toMatch(/25/);
  });

  it("includes the year for a date outside the current calendar year", () => {
    expect(formatExactDate("2025-12-01T12:00:00.000Z", now)).toMatch(/2025/);
  });

  it("keeps the year for a December date compared against January", () => {
    // Calendar year, not "within the last 12 months": one day earlier but a
    // different year still shows the year. Built in local time so the
    // assertion holds in any timezone.
    const lastDayOf2025 = new Date(2025, 11, 31, 12, 0).toISOString();
    const firstDayOf2026 = new Date(2026, 0, 1, 12, 0);
    expect(formatExactDate(lastDayOf2025, firstDayOf2026)).toMatch(/2025/);
  });

  it("returns an em dash for missing or unparseable values", () => {
    expect(formatExactDate(undefined)).toBe("—");
    expect(formatExactDate("")).toBe("—");
    expect(() => formatExactDate("not-a-date")).not.toThrow();
    expect(formatExactDate("not-a-date")).toBe("—");
  });
});

describe("formatFullDateTime", () => {
  it("includes the year and a time for the tooltip", () => {
    const formatted = formatFullDateTime("2026-07-25T15:30:00.000Z");
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });

  it("returns an em dash for missing or unparseable values", () => {
    expect(formatFullDateTime(undefined)).toBe("—");
    expect(() => formatFullDateTime("not-a-date")).not.toThrow();
    expect(formatFullDateTime("not-a-date")).toBe("—");
  });
});

describe("formatListDate", () => {
  const now = new Date("2026-08-12T00:00:00.000Z");

  it("renders a relative time for the relative format", () => {
    expect(formatListDate("2024-01-01T00:00:00.000Z", "relative")).toMatch(
      /ago$/,
    );
  });

  it("renders an exact date for the exact format", () => {
    expect(formatListDate("2025-12-01T12:00:00.000Z", "exact", now)).toMatch(
      /2025/,
    );
  });

  it("falls back to an em dash in both formats", () => {
    expect(formatListDate(undefined, "relative")).toBe("—");
    expect(formatListDate(undefined, "exact")).toBe("—");
  });
});

describe("getDocumentPath", () => {
  it("routes each type to its editor path", () => {
    expect(getDocumentPath({ id: "d1", type: "sheet" })).toBe("/s/d1");
    expect(getDocumentPath({ id: "d1", type: "doc" })).toBe("/d/d1");
    expect(getDocumentPath({ id: "d1", type: "slides" })).toBe("/p/d1");
  });

  it("routes pdf documents to /f/:id", () => {
    expect(getDocumentPath({ id: "d1", type: "pdf" })).toBe("/f/d1");
  });

  it("defaults an unknown/absent type to the sheet path", () => {
    expect(getDocumentPath({ id: "d1" })).toBe("/s/d1");
  });
});

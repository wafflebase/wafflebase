import { describe, it, expect } from "vitest";

import {
  describeNote,
  pluralizeSkipLabel,
  summarizeImport,
} from "./miro-import-summary";

describe("summarizeImport", () => {
  it("returns null only for a genuinely clean import", () => {
    expect(summarizeImport({}, [])).toBeNull();
  });

  it("reports a stalled-only result instead of looking clean", () => {
    // Regression guard: `stalled` is a real backend reason (short paginated
    // read). It used to fall through to the success toast, which is exactly
    // the silent-success outcome the backend pushes the note to prevent.
    const summary = summarizeImport({}, [
      { reason: "stalled", itemType: "items", count: 312 },
    ]);

    expect(summary).not.toBeNull();
    expect(summary).toMatch(/incomplete/i);
    expect(summary).toContain("312");
  });

  it("surfaces an unrecognized future reason rather than dropping it", () => {
    // The backend can add reasons this build has never heard of; none of them
    // may make a degraded import look clean.
    const summary = summarizeImport({}, [
      { reason: "some-future-reason", itemType: "shapes", count: 7 },
    ]);

    expect(summary).not.toBeNull();
    expect(summary).toContain("some-future-reason");
    expect(summary).toContain("7");
  });

  it("combines mapper skips with backend notes", () => {
    const summary = summarizeImport({ connector: 3, embed: 1 }, [
      { reason: "image-failed", itemType: "image", count: 2 },
      { reason: "truncated", itemType: "items", count: 5000 },
    ]);

    expect(summary).toContain("3 connectors");
    expect(summary).toContain("1 embed");
    expect(summary).toContain("2 image(s) failed");
    expect(summary).toMatch(/truncated/i);
  });

  it("still warns when only mapper skips are present", () => {
    expect(summarizeImport({ connector: 2 }, [])).toBe("2 connectors skipped");
  });
});

describe("pluralizeSkipLabel", () => {
  it("keeps the singular for a count of one", () => {
    expect(pluralizeSkipLabel("connector", 1)).toBe("1 connector");
  });

  it("pluralizes a count above one", () => {
    expect(pluralizeSkipLabel("connector", 3)).toBe("3 connectors");
  });

  it("does not double-pluralize a type that already ends in s", () => {
    expect(pluralizeSkipLabel("frames", 2)).toBe("2 frames");
  });
});

describe("describeNote", () => {
  it("falls back to the item label when itemType is absent", () => {
    expect(describeNote({ reason: "stalled", count: 4 })).toContain("items");
  });
});

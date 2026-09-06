import { describe, it, expect } from "vitest";

import {
  describeApproximation,
  describeNote,
  describeSkip,
  pluralizeSkipLabel,
  summarizeImport,
} from "./miro-import-summary";

describe("summarizeImport", () => {
  it("returns null only for a genuinely clean import", () => {
    expect(summarizeImport({ skipped: {}, notes: [] })).toBeNull();
  });

  it("reports a stalled-only result instead of looking clean", () => {
    // Regression guard: `stalled` is a real backend reason (short paginated
    // read). It used to fall through to the success toast, which is exactly
    // the silent-success outcome the backend pushes the note to prevent.
    const summary = summarizeImport({ skipped: {}, notes: [
      { reason: "stalled", itemType: "items", count: 312 },
    ] });

    expect(summary).not.toBeNull();
    expect(summary).toMatch(/incomplete/i);
    expect(summary).toContain("312");
  });

  it("surfaces an unrecognized future reason rather than dropping it", () => {
    // The backend can add reasons this build has never heard of; none of them
    // may make a degraded import look clean.
    const summary = summarizeImport({ skipped: {}, notes: [
      { reason: "some-future-reason", itemType: "shapes", count: 7 },
    ] });

    expect(summary).not.toBeNull();
    expect(summary).toContain("some-future-reason");
    expect(summary).toContain("7");
  });

  it("words a budget skip apart from a failure", () => {
    // Both mean "images are missing", but only one of them is a malfunction —
    // conflating them sends the user looking for a broken asset that is fine.
    const summary = summarizeImport({ skipped: {}, notes: [
      { reason: "image-budget", itemType: "image", count: 4 },
    ] });

    expect(summary).not.toBeNull();
    expect(summary).toContain("4");
    expect(summary).toMatch(/limit/i);
    expect(summary).not.toMatch(/failed/i);
  });

  // The reason clauses used to be joined into the item-type list, which
  // appends one trailing "skipped" — yielding "…was not imported skipped".
  it("reads grammatically when item types and drop reasons are both present", () => {
    const summary = summarizeImport({
      skipped: { table: 32, "connector-free-end": 915, connector: 229 },
      notes: [],
    })!;
    expect(summary).toBe(
      "32 tables skipped; " +
        "915 connectors skipped — not attached at both ends in Miro; " +
        "229 connectors skipped — their target was not imported",
    );
    expect(summary).not.toMatch(/imported skipped/);
  });

  it("combines mapper skips with backend notes", () => {
    const summary = summarizeImport({ skipped: { connector: 3, embed: 1 }, notes: [
      { reason: "image-failed", itemType: "image", count: 2 },
      { reason: "truncated", itemType: "items", count: 5000 },
    ] });

    expect(summary).toContain("3 connectors");
    expect(summary).toContain("their target was not imported");
    expect(summary).toContain("1 embed");
    expect(summary).toContain("2 image(s) failed");
    expect(summary).toMatch(/truncated/i);
  });

  it("still warns when only mapper skips are present", () => {
    expect(summarizeImport({ skipped: { embed: 2 }, notes: [] })).toBe("2 embeds skipped");
  });

  it("words an approximation as imported-but-degraded, not as a skip", () => {
    // The old copy read "2 shape-kinds skipped": it told the user content was
    // missing when it was present, under a Miro type that does not exist.
    const summary = summarizeImport({
      skipped: {},
      approximated: { "shape-kind": 2 },
      notes: [],
    });

    expect(summary).not.toBeNull();
    expect(summary).not.toMatch(/skipped/);
    expect(summary).toContain("2 shape(s)");
    expect(summary).toMatch(/rectangles/);
  });

  it("reports connectors the applier had to drop", () => {
    const summary = summarizeImport({
      skipped: {},
      droppedConnectors: 2,
      notes: [],
    });

    expect(summary).toContain("2 connectors dropped");
  });

  it("stays clean when the applier dropped nothing", () => {
    expect(
      summarizeImport({ skipped: {}, approximated: {}, droppedConnectors: 0, notes: [] }),
    ).toBeNull();
  });
});

describe("describeApproximation", () => {
  it("names the missing frame as the reason an item may be misplaced", () => {
    // The item IS in the document, at the wrong spot — the wording has to say
    // "misplaced", not "skipped", or the user goes looking for lost content.
    const text = describeApproximation("parent-position", 4);
    expect(text).toContain("4");
    expect(text).toContain("frame");
    expect(text).not.toContain("skipped");
  });

  it("words the connector degradations as imported-but-detached", () => {
    expect(describeApproximation("connector-caption", 5)).toMatch(/text box/i);
    expect(describeApproximation("connector-caption", 5)).not.toContain("skipped");
    expect(describeApproximation("arrowhead-kind", 2)).toMatch(/arrow/i);
  });

  it("falls back to a generic wording for an unknown degradation kind", () => {
    expect(describeApproximation("some-future-kind", 3)).toContain(
      "some-future-kind",
    );
  });
});

describe("truncation reporting", () => {
  // "truncated at 5000" reads identically whether two items were lost or half
  // the board was, and only one of those is worth telling someone about.
  it("names the fraction that was left behind", () => {
    const text = describeNote({
      reason: "truncated", itemType: "items", count: 5000, total: 8888,
    });
    expect(text).toContain("5000");
    expect(text).toContain("8888");
  });

  it("keeps the old wording when Miro reported no total", () => {
    const text = describeNote({ reason: "truncated", itemType: "items", count: 5000 });
    expect(text).toContain("5000");
    expect(text).toMatch(/limit/);
  });

  // Everything else in the summary says "one detail came across wrong". These
  // say "you do not have all of it", so they must not be buried behind a
  // hundred characters of detail notes.
  it("leads the summary with an incomplete import, ahead of every detail", () => {
    const summary = summarizeImport({
      skipped: { "connector-free-end": 915, table: 32 },
      approximated: { "shape-kind": 51 },
      notes: [
        { reason: "image-failed", itemType: "image", count: 2 },
        { reason: "truncated", itemType: "items", count: 5000, total: 8888 },
      ],
    })!;
    expect(summary.indexOf("8888")).toBeLessThan(summary.indexOf("915"));
    expect(summary.indexOf("8888")).toBeLessThan(summary.indexOf("image(s) failed"));
    // ...and it is still reported exactly once.
    expect(summary.match(/8888/g)).toHaveLength(1);
  });

  it("leads with a stalled feed for the same reason", () => {
    const summary = summarizeImport({
      skipped: { embed: 4 },
      notes: [{ reason: "stalled", itemType: "items", count: 120 }],
    })!;
    expect(summary.indexOf("stopped returning")).toBeLessThan(summary.indexOf("4 embeds"));
  });
});

describe("describeSkip", () => {
  // A connector Miro itself left dangling and one whose target we did not
  // import are different facts, and only the second is worth re-importing for.
  it("tells the two connector drop reasons apart", () => {
    const free = describeSkip("connector-free-end", 915)!;
    const unmapped = describeSkip("connector", 229)!;
    expect(free).toContain("915 connectors");
    expect(free).toMatch(/Miro/);
    expect(unmapped).toContain("229 connectors");
    expect(unmapped).toMatch(/not imported/);
    expect(free).not.toBe(unmapped);
  });

  // These carry their own "skipped" because they cannot be grouped with the
  // item types, which share one trailing "skipped" between them.
  it("returns a complete clause for a reason key", () => {
    expect(describeSkip("connector-free-end", 2)).toMatch(/ skipped /);
  });

  it("declines an ordinary item type, leaving it to the grouped list", () => {
    expect(describeSkip("embed", 3)).toBeNull();
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

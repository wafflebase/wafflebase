import { describe, it, expect } from "vitest";
import { describeImportProgress } from "./miro-import-progress";

describe("describeImportProgress", () => {
  it("falls back to the static label before the first line arrives", () => {
    expect(describeImportProgress(null)).toBe("Reading board…");
  });

  it("names the stage and the running count for each stage", () => {
    expect(describeImportProgress({ stage: "items", done: 150 })).toBe(
      "Reading board… 150 items",
    );
    expect(describeImportProgress({ stage: "connectors", done: 40 })).toBe(
      "Reading connectors… 40",
    );
    expect(
      describeImportProgress({ stage: "images", done: 3, total: 12 }),
    ).toBe("Importing images… 3/12");
  });

  it("groups large counts so they read as counts, not ids", () => {
    // A 3000-item board is exactly the case that made the import look hung.
    expect(describeImportProgress({ stage: "items", done: 1250 })).toBe(
      "Reading board… 1,250 items",
    );
  });

  it("degrades to done/done when the images stage reports no total", () => {
    expect(describeImportProgress({ stage: "images", done: 4 })).toBe(
      "Importing images… 4/4",
    );
  });

  it("never renders a bare stage name for an unknown stage", () => {
    // `stage` widens as the backend grows phases; an unrecognized one must
    // still read as progress rather than as a crash or an empty button.
    const forward = { stage: "shapes", done: 9 } as unknown as Parameters<
      typeof describeImportProgress
    >[0];
    expect(describeImportProgress(forward)).toBe("Reading board…");
  });
});

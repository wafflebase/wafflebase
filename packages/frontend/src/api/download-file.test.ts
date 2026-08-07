import { describe, it, expect } from "vitest";
import { downloadFileName } from "./download-file";

describe("downloadFileName", () => {
  it("appends the extension from a dotted fileId", () => {
    expect(downloadFileName("report", "abc-123.zip")).toBe("report.zip");
  });

  it("does not duplicate the extension when the title already has it", () => {
    expect(downloadFileName("report.zip", "abc-123.zip")).toBe("report.zip");
  });

  it("falls back to the title when fileId has no dot (uuid-only blob key)", () => {
    // Regression: `fileId.split(".").pop()` on a dot-less id used to return
    // the *entire id* as the "extension" — e.g. saving "Makefile" as
    // "Makefile.11111111-2222-3333-4444-555555555555".
    expect(
      downloadFileName(
        "Makefile",
        "11111111-2222-3333-4444-555555555555",
      ),
    ).toBe("Makefile");
  });

  it("falls back to the MIME-derived extension when fileId is absent", () => {
    expect(downloadFileName("shot", undefined, "image/png")).toBe(
      "shot.png",
    );
  });

  it("prefers the fileId extension over the MIME fallback when both exist", () => {
    expect(
      downloadFileName("report", "abc-123.zip", "application/octet-stream"),
    ).toBe("report.zip");
  });

  it("does not append a MIME extension over one the title already has", () => {
    // Titles now carry the original filename, so the MIME fallback can
    // disagree with an extension that is already there: `image/jpeg` maps to
    // "jpg", which would have turned "photo.jpeg" into "photo.jpeg.jpg". The
    // fallback is only for the older rows whose title was stored stripped.
    expect(downloadFileName("photo.jpeg", undefined, "image/jpeg")).toBe(
      "photo.jpeg",
    );
    // Same when the blob key is extension-less because the sanitizer rejected
    // the extension — the title is the only correct name available.
    expect(
      downloadFileName(
        "archive.c++",
        "11111111-2222-3333-4444-555555555555",
        "application/octet-stream",
      ),
    ).toBe("archive.c++");
  });

  it("still applies the MIME fallback to a stripped legacy title", () => {
    expect(downloadFileName("shot", undefined, "image/jpeg")).toBe("shot.jpg");
  });

  it("returns the bare title when neither fileId nor a known MIME is available", () => {
    expect(
      downloadFileName(
        "Makefile",
        "11111111-2222-3333-4444-555555555555",
        "application/octet-stream",
      ),
    ).toBe("Makefile");
  });
});

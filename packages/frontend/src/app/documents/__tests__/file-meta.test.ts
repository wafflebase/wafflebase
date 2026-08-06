import { describe, it, expect } from "vitest";
import { formatFileSize, uploadSizeError } from "@/app/documents/file-meta";

describe("formatFileSize", () => {
  it("scales to the largest unit that keeps the number small", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("renders an em dash when the size is unknown", () => {
    expect(formatFileSize(undefined)).toBe("—");
  });
});

describe("uploadSizeError", () => {
  it("passes anything within the cap", () => {
    expect(uploadSizeError("file", 1024)).toBeUndefined();
    expect(uploadSizeError("image", 1024)).toBeUndefined();
  });

  it("holds images to the tighter cap", () => {
    expect(uploadSizeError("image", 30 * 1024 * 1024)).toBe(
      "File is larger than the 25 MB limit",
    );
    expect(uploadSizeError("file", 30 * 1024 * 1024)).toBeUndefined();
  });

  it("rejects anything past the shared cap", () => {
    expect(uploadSizeError("file", 51 * 1024 * 1024)).toBe(
      "File is larger than the 50 MB limit",
    );
  });

  it("applies the image cap when the MIME says image but the extension does not", () => {
    // A .heic classifies as "file" (no EXT_TO_KIND entry) but the browser
    // reports image/heic, and the server caps it at 25 MB from the MIME.
    // Without this the body crossed the wire before failing.
    expect(uploadSizeError("file", 30 * 1024 * 1024, "image/heic")).toBe(
      "File is larger than the 25 MB limit",
    );
    expect(uploadSizeError("file", 30 * 1024 * 1024, "application/zip")).toBeUndefined();
  });
});

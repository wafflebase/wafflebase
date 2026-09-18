import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "./chunk-load-error";

/** The message WebKit produced in Sentry WAFFLEBASE-2. */
const WEBKIT = "Importing a module script failed.";

function chunkError(message = WEBKIT) {
  return new TypeError(message);
}

describe("isChunkLoadError", () => {
  it.each([
    ["WebKit", WEBKIT],
    ["Chromium", "Failed to fetch dynamically imported module: /assets/x.js"],
    ["Firefox", "error loading dynamically imported module"],
    ["Vite CSS preload", "Unable to preload CSS for /assets/x.css"],
  ])("recognizes the %s message", (_name, message) => {
    expect(isChunkLoadError(chunkError(message))).toBe(true);
  });

  it("is case insensitive", () => {
    expect(
      isChunkLoadError(chunkError("IMPORTING A MODULE SCRIPT FAILED.")),
    ).toBe(true);
  });

  it("rejects an ordinary error thrown by a module that did load", () => {
    expect(isChunkLoadError(new TypeError("x is not a function"))).toBe(false);
  });

  it.each([[null], [undefined], [{}], [42], [""]])(
    "rejects the non-error value %p",
    (value) => {
      expect(isChunkLoadError(value)).toBe(false);
    },
  );
});

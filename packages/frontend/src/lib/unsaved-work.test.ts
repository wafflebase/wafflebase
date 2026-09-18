import { afterEach, describe, expect, it } from "vitest";
import {
  hasUnsavedWork,
  registerUnsavedWorkProbe,
  resetUnsavedWorkProbes,
} from "./unsaved-work";

afterEach(() => {
  resetUnsavedWorkProbes();
});

describe("unsaved work registry", () => {
  it("reports nothing at risk when no document is mounted", () => {
    expect(hasUnsavedWork()).toBe(false);
  });

  it("follows the probe", () => {
    let unsent = false;
    registerUnsavedWorkProbe(() => unsent);

    expect(hasUnsavedWork()).toBe(false);
    unsent = true;
    expect(hasUnsavedWork()).toBe(true);
  });

  it("is true when any one of several documents has work", () => {
    registerUnsavedWorkProbe(() => false);
    registerUnsavedWorkProbe(() => true);

    expect(hasUnsavedWork()).toBe(true);
  });

  it("stops reporting once the probe unregisters", () => {
    const unregister = registerUnsavedWorkProbe(() => true);
    expect(hasUnsavedWork()).toBe(true);

    unregister();
    expect(hasUnsavedWork()).toBe(false);
  });

  it("unregistering twice is harmless", () => {
    const unregister = registerUnsavedWorkProbe(() => true);
    unregister();
    unregister();

    expect(hasUnsavedWork()).toBe(false);
  });

  it("treats a probe that throws as work at risk", () => {
    // The caller is deciding whether to discard the page. An unanswerable
    // question is not permission.
    registerUnsavedWorkProbe(() => {
      throw new Error("store torn down mid-unmount");
    });

    expect(hasUnsavedWork()).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

vi.mock("@/api/auth", () => ({ fetchWithAuth: vi.fn() }));
vi.mock("@/api/files", () => ({ fileUrl: (id: string) => `/files/${id}` }));

import { fetchWithAuth } from "@/api/auth";
import { ImageThumb } from "../image-thumb";
import { MAX_THUMB_SOURCE_BYTES, canThumbnail } from "../image-thumb-size";

const fetchMock = vi.mocked(fetchWithAuth);

// jsdom has no IntersectionObserver. This one records its callbacks so a
// test can scroll a row "into view" on demand.
let observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void>;

class FakeObserver {
  constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
    observers.push(cb);
  }
  observe() {}
  disconnect() {}
}

function scrollIntoView() {
  for (const cb of observers) cb([{ isIntersecting: true }]);
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  URL.createObjectURL = vi.fn(() => "blob:thumb");
  URL.revokeObjectURL = vi.fn();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    blob: async () => new Blob(["x"], { type: "image/png" }),
  } as unknown as Response);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("canThumbnail", () => {
  it("accepts only a known size within the cap", () => {
    expect(canThumbnail(1)).toBe(true);
    expect(canThumbnail(MAX_THUMB_SOURCE_BYTES)).toBe(true);
    expect(canThumbnail(MAX_THUMB_SOURCE_BYTES + 1)).toBe(false);
    expect(canThumbnail(25 * 1024 * 1024)).toBe(false);
    expect(canThumbnail(0)).toBe(false);
    expect(canThumbnail(undefined)).toBe(false);
    expect(canThumbnail(null)).toBe(false);
  });
});

describe("ImageThumb", () => {
  it("fetches a small image only once it scrolls into view", async () => {
    const { container } = render(
      <ImageThumb documentId="d1" fileSize={50_000} />,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => scrollIntoView());

    expect(fetchMock).toHaveBeenCalledWith("/files/d1", expect.anything());
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "blob:thumb",
    );
  });

  it.each([
    ["over the cap", 20 * 1024 * 1024],
    ["of unknown size", undefined],
  ])("keeps the type icon and downloads nothing for an image %s", async (_, size) => {
    const { container } = render(
      <ImageThumb documentId="d2" fileSize={size} />,
    );
    await act(async () => scrollIntoView());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(observers).toHaveLength(0);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

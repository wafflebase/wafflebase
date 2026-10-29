import { describe, expect, it, vi } from "vitest";
import type { SlidesDocument } from "@wafflebase/slides";
import { createSlideRenderHook } from "./slide-render-hook";

const doc = { slides: [{ id: "a" }, { id: "b" }] } as unknown as SlidesDocument;
const canvas = (url = "data:image/png;base64,AAAA") => ({ toDataURL: () => url });

describe("createSlideRenderHook", () => {
  it("counts the loaded deck's slides, 0 before it loads", () => {
    expect(createSlideRenderHook(() => doc).count()).toBe(2);
    expect(createSlideRenderHook(() => null).count()).toBe(0);
  });

  it("returns the PNG at once when no image is loading", async () => {
    const render = vi.fn(async () => canvas());
    const hook = createSlideRenderHook(() => doc, { render, pendingImages: () => false });
    await expect(hook.render(1)).resolves.toBe("data:image/png;base64,AAAA");
    expect(render).toHaveBeenCalledWith(doc, 1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("repaints until late image loads have settled", async () => {
    let pending = 3; // still loading for the first three passes
    const render = vi.fn(async () => canvas());
    const hook = createSlideRenderHook(() => doc, {
      render,
      pendingImages: () => pending-- > 0,
      pollMs: 1,
    });
    await expect(hook.render(0)).resolves.toMatch(/^data:image\/png/);
    expect(render).toHaveBeenCalledTimes(4);
  });

  it("reports the slide unrenderable when an image never finishes in time", async () => {
    const hook = createSlideRenderHook(() => doc, {
      render: async () => canvas(),
      pendingImages: () => true,
      settleTimeoutMs: 20,
      pollMs: 1,
    });
    await expect(hook.render(0)).resolves.toBeNull();
  });

  it("reports a tainted canvas or a missing slide as unrenderable", async () => {
    const tainted = createSlideRenderHook(() => doc, {
      render: async () => ({
        toDataURL: () => {
          throw new Error("SecurityError");
        },
      }),
      pendingImages: () => false,
    });
    await expect(tainted.render(0)).resolves.toBeNull();
    const missing = createSlideRenderHook(() => doc, {
      render: async () => null,
      pendingImages: () => false,
    });
    await expect(missing.render(5)).resolves.toBeNull();
  });
});

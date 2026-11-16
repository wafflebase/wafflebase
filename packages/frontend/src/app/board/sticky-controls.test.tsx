import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SlidesEditor, SlidesStore } from "@wafflebase/slides";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StickyControls } from "./sticky-controls";
import { STICKY_COLORS } from "./sticky";

/** A store holding shapes with the given srgb fills, ids `a`, `b`, … */
function fakeStore(fills: string[]) {
  const elements = fills.map((value, i) => ({
    id: String.fromCharCode(97 + i),
    type: "shape",
    data: { kind: "roundRect", fill: { kind: "srgb", value } },
  }));
  const updateElementData = vi.fn();
  const batch = vi.fn((fn: () => void) => fn());
  const store = {
    read: () => ({ slides: [{ id: "board", elements }] }),
    updateElementData,
    batch,
  } as unknown as SlidesStore;
  return { store, updateElementData, batch };
}

function renderControls(store: SlidesStore, ids: string[]) {
  return render(
    <TooltipProvider>
      <StickyControls editor={{} as SlidesEditor} store={store} ids={ids} />
    </TooltipProvider>,
  );
}

const pink = STICKY_COLORS.find((c) => c.name === "Pink")!;
const yellow = STICKY_COLORS.find((c) => c.name === "Yellow")!;

describe("StickyControls", () => {
  it("renders the six sticky colours", () => {
    const { store } = fakeStore([yellow.value]);
    renderControls(store, ["a"]);
    for (const c of STICKY_COLORS) {
      expect(screen.getByRole("button", { name: c.name })).toBeTruthy();
    }
  });

  it("presses the colour every selected sticky shares, case-insensitively", () => {
    const { store } = fakeStore([pink.value.toLowerCase(), pink.value]);
    renderControls(store, ["a", "b"]);
    expect(screen.getByRole("button", { name: "Pink" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Yellow" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("presses nothing for a mixed selection", () => {
    const { store } = fakeStore([pink.value, yellow.value]);
    renderControls(store, ["a", "b"]);
    for (const c of STICKY_COLORS) {
      expect(screen.getByRole("button", { name: c.name }).getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("recolours every selected sticky in one batch", async () => {
    const { store, updateElementData, batch } = fakeStore([pink.value, yellow.value]);
    renderControls(store, ["a", "b"]);
    await userEvent.click(screen.getByRole("button", { name: "Blue" }));
    const blue = STICKY_COLORS.find((c) => c.name === "Blue")!.value;
    expect(batch).toHaveBeenCalledTimes(1);
    expect(updateElementData).toHaveBeenCalledTimes(2);
    expect(updateElementData).toHaveBeenCalledWith("board", "a", { fill: { kind: "srgb", value: blue } });
    expect(updateElementData).toHaveBeenCalledWith("board", "b", { fill: { kind: "srgb", value: blue } });
  });
});

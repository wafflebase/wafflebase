import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SlidesEditor, SlidesStore } from "@wafflebase/slides";
import { TooltipProvider } from "@/components/ui/tooltip";
import { STICKY_SIZE_TRIGGER, StickyControls } from "./sticky-controls";
import { STICKY_COLORS } from "./sticky";

/** A store holding shapes with the given srgb fills, ids `a`, `b`, … */
function fakeStore(fills: string[]) {
  const elements = fills.map((value, i) => ({
    id: String.fromCharCode(97 + i),
    type: "shape",
    frame: { x: 0, y: 0, w: 180, h: 180, rotation: 0 },
    data: {
      kind: "roundRect",
      role: "sticky",
      fill: { kind: "srgb", value },
      author: "Ada",
      text: {
        blocks: [{ id: "b", type: "paragraph", inlines: [{ text: "x", style: { fontSize: 18 } }], style: {} }],
        autofit: "shrink",
      },
    },
  }));
  const updateElementData = vi.fn();
  const updateElementFrame = vi.fn();
  const batch = vi.fn((fn: () => void) => fn());
  const store = {
    read: () => ({ slides: [{ id: "board", elements }] }),
    updateElementData,
    updateElementFrame,
    batch,
  } as unknown as SlidesStore;
  return { store, updateElementData, updateElementFrame, batch };
}

function renderControls(
  store: SlidesStore,
  ids: string[],
  colorsOnly = false,
  variant?: "inline" | "menu",
) {
  return render(
    <TooltipProvider>
      <StickyControls
        editor={{} as SlidesEditor}
        store={store}
        ids={ids}
        colorsOnly={colorsOnly}
        variant={variant}
      />
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

  it("shows only the colours for a mixed selection", () => {
    const { store } = fakeStore([pink.value]);
    renderControls(store, ["a"], true);
    expect(screen.getByRole("button", { name: "Pink" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Increase text size" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Sticky size/ })).toBeNull();
  });

  it("reads the shared size preset and text size", () => {
    const { store } = fakeStore([pink.value, yellow.value]);
    renderControls(store, ["a", "b"]);
    expect(screen.getByRole("button", { name: "Sticky size: Medium" })).toBeTruthy();
    expect(screen.getByLabelText("Text size").textContent).toBe("18");
  });

  it("steps the text size of every selected sticky in one batch", async () => {
    const { store, updateElementData, batch } = fakeStore([pink.value, yellow.value]);
    renderControls(store, ["a", "b"]);
    await userEvent.click(screen.getByRole("button", { name: "Increase text size" }));
    expect(batch).toHaveBeenCalledTimes(1);
    expect(updateElementData).toHaveBeenCalledTimes(2);
    const [, , patch] = updateElementData.mock.calls[0];
    expect(patch.text.blocks[0].inlines[0].style.fontSize).toBe(24);
    expect(patch.text.autofit).toBe("shrink");
  });

  it("toggles the author tag off for the selection", async () => {
    const { store, updateElementData } = fakeStore([pink.value]);
    renderControls(store, ["a"]);
    const toggle = screen.getByRole("button", { name: "Show author" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(toggle);
    expect(updateElementData).toHaveBeenCalledWith("board", "a", { showAuthor: false });
  });

  it("disables the author toggle on an anonymous board", () => {
    const { store } = fakeStore([pink.value]);
    Object.assign(store, { isAnonymous: () => true, setAnonymous: vi.fn() });
    renderControls(store, ["a"]);
    const toggle = screen.getByRole("button", { name: "Show author" });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the size trigger one fixed width whatever preset it names", () => {
    const classesFor = (w: number) => {
      const { store } = fakeStore([yellow.value]);
      const el = (store.read() as unknown as { slides: { elements: { frame: { w: number; h: number } }[] }[] })
        .slides[0].elements[0];
      el.frame.w = w;
      el.frame.h = w;
      const view = renderControls(store, ["a"]);
      const trigger = screen.getByRole("button", { name: /^Sticky size:/ });
      const cls = trigger.className;
      view.unmount();
      return cls;
    };
    const small = classesFor(120);
    const medium = classesFor(180);
    expect(small).toBe(medium);
    for (const c of STICKY_SIZE_TRIGGER.split(" ")) expect(small.split(/\s+/)).toContain(c);
    expect(small).toMatch(/(^|\s)w-\d+/);
  });

  it("folds the swatches behind one trigger naming the current colour (menu)", async () => {
    const { store, updateElementData } = fakeStore([pink.value]);
    renderControls(store, ["a"], false, "menu");
    expect(screen.queryByRole("button", { name: "Yellow" })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Sticky note color: Pink" }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: "Yellow" }));
    expect(updateElementData).toHaveBeenCalledWith("board", "a", {
      fill: { kind: "srgb", value: yellow.value },
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VIEWPORT, type Viewport } from "@wafflebase/board";
import {
  applyGridBackground,
  DEFAULT_GRID_KIND,
  gridBackgroundStyle,
  gridStep,
  loadGridKind,
  loadGridSnap,
  saveGridKind,
  saveGridSnap,
  DEFAULT_GRID_SNAP,
} from "./board-grid";

/** First number in a `"12px 34px"`-style CSS value. */
function px(value: string): number {
  return Number.parseFloat(value);
}

/**
 * Comma-separated CSS layer list → per-layer strings. Depth-aware: the
 * commas inside `rgba(...)` and `linear-gradient(...)` are not separators.
 */
function layers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

describe("gridStep", () => {
  it("floors at 20 world units however far in the board is zoomed", () => {
    expect(gridStep(1)).toBe(20);
    expect(gridStep(2)).toBe(20);
    expect(gridStep(8)).toBe(20);
  });

  it("climbs the 1-2-5 ladder as the board zooms out", () => {
    expect(gridStep(0.5)).toBe(50);
    expect(gridStep(0.2)).toBe(100);
    expect(gridStep(0.1)).toBe(200);
  });

  it("keeps on-screen spacing inside [20, 50) px across the zoom range", () => {
    for (let zoom = 0.1; zoom <= 8; zoom += 0.01) {
      const spacing = gridStep(zoom) * zoom;
      expect(spacing).toBeGreaterThanOrEqual(20 - 1e-9);
      // Only the floored (zoomed-in) end may exceed the ladder's ratio: at
      // zoom 8 the 20-unit floor is already 160 px apart.
      if (zoom < 1) expect(spacing).toBeLessThan(50);
    }
  });

  it("falls back to the floor on a non-finite or non-positive zoom", () => {
    expect(gridStep(0)).toBe(20);
    expect(gridStep(-1)).toBe(20);
    expect(gridStep(Number.NaN)).toBe(20);
    expect(gridStep(Number.POSITIVE_INFINITY)).toBe(20);
  });
});

describe("gridBackgroundStyle", () => {
  it("returns null for 'none' so the caller clears the background", () => {
    expect(gridBackgroundStyle("none", DEFAULT_VIEWPORT, "light")).toBeNull();
  });

  it("sizes the dot tile to the on-screen step", () => {
    const style = gridBackgroundStyle("dot", { panX: 0, panY: 0, zoom: 0.5 }, "light");
    // step 50 world units × zoom 0.5 = 25 screen px
    expect(style?.backgroundSize).toBe("25px 25px");
  });

  it("offsets dots by half a cell so they land on grid intersections", () => {
    const size = 20; // zoom 1 → step 20 world = 20 screen px
    const style = gridBackgroundStyle("dot", { panX: 0, panY: 0, zoom: 1 }, "light");
    // A tile-centred radial gradient at offset 0 would put dots at cell
    // centres; the half-cell shift puts them back on the intersections.
    expect(px(style!.backgroundPosition)).toBeCloseTo(size / 2);
  });

  it("wraps a large pan into one tile instead of emitting raw offsets", () => {
    // A Miro-imported board routinely sits tens of thousands of units from
    // the world origin.
    const far: Viewport = { panX: 123456.5, panY: -98765.25, zoom: 1 };
    const style = gridBackgroundStyle("dot", far, "light")!;
    const [x, y] = style.backgroundPosition.split(" ").map(px);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(20);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(20);
  });

  it("keeps a negative pan non-negative (euclidean, not '%')", () => {
    const style = gridBackgroundStyle("line", { panX: -5, panY: -5, zoom: 1 }, "light")!;
    for (const layer of layers(style.backgroundPosition)) {
      for (const component of layer.split(" ")) {
        expect(px(component)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("paints line mode as major-over-minor layers at a 5:1 ratio", () => {
    const style = gridBackgroundStyle("line", { panX: 0, panY: 0, zoom: 1 }, "light")!;
    const images = layers(style.backgroundImage);
    const sizes = layers(style.backgroundSize);
    expect(images).toHaveLength(4);
    // Major first: earlier layers paint on top, so a major line wins where
    // it coincides with a minor one.
    expect(px(sizes[0])).toBe(px(sizes[2]) * 5);
    expect(images[0]).toContain("to right");
    expect(images[1]).toContain("to bottom");
  });

  it("pairs each line layer with ITS OWN offset, majors on major tiles", () => {
    // The single highest-value assertion in the file: the four
    // `background-position` entries are matched to the four
    // `background-image` layers BY INDEX, so transposing the major and
    // minor pairs would misalign every major line against its own minors
    // on screen while leaving the layer count, sizes and directions —
    // everything else asserted here — untouched.
    // size 20, major 100: x = 30 mod 20 = 10, y = -7 mod 20 = 13,
    // majorX = 30 mod 100 = 30, majorY = -7 mod 100 = 93.
    const style = gridBackgroundStyle("line", { panX: 30, panY: -7, zoom: 1 }, "light")!;
    expect(layers(style.backgroundPosition)).toEqual([
      "30px 93px",
      "30px 93px",
      "10px 13px",
      "10px 13px",
    ]);
  });

  it("uses light-on-dark ink in the dark theme", () => {
    const light = gridBackgroundStyle("dot", DEFAULT_VIEWPORT, "light")!;
    const dark = gridBackgroundStyle("dot", DEFAULT_VIEWPORT, "dark")!;
    expect(light.backgroundImage).toContain("rgba(0, 0, 0");
    expect(dark.backgroundImage).toContain("rgba(255, 255, 255");
  });
});

describe("applyGridBackground", () => {
  it("writes the mapped style onto the host", () => {
    const host = document.createElement("div");
    applyGridBackground(host, "dot", DEFAULT_VIEWPORT, "light");
    expect(host.style.backgroundImage).toContain("radial-gradient");
    expect(host.style.backgroundSize).toBe("20px 20px");
    expect(host.style.backgroundRepeat).toBe("repeat");
  });

  it("clears every property it owns on 'none'", () => {
    // The path behind the toolbar's "None" option: switching away from a
    // painted grid has to leave no residue of it behind.
    const host = document.createElement("div");
    applyGridBackground(host, "line", DEFAULT_VIEWPORT, "light");
    applyGridBackground(host, "none", DEFAULT_VIEWPORT, "light");
    expect(host.style.backgroundImage).toBe("");
    expect(host.style.backgroundSize).toBe("");
    expect(host.style.backgroundPosition).toBe("");
    expect(host.style.backgroundRepeat).toBe("");
  });

  it("tracks a pan without rebuilding the tile", () => {
    const host = document.createElement("div");
    applyGridBackground(host, "line", { panX: 0, panY: 0, zoom: 1 }, "light");
    const size = host.style.backgroundSize;
    applyGridBackground(host, "line", { panX: 7, panY: 3, zoom: 1 }, "light");
    expect(host.style.backgroundPosition).toContain("7px");
    expect(host.style.backgroundSize).toBe(size);
  });
});

describe("grid kind persistence", () => {
  beforeEach(() => {
    // Otherwise these cases depend on each other's leftovers by luck.
    localStorage.clear();
  });

  it("round-trips through localStorage", () => {
    saveGridKind("line");
    expect(loadGridKind()).toBe("line");
    saveGridKind("none");
    expect(loadGridKind()).toBe("none");
  });

  it("falls back to the default for a missing or corrupted value", () => {
    expect(loadGridKind()).toBe(DEFAULT_GRID_KIND);
    localStorage.setItem("wafflebase.board.grid", "hexagons");
    expect(loadGridKind()).toBe(DEFAULT_GRID_KIND);
  });

  it("survives storage that throws (private mode, blocked cookies)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(loadGridKind()).toBe(DEFAULT_GRID_KIND);
    expect(() => saveGridKind("line")).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe("grid snap persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips through localStorage", () => {
    saveGridSnap(true);
    expect(loadGridSnap()).toBe(true);
    saveGridSnap(false);
    expect(loadGridSnap()).toBe(false);
  });

  it("falls back to the default for a missing or corrupted value", () => {
    expect(loadGridSnap()).toBe(DEFAULT_GRID_SNAP);
    localStorage.setItem("wafflebase.board.grid-snap", "yes");
    expect(loadGridSnap()).toBe(DEFAULT_GRID_SNAP);
  });

  it("is stored independently of the grid mode", () => {
    // The two are separate settings — `none` + snap on is valid, and
    // must not be collapsible by one write clobbering the other.
    saveGridKind("none");
    saveGridSnap(true);
    expect(loadGridKind()).toBe("none");
    expect(loadGridSnap()).toBe(true);
  });

  it("survives storage that throws (private mode, blocked cookies)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(loadGridSnap()).toBe(DEFAULT_GRID_SNAP);
    expect(() => saveGridSnap(true)).not.toThrow();
    vi.restoreAllMocks();
  });
});

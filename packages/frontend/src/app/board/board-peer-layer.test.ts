import { afterEach, describe, expect, it, vi } from "vitest";
import type { Viewport } from "@wafflebase/board";
import {
  createBoardPeerLayer,
  edgePlacement,
  initials,
  type BoardPeerInput,
} from "./board-peer-layer";

describe("edgePlacement", () => {
  const host = { w: 800, h: 600 };
  it("is null for an on-screen cursor", () => {
    expect(edgePlacement({ x: 10, y: 10 }, host)).toBeNull();
  });
  it("clamps an off-screen cursor to the inset edge and points at it", () => {
    const right = edgePlacement({ x: 5000, y: 300 }, host)!;
    expect(right.x).toBe(800 - 18);
    expect(right.y).toBe(300);
    expect(right.angle).toBeCloseTo(0);
    const above = edgePlacement({ x: 400, y: -100 }, host)!;
    expect(above.y).toBe(18);
    expect(above.angle).toBeCloseTo(-Math.PI / 2);
  });
});

describe("initials", () => {
  it("takes up to two letters", () => {
    expect(initials("ada lovelace")).toBe("AL");
    expect(initials("bob")).toBe("BO");
    expect(initials(" ")).toBe("?");
  });
});

function setup(vp: Viewport = { panX: 0, panY: 0, zoom: 1 }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const frames: ((t: number) => void)[] = [];
  const onJump = vi.fn();
  const layer = createBoardPeerLayer({
    container,
    getViewport: () => vp,
    getHost: () => ({ w: 800, h: 600 }),
    onJump,
    requestFrame: (cb) => frames.push(cb),
    cancelFrame: () => undefined,
  });
  const flush = (n = 120) => {
    let t = 0;
    for (let i = 0; i < n && frames.length; i++) {
      t += 16;
      frames.shift()!(t);
    }
  };
  return { container, layer, frames, flush, onJump };
}

const peer = (over: Partial<BoardPeerInput> = {}): BoardPeerInput => ({
  clientID: "p1",
  color: "#e11d48",
  label: "Ada",
  cursor: { x: 100, y: 100 },
  chat: null,
  emote: null,
  ...over,
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("createBoardPeerLayer", () => {
  it("swaps the arrow for a pen glyph while the peer draws", () => {
    const { container, layer } = setup();
    layer.setPeers([peer({ drawing: true })]);
    const root = container.querySelector('[data-peer-cursor="p1"]')!;
    const [arrow, pen] = Array.from(root.querySelectorAll("svg")) as SVGSVGElement[];
    expect(arrow.style.display).toBe("none");
    expect(pen.style.display).toBe("block");
    layer.setPeers([peer({ drawing: false })]);
    expect(arrow.style.display).toBe("block");
    expect(pen.style.display).toBe("none");
  });

  it("keeps one persistent DOM node per peer across updates", () => {
    const { container, layer } = setup();
    layer.setPeers([peer()]);
    const node = container.querySelector('[data-peer-cursor="p1"]');
    layer.setPeers([peer({ cursor: { x: 120, y: 100 } })]);
    expect(container.querySelector('[data-peer-cursor="p1"]')).toBe(node);
    expect(container.querySelectorAll("[data-peer-cursor]")).toHaveLength(1);
  });

  it("springs toward a new position and stops the loop once settled", () => {
    const { container, layer, frames, flush } = setup();
    layer.setPeers([peer()]);
    flush();
    layer.setPeers([peer({ cursor: { x: 300, y: 100 } })]);
    const node = container.querySelector<HTMLElement>('[data-peer-cursor="p1"]')!;
    // One frame in: on the way, not there.
    frames.shift()!(16);
    const mid = Number(/translate\(([-\d.]+)px/.exec(node.style.transform)![1]);
    expect(mid).toBeGreaterThan(99);
    expect(mid).toBeLessThan(299);
    flush();
    expect(node.style.transform).toBe("translate(299px, 99px)");
    expect(frames).toHaveLength(0);
  });

  it("shows the name tag and cursor chat in the peer's colour", () => {
    const { container, layer } = setup();
    layer.setPeers([peer({ chat: "hello" })]);
    const node = container.querySelector('[data-peer-cursor="p1"]')!;
    expect(node.textContent).toContain("Ada");
    expect(node.textContent).toContain("hello");
  });

  it("swaps an off-screen cursor for a clickable edge indicator", () => {
    const { container, layer, onJump } = setup();
    layer.setPeers([peer({ cursor: { x: 5000, y: 300 } })]);
    const node = container.querySelector<HTMLElement>('[data-peer-cursor="p1"]')!;
    expect(node.style.display).toBe("none");
    const edge = container.querySelector<HTMLButtonElement>('button[aria-label="Jump to Ada"]')!;
    expect(edge.style.display).toBe("flex");
    edge.click();
    expect(onJump).toHaveBeenCalledWith("p1");
  });

  it("removes a peer who left", () => {
    const { container, layer } = setup();
    layer.setPeers([peer()]);
    layer.setPeers([]);
    expect(container.querySelector("[data-peer-cursor]")).toBeNull();
  });

  it("bursts a new emote but not one already present on first sight", () => {
    const { container, layer } = setup();
    const emote = { emoji: "🎉", x: 10, y: 10, at: 1 };
    layer.setPeers([peer({ emote })]);
    const bursts = () =>
      [...container.querySelectorAll("span")].filter((s) => s.textContent === "🎉");
    expect(bursts()).toHaveLength(0);
    layer.setPeers([peer({ emote: { ...emote, at: 2 } })]);
    expect(bursts()).toHaveLength(1);
  });

  it("shows and clears the follow banner", () => {
    const { container, layer } = setup();
    const onStop = vi.fn();
    layer.setFollowBanner({ label: "Ada", color: "#e11d48", spotlight: false, onStop });
    expect(container.textContent).toContain("Following Ada");
    container.querySelector<HTMLButtonElement>('button[aria-label="Stop following Ada"]')!.click();
    expect(onStop).toHaveBeenCalled();
    layer.setFollowBanner(null);
    expect(container.querySelector<HTMLElement>('[role="status"]')!.style.display).toBe("none");
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Viewport } from "@wafflebase/board";
import {
  createFollowController,
  createSpotlightTracker,
  lerpPeerViewport,
  peerViewportOf,
  viewportFromPeer,
} from "./board-follow";

const host = { w: 800, h: 600 };

describe("peer viewport mapping", () => {
  it("round-trips a viewport through centre + zoom", () => {
    const vp: Viewport = { panX: 120, panY: -40, zoom: 2 };
    expect(viewportFromPeer(peerViewportOf(vp, host), host)).toEqual(vp);
  });

  it("frames the same centre on a different window size", () => {
    const pv = peerViewportOf({ panX: 0, panY: 0, zoom: 1 }, host); // centre (400,300)
    const small = viewportFromPeer(pv, { w: 400, h: 300 });
    // The world centre lands at the small host's centre.
    expect(400 * small.zoom + small.panX).toBe(200);
    expect(300 * small.zoom + small.panY).toBe(150);
  });

  it("interpolates zoom geometrically", () => {
    const mid = lerpPeerViewport({ x: 0, y: 0, zoom: 1 }, { x: 10, y: 0, zoom: 4 }, 0.5);
    expect(mid.x).toBe(5);
    expect(mid.zoom).toBeCloseTo(2);
  });
});

function setupFollow(reducedMotion = false) {
  let vp: Viewport = { panX: 0, panY: 0, zoom: 1 };
  const frames: ((t: number) => void)[] = [];
  const commit = vi.fn((next: Viewport) => {
    vp = next;
    ctl.notifyCommitted();
  });
  const ctl = createFollowController({
    getViewport: () => vp,
    getHost: () => host,
    commit,
    requestFrame: (cb) => frames.push(cb),
    cancelFrame: () => undefined,
    reducedMotion: () => reducedMotion,
  });
  const flush = (n = 200) => {
    let t = 0;
    for (let i = 0; i < n && frames.length; i++) {
      t += 16;
      frames.shift()!(t);
    }
  };
  return { ctl, commit, flush, getVp: () => vp };
}

describe("createFollowController", () => {
  it("glides to the followed peer's framing and lands exactly", () => {
    const { ctl, flush, getVp } = setupFollow();
    ctl.follow("p1", "manual");
    ctl.setPeerViewport("p1", { x: 1000, y: 500, zoom: 2 });
    flush();
    expect(getVp()).toEqual(viewportFromPeer({ x: 1000, y: 500, zoom: 2 }, host));
    expect(ctl.target()).toEqual({ clientID: "p1", reason: "manual" });
  });

  it("jumps in one frame under reduced motion, never synchronously", () => {
    const { ctl, commit, flush } = setupFollow(true);
    ctl.follow("p1", "manual");
    ctl.setPeerViewport("p1", { x: 10, y: 10, zoom: 1 });
    expect(commit).not.toHaveBeenCalled();
    flush();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("stops when the user moves the viewport themselves", () => {
    const { ctl, flush } = setupFollow(true);
    const onChange = vi.fn();
    ctl.subscribe(onChange);
    ctl.follow("p1", "manual");
    ctl.setPeerViewport("p1", { x: 10, y: 10, zoom: 1 });
    flush();
    expect(ctl.target()).not.toBeNull();
    // A commit the controller did not make (wheel, pan, zoom key).
    ctl.notifyCommitted();
    expect(ctl.target()).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("ignores framings from peers it is not following", () => {
    const { ctl, commit, flush } = setupFollow(true);
    ctl.follow("p1", "manual");
    ctl.setPeerViewport("p2", { x: 10, y: 10, zoom: 1 });
    flush();
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("createSpotlightTracker", () => {
  it("starts following a peer who spotlights, once per token", () => {
    const t = createSpotlightTracker();
    expect(t.update([{ clientID: "a", spotlight: 5 }], null)).toEqual({ start: "a", stop: false });
    expect(t.update([{ clientID: "a", spotlight: 5 }], { clientID: "a", reason: "spotlight" }).start).toBeUndefined();
  });

  it("stops a spotlight follow when the peer ends it or leaves", () => {
    const t = createSpotlightTracker();
    t.update([{ clientID: "a", spotlight: 5 }], null);
    const following = { clientID: "a", reason: "spotlight" as const };
    expect(t.update([{ clientID: "a", spotlight: null }], following).stop).toBe(true);
    t.update([{ clientID: "a", spotlight: 6 }], null);
    expect(t.update([], following).stop).toBe(true);
  });

  it("does not re-follow a dismissed spotlight until the peer spotlights again", () => {
    const t = createSpotlightTracker();
    t.update([{ clientID: "a", spotlight: 5 }], null);
    t.dismiss("a");
    expect(t.update([{ clientID: "a", spotlight: 5 }], null).start).toBeUndefined();
    expect(t.update([{ clientID: "a", spotlight: 9 }], null).start).toBe("a");
  });

  it("never overrides a manual follow", () => {
    const t = createSpotlightTracker();
    expect(
      t.update([{ clientID: "a", spotlight: 5 }], { clientID: "b", reason: "manual" }).start,
    ).toBeUndefined();
  });
});

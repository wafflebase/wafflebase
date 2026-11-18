import type { Viewport } from "@wafflebase/board";

/**
 * Follow a peer's viewport, and Spotlight (a peer asks everyone to
 * follow them).
 *
 * A peer publishes `presence.viewport` = the WORLD point at the centre of
 * their canvas plus their zoom. Centre + zoom rather than pan, because a
 * pan only means something for one window size: a follower with a smaller
 * window frames the same centre at the same zoom.
 */

export interface PeerViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface HostSize {
  w: number;
  h: number;
}

/** The centre + zoom a local viewport shows on a host of `host` size. */
export function peerViewportOf(vp: Viewport, host: HostSize): PeerViewport {
  return {
    x: (host.w / 2 - vp.panX) / vp.zoom,
    y: (host.h / 2 - vp.panY) / vp.zoom,
    zoom: vp.zoom,
  };
}

/** The local viewport that frames a peer's centre + zoom. */
export function viewportFromPeer(pv: PeerViewport, host: HostSize): Viewport {
  return {
    zoom: pv.zoom,
    panX: host.w / 2 - pv.x * pv.zoom,
    panY: host.h / 2 - pv.y * pv.zoom,
  };
}

/**
 * Interpolate two framings by `t` ∈ [0, 1]: the centre linearly in world
 * space, the zoom geometrically (so 1→4 passes 2, not 2.5).
 */
export function lerpPeerViewport(
  a: PeerViewport,
  b: PeerViewport,
  t: number,
): PeerViewport {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    zoom: Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * t),
  };
}

export function isValidPeerViewport(v: unknown): v is PeerViewport {
  if (!v || typeof v !== "object") return false;
  const p = v as PeerViewport;
  return (
    Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.zoom) && p.zoom > 0
  );
}

export type FollowReason = "manual" | "spotlight";

export interface FollowTarget {
  clientID: string;
  reason: FollowReason;
}

export interface FollowControllerDeps {
  getViewport: () => Viewport;
  getHost: () => HostSize;
  /** Commit a viewport through the board's single chokepoint. */
  commit: (vp: Viewport) => void;
  requestFrame: (cb: (time: number) => void) => number;
  cancelFrame: (handle: number) => void;
  /** Jump instead of gliding. */
  reducedMotion?: () => boolean;
}

export interface FollowController {
  target(): FollowTarget | null;
  /** Start following; the first framing is applied as soon as one is known. */
  follow(clientID: string, reason: FollowReason): void;
  stop(): void;
  /** Feed the followed peer's latest framing (null: they have none). */
  setPeerViewport(clientID: string, pv: PeerViewport | null): void;
  /**
   * Call from the viewport chokepoint after every commit. A commit this
   * controller did not make is the user taking the wheel, so it stops.
   */
  notifyCommitted(): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** Glide rate: the remaining distance shrinks by e^(−rate·dt). */
const GLIDE_RATE = 14;

export function createFollowController(deps: FollowControllerDeps): FollowController {
  let current: FollowTarget | null = null;
  let goal: PeerViewport | null = null;
  let applying = false;
  let raf: number | null = null;
  let lastTime: number | null = null;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const l of listeners) l();
  };

  const apply = (pv: PeerViewport) => {
    applying = true;
    try {
      deps.commit(viewportFromPeer(pv, deps.getHost()));
    } finally {
      applying = false;
    }
  };

  const cancel = () => {
    if (raf !== null) deps.cancelFrame(raf);
    raf = null;
    lastTime = null;
  };

  const frame = (time: number) => {
    raf = null;
    if (!current || !goal) return;
    if (deps.reducedMotion?.()) {
      apply(goal);
      return;
    }
    const dt = lastTime === null ? 1 / 60 : Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    const host = deps.getHost();
    const here = peerViewportOf(deps.getViewport(), host);
    const t = 1 - Math.exp(-GLIDE_RATE * Math.max(dt, 0));
    const next = lerpPeerViewport(here, goal, t);
    const closeEnough =
      Math.hypot(goal.x - next.x, goal.y - next.y) * goal.zoom < 0.5 &&
      Math.abs(Math.log(goal.zoom / next.zoom)) < 0.002;
    if (closeEnough) {
      apply(goal);
      lastTime = null;
      return;
    }
    apply(next);
    raf = deps.requestFrame(frame);
  };

  // Always on the next frame, even when jumping: a framing usually
  // arrives inside a Yorkie `others` callback, and committing there would
  // publish this client's own viewport from inside that callback.
  const glide = () => {
    if (!goal) return;
    if (raf === null) raf = deps.requestFrame(frame);
  };

  return {
    target: () => current,
    follow(clientID, reason) {
      if (current?.clientID === clientID && current.reason === reason) return;
      if (current?.clientID !== clientID) goal = null;
      current = { clientID, reason };
      emit();
      glide();
    },
    stop() {
      if (!current) return;
      current = null;
      goal = null;
      cancel();
      emit();
    },
    setPeerViewport(clientID, pv) {
      if (!current || current.clientID !== clientID || !pv) return;
      goal = pv;
      glide();
    },
    notifyCommitted() {
      if (applying || !current) return;
      this.stop();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      cancel();
      listeners.clear();
      current = null;
    },
  };
}

/**
 * Spotlight bookkeeping. A peer spotlights by putting a token (the epoch
 * ms they started) in `presence.spotlight`; every other client follows
 * them automatically — unless it dismissed THAT token, so a dismissal
 * sticks until the peer spotlights again. A manual follow is never
 * overridden by a spotlight.
 */
export interface SpotlightTracker {
  update(
    peers: readonly { clientID: string; spotlight: number | null }[],
    current: FollowTarget | null,
  ): { start?: string; stop?: boolean };
  /** The user stopped following `clientID`'s current spotlight. */
  dismiss(clientID: string): void;
}

export function createSpotlightTracker(): SpotlightTracker {
  const seen = new Map<string, number | null>();
  const dismissed = new Map<string, number>();
  return {
    update(peers, current) {
      let start: string | undefined;
      const present = new Set<string>();
      for (const { clientID, spotlight } of peers) {
        present.add(clientID);
        const token = spotlight ?? null;
        const prev = seen.has(clientID) ? seen.get(clientID) : undefined;
        seen.set(clientID, token);
        if (token === null || token === prev) continue;
        if (dismissed.get(clientID) === token) continue;
        if (current && current.reason === "manual") continue;
        start = clientID;
      }
      for (const id of [...seen.keys()]) if (!present.has(id)) seen.delete(id);
      let stop = false;
      if (current?.reason === "spotlight" && start === undefined) {
        const token = seen.get(current.clientID);
        stop = token === undefined || token === null;
      }
      return { start, stop };
    },
    dismiss(clientID) {
      const token = seen.get(clientID);
      if (typeof token === "number") dismissed.set(clientID, token);
    },
  };
}

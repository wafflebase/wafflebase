import type { Viewport } from "@wafflebase/board";
import { readableTextColor } from "@wafflebase/core/tokens";
import {
  isSettled,
  springAt,
  stepSpring,
  type SpringState,
} from "./board-cursor-spring";

/**
 * The board's peer layer (peer cursors v2): a DOM layer over the canvas
 * that draws each collaborator's cursor, name tag and cursor chat, an
 * edge indicator for a collaborator who is off-screen, emote bursts, and
 * the "Following …" banner.
 *
 * Board-local by design. The slides overlay's `renderPeerCursors` wipes
 * its layer and rebuilds a 10 px dot per update, which is right for a
 * slide but makes a cursor teleport at network rate. Here every peer
 * keeps ONE set of DOM nodes, keyed by client id, moved by writing
 * `transform` from a spring integrated on rAF (see
 * `board-cursor-spring.ts`); the loop stops once every cursor has settled.
 */

export interface BoardPeerInput {
  clientID: string;
  color: string;
  label: string;
  /** World coordinates, or null when the pointer is off the canvas. */
  cursor: { x: number; y: number } | null;
  chat: string | null;
  emote: { emoji: string; x: number; y: number; at: number } | null;
  /** The peer is drawing (a live stroke in presence): show a pen, not the arrow. */
  drawing?: boolean;
}

export interface BoardPeerLayerDeps {
  container: HTMLElement;
  getViewport: () => Viewport;
  getHost: () => { w: number; h: number };
  /** An edge indicator was clicked. */
  onJump: (clientID: string) => void;
  requestFrame?: (cb: (time: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  reducedMotion?: () => boolean;
}

export interface FollowBanner {
  label: string;
  color: string;
  spotlight: boolean;
  onStop: () => void;
}

export interface BoardPeerLayer {
  element: HTMLElement;
  setPeers(peers: readonly BoardPeerInput[]): void;
  /** The local viewport changed: reposition without advancing the springs. */
  refresh(): void;
  /** Play an emote burst at a world point (the local user's own emote). */
  burst(emoji: string, world: { x: number; y: number }): void;
  setFollowBanner(banner: FollowBanner | null): void;
  dispose(): void;
}

/** Distance from the canvas edge at which an edge indicator sits. */
const EDGE_INSET = 18;
export const EMOTE_DURATION_MS = 1500;

/**
 * Where to draw the edge indicator for a cursor at `screen`, or null when
 * the cursor is on-screen. The indicator is clamped into the inset
 * rectangle and points (`angle`, radians) from itself toward the cursor.
 */
export function edgePlacement(
  screen: { x: number; y: number },
  host: { w: number; h: number },
  inset = EDGE_INSET,
): { x: number; y: number; angle: number } | null {
  if (screen.x >= 0 && screen.x <= host.w && screen.y >= 0 && screen.y <= host.h) {
    return null;
  }
  const x = Math.min(Math.max(screen.x, inset), Math.max(inset, host.w - inset));
  const y = Math.min(Math.max(screen.y, inset), Math.max(inset, host.h - inset));
  return { x, y, angle: Math.atan2(screen.y - y, screen.x - x) };
}

export function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const SVG_NS = "http://www.w3.org/2000/svg";

function arrowSvg(color: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "22");
  svg.setAttribute("viewBox", "0 0 18 22");
  svg.setAttribute("aria-hidden", "true");
  svg.style.display = "block";
  svg.style.overflow = "visible";
  const path = document.createElementNS(SVG_NS, "path");
  // Tip at (1, 1): the element's origin is the pointer's hot spot.
  path.setAttribute("d", "M1 1 L1 17 L5.5 13 L8.5 20 L11.5 18.7 L8.6 12 L14.5 12 Z");
  path.setAttribute("fill", color);
  path.setAttribute("stroke", "#fff");
  path.setAttribute("stroke-width", "1.5");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

/** A pen nib whose tip sits at the pointer's hot spot, like the arrow's. */
function penSvg(color: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "display:none;overflow:visible;position:absolute;left:0;top:0";
  const path = document.createElementNS(SVG_NS, "path");
  // Tip at (1, 1), body running down-right.
  path.setAttribute("d", "M1 1 L3.5 8.5 L14.5 19.5 L19.5 14.5 L8.5 3.5 Z");
  path.setAttribute("fill", color);
  path.setAttribute("stroke", "#fff");
  path.setAttribute("stroke-width", "1.5");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

interface Entry {
  clientID: string;
  color: string;
  label: string;
  spring: SpringState | null;
  target: { x: number; y: number } | null;
  root: HTMLDivElement;
  arrow: SVGSVGElement;
  pen: SVGSVGElement;
  tag: HTMLDivElement;
  chat: HTMLDivElement;
  edge: HTMLButtonElement;
  edgeArrow: HTMLDivElement;
  edgeLabel: HTMLSpanElement;
  lastEmoteAt: number | null;
}

export function createBoardPeerLayer(deps: BoardPeerLayerDeps): BoardPeerLayer {
  const requestFrame = deps.requestFrame ?? ((cb) => requestAnimationFrame(cb));
  const cancelFrame = deps.cancelFrame ?? ((h) => cancelAnimationFrame(h));
  const reduced = deps.reducedMotion ?? (() => false);

  const layer = document.createElement("div");
  layer.dataset.boardPeerLayer = "";
  layer.style.cssText =
    "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:4";
  deps.container.appendChild(layer);

  const banner = document.createElement("div");
  banner.setAttribute("role", "status");
  banner.style.cssText = [
    "position:absolute", "top:10px", "left:50%", "transform:translateX(-50%)",
    "display:none", "align-items:center", "gap:8px", "padding:4px 6px 4px 12px",
    "border-radius:999px", "font:500 12px/18px system-ui,-apple-system,sans-serif",
    "box-shadow:0 2px 8px rgb(0 0 0 / 0.18)", "pointer-events:auto", "white-space:nowrap",
  ].join(";");
  const bannerText = document.createElement("span");
  const bannerStop = document.createElement("button");
  bannerStop.type = "button";
  bannerStop.textContent = "Stop";
  bannerStop.style.cssText = [
    "font:inherit", "padding:0 8px", "border-radius:999px", "border:0",
    "background:rgb(255 255 255 / 0.25)", "color:inherit", "cursor:pointer",
    "min-height:22px",
  ].join(";");
  banner.append(bannerText, bannerStop);
  layer.appendChild(banner);
  let bannerStopHandler: (() => void) | null = null;
  bannerStop.addEventListener("click", () => bannerStopHandler?.());

  const entries = new Map<string, Entry>();
  let raf: number | null = null;
  let lastTime: number | null = null;
  let disposed = false;

  const makeEntry = (peer: BoardPeerInput): Entry => {
    const root = document.createElement("div");
    root.dataset.peerCursor = peer.clientID;
    root.style.cssText =
      "position:absolute;left:0;top:0;will-change:transform;display:none";
    const arrow = arrowSvg(peer.color);
    const pen = penSvg(peer.color);
    const tag = document.createElement("div");
    tag.style.cssText = [
      "position:absolute", "left:14px", "top:18px", "padding:1px 6px",
      "border-radius:3px", "font:11px/1.4 system-ui,-apple-system,sans-serif",
      "white-space:nowrap", "max-width:160px", "overflow:hidden", "text-overflow:ellipsis",
    ].join(";");
    const chat = document.createElement("div");
    chat.style.cssText = [
      "position:absolute", "left:14px", "top:38px", "padding:4px 10px",
      "border-radius:4px 12px 12px 12px", "font:13px/1.35 system-ui,-apple-system,sans-serif",
      "max-width:240px", "width:max-content", "white-space:pre-wrap",
      "overflow-wrap:anywhere", "display:none", "box-shadow:0 1px 4px rgb(0 0 0 / 0.2)",
    ].join(";");
    root.append(arrow, pen, tag, chat);

    const edge = document.createElement("button");
    edge.type = "button";
    edge.style.cssText = [
      "position:absolute", "left:0", "top:0", "width:28px", "height:28px",
      "margin:-14px 0 0 -14px", "border-radius:50%", "border:2px solid #fff",
      "display:none", "align-items:center", "justify-content:center",
      "font:600 10px/1 system-ui,-apple-system,sans-serif", "cursor:pointer",
      "pointer-events:auto", "box-shadow:0 1px 4px rgb(0 0 0 / 0.25)", "padding:0",
    ].join(";");
    const edgeArrow = document.createElement("div");
    edgeArrow.style.cssText = [
      "position:absolute", "left:50%", "top:50%", "width:0", "height:0",
      "border-top:5px solid transparent", "border-bottom:5px solid transparent",
      "border-left:7px solid", "margin:-5px 0 0 15px", "transform-origin:-15px 5px",
    ].join(";");
    const edgeLabel = document.createElement("span");
    edge.append(edgeLabel, edgeArrow);
    edge.addEventListener("click", (e) => {
      e.stopPropagation();
      deps.onJump(peer.clientID);
    });
    edge.addEventListener("pointerdown", (e) => e.stopPropagation());
    // Do not take focus: the slides editor ignores shortcuts while a
    // button is focused.
    edge.addEventListener("mousedown", (e) => e.preventDefault());

    layer.insertBefore(root, banner);
    layer.insertBefore(edge, banner);
    const entry: Entry = {
      clientID: peer.clientID, color: "", label: "", spring: null, target: null,
      root, arrow, pen, tag, chat, edge, edgeArrow, edgeLabel, lastEmoteAt: null,
    };
    return entry;
  };

  const style = (entry: Entry, peer: BoardPeerInput) => {
    if (entry.color !== peer.color) {
      entry.color = peer.color;
      const text = readableTextColor(peer.color);
      entry.arrow.querySelector("path")?.setAttribute("fill", peer.color);
      entry.pen.querySelector("path")?.setAttribute("fill", peer.color);
      entry.tag.style.background = peer.color;
      entry.tag.style.color = text;
      entry.chat.style.background = peer.color;
      entry.chat.style.color = text;
      entry.edge.style.background = peer.color;
      entry.edge.style.color = text;
      entry.edgeArrow.style.borderLeftColor = peer.color;
    }
    if (entry.label !== peer.label) {
      entry.label = peer.label;
      entry.tag.textContent = peer.label;
      entry.edgeLabel.textContent = initials(peer.label);
      entry.edge.setAttribute("aria-label", `Jump to ${peer.label}`);
      entry.edge.title = `Jump to ${peer.label}`;
    }
    entry.arrow.style.display = peer.drawing ? "none" : "block";
    entry.pen.style.display = peer.drawing ? "block" : "none";
    const chat = peer.chat && peer.chat.trim() ? peer.chat : null;
    entry.chat.textContent = chat ?? "";
    entry.chat.style.display = chat ? "block" : "none";
  };

  const position = (entry: Entry) => {
    if (!entry.spring) {
      entry.root.style.display = "none";
      entry.edge.style.display = "none";
      return;
    }
    const vp = deps.getViewport();
    const sx = entry.spring.x * vp.zoom + vp.panX;
    const sy = entry.spring.y * vp.zoom + vp.panY;
    const edge = edgePlacement({ x: sx, y: sy }, deps.getHost());
    if (!edge) {
      entry.root.style.display = "block";
      entry.root.style.transform = `translate(${sx - 1}px, ${sy - 1}px)`;
      entry.edge.style.display = "none";
      return;
    }
    entry.root.style.display = "none";
    entry.edge.style.display = "flex";
    entry.edge.style.transform = `translate(${edge.x}px, ${edge.y}px)`;
    entry.edgeArrow.style.transform = `rotate(${edge.angle}rad)`;
  };

  const tolerance = () => 0.25 / Math.max(deps.getViewport().zoom, 0.01);

  const frame = (time: number) => {
    raf = null;
    if (disposed) return;
    const dt = lastTime === null ? 1 / 60 : (time - lastTime) / 1000;
    lastTime = time;
    let moving = false;
    const tol = tolerance();
    for (const entry of entries.values()) {
      if (!entry.spring || !entry.target) continue;
      if (reduced()) {
        entry.spring = springAt(entry.target);
      } else {
        entry.spring = stepSpring(entry.spring, entry.target, dt);
        if (isSettled(entry.spring, entry.target, tol)) {
          entry.spring = springAt(entry.target);
        } else {
          moving = true;
        }
      }
      position(entry);
    }
    if (moving) raf = requestFrame(frame);
    else lastTime = null;
  };

  const kick = () => {
    if (raf === null && !disposed) raf = requestFrame(frame);
  };

  const spawnBurst = (emoji: string, world: { x: number; y: number }) => {
    const vp = deps.getViewport();
    const el = document.createElement("span");
    el.textContent = emoji;
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = [
      "position:absolute", `left:${world.x * vp.zoom + vp.panX}px`,
      `top:${world.y * vp.zoom + vp.panY}px`, "font-size:30px", "line-height:1",
      "transform:translate(-50%,-50%)", "pointer-events:none", "user-select:none",
    ].join(";");
    layer.insertBefore(el, banner);
    const keyframes: Keyframe[] = reduced()
      ? [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }]
      : [
          { transform: "translate(-50%,-50%) scale(0.5)", opacity: 0 },
          { transform: "translate(-50%,-70%) scale(1.15)", opacity: 1, offset: 0.15 },
          { transform: "translate(-50%,-260%) scale(1)", opacity: 0 },
        ];
    if (typeof el.animate === "function") {
      el.animate(keyframes, { duration: EMOTE_DURATION_MS, easing: "ease-out", fill: "forwards" });
    }
    setTimeout(() => el.remove(), EMOTE_DURATION_MS);
  };

  return {
    element: layer,
    setPeers(peers) {
      if (disposed) return;
      const seen = new Set<string>();
      for (const peer of peers) {
        seen.add(peer.clientID);
        let entry = entries.get(peer.clientID);
        const isNew = !entry;
        if (!entry) {
          entry = makeEntry(peer);
          entries.set(peer.clientID, entry);
        }
        style(entry, peer);
        if (peer.cursor) {
          entry.target = { x: peer.cursor.x, y: peer.cursor.y };
          // A cursor that (re)appears snaps where it is rather than
          // flying in from wherever it was last seen.
          if (!entry.spring) entry.spring = springAt(entry.target);
        } else {
          entry.target = null;
          entry.spring = null;
        }
        position(entry);
        // An emote already in presence when we first see the peer is old
        // news, not a burst to replay.
        const at = peer.emote?.at ?? null;
        if (!isNew && at !== null && at !== entry.lastEmoteAt && peer.emote) {
          spawnBurst(peer.emote.emoji, peer.emote);
        }
        entry.lastEmoteAt = at;
      }
      for (const [id, entry] of entries) {
        if (seen.has(id)) continue;
        entry.root.remove();
        entry.edge.remove();
        entries.delete(id);
      }
      kick();
    },
    refresh() {
      for (const entry of entries.values()) position(entry);
    },
    burst(emoji, world) {
      if (!disposed) spawnBurst(emoji, world);
    },
    setFollowBanner(next) {
      if (!next) {
        banner.style.display = "none";
        layer.style.boxShadow = "";
        bannerStopHandler = null;
        return;
      }
      banner.style.display = "flex";
      banner.style.background = next.color;
      banner.style.color = readableTextColor(next.color);
      bannerText.textContent = next.spotlight
        ? `${next.label} is spotlighting — following. Esc to stop`
        : `Following ${next.label} — Esc to stop`;
      bannerStop.setAttribute("aria-label", `Stop following ${next.label}`);
      layer.style.boxShadow = `inset 0 0 0 3px ${next.color}`;
      bannerStopHandler = next.onStop;
    },
    dispose() {
      disposed = true;
      if (raf !== null) cancelFrame(raf);
      raf = null;
      entries.clear();
      layer.remove();
    },
  };
}

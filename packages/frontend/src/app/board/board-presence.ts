import { screenToWorld, type Viewport } from "@wafflebase/board";
import { getPeerCursorColor } from "@wafflebase/sheets";
import type { BoardPresence } from "@/types/board-document";
import {
  createCursorPublisher,
  createThrottledPublisher,
  type ThrottledPublisher,
} from "./board-cursor-publish";
import {
  createFollowController,
  createSpotlightTracker,
  isValidPeerViewport,
  peerViewportOf,
  type FollowController,
  type PeerViewport,
} from "./board-follow";
import { createBoardPeerLayer, type BoardPeerInput } from "./board-peer-layer";
import { createCursorChat } from "./board-cursor-chat";
import { BOARD_EMOTES, createEmotePicker } from "./board-emotes";
import { isTextEntryTarget } from "./board-shortcuts";
import { centerViewportOnWorld } from "./minimap-geometry";
import { isLiveStroke } from "./board-live-ink";

/**
 * The board's presence features, wired in one place so `BoardView` only
 * calls {@link attachBoardPresence} and forwards viewport commits:
 *
 * - peer cursors v2 (throttled send, spring render, edge indicators,
 *   minimap dots);
 * - follow a peer's viewport, and Spotlight;
 * - cursor chat (`/`) and emotes (`E`).
 *
 * Every presence WRITE goes through `store.updatePresence` (never a raw
 * `doc.update`, see `YorkieBoardStore.activePresence`), none happens on a
 * read-only mount, and the continuous ones (cursor, viewport, chat) are
 * gated on there being someone to see them. Reads come straight off the
 * Yorkie document, like the rest of `BoardView`.
 */

/** The slice of the Yorkie document this module reads. */
export interface PresenceDoc {
  getOthersPresences(): { clientID: string | number; presence: unknown }[];
  getMyPresence(): unknown;
  subscribe(type: "others", cb: () => void): () => void;
}

export interface BoardPresenceDeps {
  container: HTMLElement;
  doc: PresenceDoc;
  store: { updatePresence(p: Partial<BoardPresence>): void };
  readOnly: boolean;
  editor: {
    isTextEditing(): boolean;
    isCropping(): boolean;
    getSelection(): readonly string[];
  };
  getViewport: () => Viewport;
  getHost: () => { w: number; h: number };
  /** The canvas's client rect (cached by the host). */
  getCanvasRect: () => { left: number; top: number };
  commitViewport: (vp: Viewport) => void;
  /** Whether a key's target belongs to the board (see `handleBoardToolKey`). */
  isBoardTarget: (target: EventTarget | null) => boolean;
  theme: "light" | "dark";
  /** Peers as minimap dots. */
  minimap?: { setPeers(dots: { x: number; y: number; color: string }[]): void };
}

export interface BoardPresenceController {
  /** Call from the viewport chokepoint after every commit. */
  onViewportCommitted(): void;
  /** Header avatar click: follow the peer's view, or jump to their cursor. */
  selectPeer(clientID: string): void;
  /** What a header avatar click would do, or undefined if nothing. */
  jumpHint(clientID: string): string | undefined;
  isSpotlighting(): boolean;
  setSpotlight(on: boolean): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** What a board-presence keystroke asks for, or null. */
export type PresenceKeyAction = "chat" | "emote" | null;

/**
 * `/` opens cursor chat and `E` the emote picker — FigJam's keys. Like the
 * board's tool keys they need an editable board with NOTHING selected, so
 * Google type-to-edit on a selection keeps winning, and nothing aimed at a
 * field, menu or dialog. `/` may carry Shift (layouts that shift it).
 */
export function presenceKeyAction(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat" | "target" | "defaultPrevented">,
  ctx: {
    readOnly: boolean;
    isBoardTarget: (target: EventTarget | null) => boolean;
    editor: BoardPresenceDeps["editor"];
  },
): PresenceKeyAction {
  if (e.defaultPrevented || e.repeat || ctx.readOnly) return null;
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (!ctx.isBoardTarget(e.target) || isTextEntryTarget(e.target)) return null;
  if (ctx.editor.isTextEditing() || ctx.editor.isCropping()) return null;
  if (ctx.editor.getSelection().length > 0) return null;
  if (e.key === "/") return "chat";
  if (!e.shiftKey && (e.key === "e" || e.key === "E")) return "emote";
  return null;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const sameViewport = (a: PeerViewport | null, b: PeerViewport | null) =>
  a === null || b === null
    ? a === b
    : a.x === b.x && a.y === b.y && a.zoom === b.zoom;

export function attachBoardPresence(deps: BoardPresenceDeps): BoardPresenceController {
  const { container, doc, store, readOnly } = deps;
  const timers = {
    now: () => performance.now(),
    setTimer: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimer: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const hasAudience = () => doc.getOthersPresences().length > 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const readPeers = () =>
    doc.getOthersPresences().map((p) => ({
      clientID: String(p.clientID),
      presence: (p.presence ?? {}) as Partial<BoardPresence>,
    }));
  const colorOf = (clientID: string) => getPeerCursorColor(deps.theme, clientID);
  const labelOf = (p: Partial<BoardPresence>) => p.username || "Anonymous";

  // --- rendering ---------------------------------------------------------
  let follow: FollowController | null = null;
  const jumpToCursor = (clientID: string) => {
    const peer = readPeers().find((p) => p.clientID === clientID);
    const cursor = peer?.presence.cursor;
    if (!cursor) return;
    deps.commitViewport(centerViewportOnWorld(deps.getViewport(), cursor, deps.getHost()));
  };
  const layer = createBoardPeerLayer({
    container,
    getViewport: deps.getViewport,
    getHost: deps.getHost,
    onJump: jumpToCursor,
    reducedMotion: prefersReducedMotion,
  });

  // --- follow / spotlight ------------------------------------------------
  follow = createFollowController({
    getViewport: deps.getViewport,
    getHost: deps.getHost,
    commit: deps.commitViewport,
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (h) => cancelAnimationFrame(h),
    reducedMotion: prefersReducedMotion,
  });
  const spotlights = createSpotlightTracker();
  let prevTarget = follow.target();
  const offFollow = follow.subscribe(() => {
    const target = follow!.target();
    // A spotlight follow the user ended stays ended until that peer
    // spotlights again (a no-op when the peer ended it themselves).
    if (!target && prevTarget?.reason === "spotlight") spotlights.dismiss(prevTarget.clientID);
    prevTarget = target;
    if (!target) {
      layer.setFollowBanner(null);
    } else {
      const peer = readPeers().find((p) => p.clientID === target.clientID);
      layer.setFollowBanner({
        label: peer ? labelOf(peer.presence) : "a collaborator",
        color: colorOf(target.clientID),
        spotlight: target.reason === "spotlight",
        onStop: () => follow!.stop(),
      });
      const pv = peer?.presence.viewport;
      if (isValidPeerViewport(pv)) follow!.setPeerViewport(target.clientID, pv);
    }
    emit();
  });

  // --- publishers (editable mounts only) ----------------------------------
  let lastScreen: { x: number; y: number } | null = null;
  const toWorld = (p: { x: number; y: number }) => screenToWorld(deps.getViewport(), p);

  const cursorPub = readOnly
    ? null
    : createCursorPublisher({
        ...timers,
        shouldPublish: hasAudience,
        // Two screen pixels, in world units at the current zoom.
        deadBand: () => 2 / Math.max(deps.getViewport().zoom, 0.01),
        publish: (cursor) => store.updatePresence({ cursor }),
      });
  const viewportPub: ThrottledPublisher<PeerViewport | null> | null = readOnly
    ? null
    : createThrottledPublisher<PeerViewport | null>({
        ...timers,
        intervalMs: 100,
        restMs: 150,
        equals: sameViewport,
        shouldPublish: hasAudience,
        publish: (viewport) => store.updatePresence({ viewport }),
      });
  const chatPub: ThrottledPublisher<string | null> | null = readOnly
    ? null
    : createThrottledPublisher<string | null>({
        ...timers,
        intervalMs: 80,
        restMs: 80,
        equals: (a, b) => a === b,
        shouldPublish: hasAudience,
        publish: (chat) => store.updatePresence({ chat }),
      });
  const publishViewport = () =>
    viewportPub?.queue(peerViewportOf(deps.getViewport(), deps.getHost()));
  publishViewport();

  const chat = readOnly
    ? null
    : createCursorChat({ container, publish: (text) => chatPub?.queue(text) });

  let lastEmoteAt = 0;
  const emotes = readOnly
    ? null
    : createEmotePicker({
        container,
        onPick: (emoji, at) => {
          const world = toWorld(at);
          layer.burst(emoji, world);
          if (!hasAudience()) return;
          lastEmoteAt = Math.max(Date.now(), lastEmoteAt + 1);
          store.updatePresence({ emote: { emoji, x: world.x, y: world.y, at: lastEmoteAt } });
        },
      });

  const localPoint = () => {
    if (lastScreen) return lastScreen;
    const host = deps.getHost();
    return { x: host.w / 2, y: host.h / 2 };
  };

  const onPointerMove = (e: PointerEvent) => {
    const rect = deps.getCanvasRect();
    lastScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    cursorPub?.queue(toWorld(lastScreen));
    chat?.moveTo(lastScreen);
  };
  // Clear on leave so a departed cursor does not stick on peers' screens.
  const onPointerLeave = () => {
    lastScreen = null;
    cursorPub?.queue(null);
  };
  if (!readOnly) {
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerleave", onPointerLeave);
  }

  // --- spotlight (local) ---------------------------------------------------
  const mine = (doc.getMyPresence() ?? {}) as Partial<BoardPresence>;
  let spotlightToken: number | null =
    typeof mine.spotlight === "number" ? mine.spotlight : null;

  // --- peers --------------------------------------------------------------
  let hadPeers = false;
  const pushPeers = () => {
    const peers = readPeers();
    const inputs: BoardPeerInput[] = peers.map(({ clientID, presence }) => ({
      clientID,
      color: colorOf(clientID),
      label: labelOf(presence),
      cursor: presence.cursor ?? null,
      chat: typeof presence.chat === "string" ? presence.chat : null,
      emote: presence.emote ?? null,
      // A pen glyph replaces the arrow while the peer draws.
      drawing: isLiveStroke(presence.stroke),
    }));
    layer.setPeers(inputs);
    deps.minimap?.setPeers(
      peers.flatMap(({ clientID, presence }) => {
        const at =
          presence.cursor ??
          (isValidPeerViewport(presence.viewport) ? presence.viewport : null);
        return at ? [{ x: at.x, y: at.y, color: colorOf(clientID) }] : [];
      }),
    );

    const target = follow!.target();
    const decision = spotlights.update(
      peers.map(({ clientID, presence }) => ({
        clientID,
        spotlight: typeof presence.spotlight === "number" ? presence.spotlight : null,
      })),
      target,
    );
    if (decision.start) follow!.follow(decision.start, "spotlight");
    else if (decision.stop) follow!.stop();
    const now = follow!.target();
    if (now) {
      const peer = peers.find((p) => p.clientID === now.clientID);
      if (!peer) follow!.stop();
      else if (isValidPeerViewport(peer.presence.viewport)) {
        follow!.setPeerViewport(now.clientID, peer.presence.viewport);
      }
    }

    // The audience just opened: deliver what the gates swallowed while
    // nobody was watching.
    const hasPeers = peers.length > 0;
    if (hasPeers && !hadPeers) {
      cursorPub?.resend();
      viewportPub?.resend();
      chatPub?.resend();
    }
    hadPeers = hasPeers;
    emit();
  };
  const offPeers = doc.subscribe("others", pushPeers);
  pushPeers();

  // --- keys -----------------------------------------------------------------
  const consume = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (emotes?.isOpen()) {
        emotes.close();
        consume(e);
        return;
      }
      // Not consumed: the editor's own Esc (clear insert mode, deselect)
      // still runs, as it would without a follow.
      if (follow!.target() && !isTextEntryTarget(e.target)) follow!.stop();
      return;
    }
    if (emotes?.isOpen() && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= BOARD_EMOTES.length) {
        consume(e);
        const at = localPoint();
        const world = toWorld(at);
        layer.burst(BOARD_EMOTES[n - 1], world);
        if (hasAudience()) {
          lastEmoteAt = Math.max(Date.now(), lastEmoteAt + 1);
          store.updatePresence({
            emote: { emoji: BOARD_EMOTES[n - 1], x: world.x, y: world.y, at: lastEmoteAt },
          });
        }
        return;
      }
    }
    const action = presenceKeyAction(e, {
      readOnly,
      isBoardTarget: deps.isBoardTarget,
      editor: deps.editor,
    });
    if (!action) return;
    consume(e);
    if (action === "chat") {
      emotes?.close();
      chat?.open(localPoint());
    } else if (emotes?.isOpen()) {
      emotes.close();
    } else {
      emotes?.open(localPoint());
    }
  };
  document.addEventListener("keydown", onKeyDown, true);

  return {
    onViewportCommitted() {
      follow!.notifyCommitted();
      layer.refresh();
      // Wheel pan/zoom moves the world under a still pointer without a
      // `pointermove`: re-send where the pointer now is in the world.
      if (lastScreen) cursorPub?.queue(toWorld(lastScreen));
      publishViewport();
    },
    selectPeer(clientID) {
      const peer = readPeers().find((p) => p.clientID === clientID);
      if (!peer) return;
      if (isValidPeerViewport(peer.presence.viewport)) {
        follow!.follow(clientID, "manual");
      } else {
        jumpToCursor(clientID);
      }
    },
    jumpHint(clientID) {
      const peer = readPeers().find((p) => p.clientID === clientID);
      if (!peer) return undefined;
      if (isValidPeerViewport(peer.presence.viewport)) return "their view";
      return peer.presence.cursor ? "their cursor" : undefined;
    },
    isSpotlighting: () => spotlightToken !== null,
    setSpotlight(on) {
      if (readOnly) return;
      const next = on ? Date.now() : null;
      if ((next === null) === (spotlightToken === null)) return;
      spotlightToken = next;
      store.updatePresence({ spotlight: next });
      // Followers need a framing the moment they start following.
      if (on) viewportPub?.resend();
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      document.removeEventListener("keydown", onKeyDown, true);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      offPeers();
      offFollow();
      follow!.dispose();
      cursorPub?.dispose();
      viewportPub?.dispose();
      chatPub?.dispose();
      chat?.dispose();
      emotes?.dispose();
      layer.dispose();
      listeners.clear();
    },
  };
}

import {
  screenToWorld,
  worldToScreen,
  type ContextMenuItem,
  type Element,
  type Frame,
  type SlidesEditor,
  type Viewport,
} from "@wafflebase/slides";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { toast } from "sonner";

import { CommentComposer } from "@/components/comments/components/CommentComposer";
import type { BoardAnchor } from "@/types/comments";
import type { YorkieBoardStore } from "../yorkie-board-store";
import type { HandTool } from "../board-hand";
import { boardToolForKey, isTextEntryTarget } from "../board-shortcuts";
import { isStickyElement } from "../sticky";
import { elementAnchor, pointAnchor, resolveBoardAnchor } from "./board-anchor";
import { useBoardCollab, type BoardCollabValue } from "./board-collab-hook";
import {
  clampFraction,
  frameFractionToWorld,
  worldToFrameFraction,
} from "./frame-fraction";
import { elementPlainText } from "./ritual-tool";
import {
  hitAnyStamp,
  hitOwnStamp,
  hitOwnVoteDot,
  layoutRituals,
  type RitualLayout,
} from "./ritual-layout";
import { createRitualLayerDom } from "./ritual-layer-dom";
import { writeBallot, writeStampEdit } from "./ritual-writes";
import { describeStamps, planStampClick } from "./stamps";
import type { BoardStamps, BoardVoting } from "./types";
import { useBoardDoc, useBoardVoting } from "./use-board-voting";
import {
  ballotOf,
  canVote,
  castVote,
  retractVote,
  tallyVotes,
  votesLeft,
} from "./voting";
import { yorkiePlain } from "./yorkie-plain";
import { BoardVotingPanel } from "./board-voting-panel";

/** The canvas-menu entries the rituals add, read by `BoardView`'s editor hooks. */
export interface RitualMenus {
  canvasItems(at: { x: number; y: number }): ContextMenuItem[];
  elementItems(at: { x: number; y: number }): ContextMenuItem[];
}

const RITUAL_CURSOR_CSS =
  '[data-board-ritual="stamp"] > canvas, [data-board-ritual="stamp"] > div { cursor: crosshair !important; }' +
  '[data-board-ritual="comment"] > canvas, [data-board-ritual="comment"] > div { cursor: cell !important; }';

function nonce(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Stamps, dot voting and comment pins over the board canvas.
 *
 * Mounted by `BoardView` as a sibling of the canvas host, so it never sits
 * inside the node `BoardView`'s mount effect clears. Everything here is
 * additive to the board: a capture-phase `pointerdown` on the host takes a
 * click only while the stamp or comment tool is armed, the overlay is
 * `pointer-events: none` apart from comment pins, and the viewport is read
 * from `BoardView`'s own ref (polled per frame by identity, since every
 * commit replaces the object) rather than a new hook into its viewport
 * chokepoint.
 */
export function BoardRituals({
  editor,
  store,
  hand,
  containerRef,
  vpRef,
  readOnly,
  menuRef,
  navigateRef,
}: {
  editor: SlidesEditor | null;
  store: YorkieBoardStore | null;
  hand: HandTool;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  vpRef: MutableRefObject<Viewport>;
  readOnly: boolean;
  /** Filled with this layer's context-menu entries while mounted. */
  menuRef: MutableRefObject<RitualMenus | null>;
  /** `BoardView`'s "centre the viewport on this world point". */
  navigateRef: MutableRefObject<((world: { x: number; y: number }) => void) | null>;
}) {
  const collab = useBoardCollab();
  const doc = useBoardDoc();
  const voting = useBoardVoting();
  const layerRef = useRef<HTMLDivElement>(null);

  // Live values the imperative loop reads without re-running the effect.
  const collabRef = useRef<BoardCollabValue | null>(collab);
  collabRef.current = collab;
  const votingRef = useRef<BoardVoting | null>(voting);
  votingRef.current = voting;
  const dirtyRef = useRef(true);
  const layoutRef = useRef<RitualLayout | null>(null);
  const framesRef = useRef<Map<string, Frame>>(new Map());

  // Anything the overlay paints from React state invalidates it.
  useEffect(() => {
    dirtyRef.current = true;
  }, [
    voting,
    collab?.threads,
    collab?.activeThreadId,
    collab?.pending,
    collab?.user,
  ]);

  const canAct = !readOnly && !!collab?.user;

  useEffect(() => {
    const container = containerRef.current;
    const layerRoot = layerRef.current;
    if (!editor || !store || !doc || !container || !layerRoot) return;
    const canvas = container.querySelector<HTMLCanvasElement>(":scope > canvas");
    const overlay = canvas?.nextElementSibling ?? null;
    const isScene = (t: EventTarget | null) =>
      t instanceof Node && (t === canvas || (overlay?.contains(t) ?? false));

    const style = document.createElement("style");
    style.textContent = RITUAL_CURSOR_CSS;
    document.head.appendChild(style);

    const dom = createRitualLayerDom(layerRoot, {
      onPinClick: (threadId) => {
        const c = collabRef.current;
        if (!c) return;
        c.setActiveThreadId(threadId);
        c.setPanelOpen(true);
      },
    });

    // --- snapshot of document state, rebuilt only on a content change ---
    let elements: Element[] = [];
    let stamps: BoardStamps | undefined;
    const readSnapshot = () => {
      elements = store.read().slides[0]?.elements ?? [];
      const frames = new Map<string, Frame>();
      for (const el of elements) frames.set(el.id, el.frame);
      framesRef.current = frames;
      stamps = yorkiePlain<BoardStamps>(doc.getRoot().stamps);
    };
    readSnapshot();
    const offStore = store.onChange(() => {
      readSnapshot();
      dirtyRef.current = true;
    });

    const myKey = () => collabRef.current?.user?.key ?? null;

    // --- render loop: repaint on a viewport commit or a dirty flag ---
    let lastVp: Viewport | null = null;
    const paint = () => {
      const v = votingRef.current;
      const key = myKey();
      const myVotes = new Map<string, number>();
      if (v?.status === "active" && key) {
        for (const id of ballotOf(v, key)) myVotes.set(id, (myVotes.get(id) ?? 0) + 1);
      }
      const results = new Map<string, number>();
      if (v?.status === "ended") {
        for (const row of tallyVotes(v, new Set(framesRef.current.keys()))) {
          results.set(row.elementId, row.votes);
        }
      }
      const c = collabRef.current;
      const layout = layoutRituals({
        viewport: vpRef.current,
        frames: framesRef.current,
        stamps,
        myKey: key,
        myVotes,
        results,
        threads: c?.threads ?? [],
        activeThreadId: c?.activeThreadId ?? null,
        pending: c?.pending?.anchor ?? null,
      });
      layoutRef.current = layout;
      dom.render(layout);
    };
    let raf = 0;
    const tick = () => {
      if (dirtyRef.current || vpRef.current !== lastVp) {
        dirtyRef.current = false;
        lastVp = vpRef.current;
        paint();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // --- comments: open a composer for an anchor ---
    const startComment = (anchor: BoardAnchor) => {
      const c = collabRef.current;
      if (!c?.user || readOnly) return;
      if (editor.isTextEditing()) editor.exitTextEditing();
      const p = worldToScreen(vpRef.current, resolveBoardAnchor(anchor, framesRef.current));
      c.setPending({ anchor, screen: p });
      c.setActiveThreadId(null);
    };
    const anchorAt = (world: { x: number; y: number }, elementId: string | null) => {
      const frame = elementId ? framesRef.current.get(elementId) : undefined;
      return elementId && frame ? elementAnchor(elementId, frame, world) : pointAnchor(world);
    };

    // Jump-to from the side panel.
    const c0 = collabRef.current;
    if (c0) {
      c0.focusAnchorRef.current = (anchor) => {
        navigateRef.current?.(resolveBoardAnchor(anchor, framesRef.current));
      };
    }

    menuRef.current = {
      canvasItems: (at) =>
        canAct ? [{ label: "---", run: () => undefined }, { label: "Comment", run: () => startComment(pointAnchor(at)) }] : [],
      elementItems: (at) => {
        if (!canAct) return [];
        const id = editor.getSelection().find((s) => framesRef.current.has(s)) ?? null;
        return [
          { label: "---", run: () => undefined },
          { label: "Comment", run: () => startComment(anchorAt(at, id)) },
        ];
      },
    };

    // --- tool interplay: exactly one board tool is live ---
    const tool = collabRef.current?.tool ?? null;
    const syncCursor = () => {
      const mode = tool?.get().mode ?? "none";
      if (mode === "none") delete container.dataset.boardRitual;
      else container.dataset.boardRitual = mode;
    };
    const offTool = tool?.subscribe(() => {
      if (tool.get().mode !== "none") {
        hand.set(false);
        editor.setInsertMode(null);
        if (editor.isTextEditing()) editor.exitTextEditing();
      }
      syncCursor();
    });
    const offHand = hand.subscribe(() => {
      if (hand.get()) tool?.setMode("none");
    });
    const offInsert = editor.onInsertModeChange(() => {
      if (editor.getInsertMode() !== null) tool?.setMode("none");
    });
    syncCursor();

    // --- the tool click ---
    const onPointerDown = (e: PointerEvent) => {
      const mode = tool?.get().mode ?? "none";
      const c = collabRef.current;
      const user = c?.user;
      if (mode === "none" || !canAct || !user) return;
      // A pan claim (Space, middle button) got there first.
      if (e.defaultPrevented || e.button !== 0 || !isScene(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = screenToWorld(vpRef.current, { x: sx, y: sy });
      const elementId = editor.topLevelElementAt(e.clientX, e.clientY);

      if (mode === "comment") {
        startComment(anchorAt(world, elementId));
        tool?.setMode("none");
        return;
      }

      const layout = layoutRef.current;
      const v = votingRef.current;
      if (v && canVote(v, user.key)) {
        const dot = layout ? hitOwnVoteDot(layout, sx, sy) : null;
        if (dot) {
          const ballot = retractVote(v, user.key, dot);
          if (ballot) writeBallot(store, v.id, user.key, ballot);
          return;
        }
        if (!elementId) return;
        const el = elements.find((x) => x.id === elementId);
        const ballot = castVote(v, user.key, elementId, isStickyElement(el));
        if (ballot) {
          writeBallot(store, v.id, user.key, ballot);
        } else if (v.onlyStickies && !isStickyElement(el)) {
          toast.info("Only sticky notes take votes in this session.");
        } else if (votesLeft(v, user.key) === 0) {
          toast.info("You've used all your votes. Click one of your dots to take it back.");
        }
        return;
      }

      const frame = elementId ? framesRef.current.get(elementId) : undefined;
      const fraction = frame ? worldToFrameFraction(frame, world) : { u: 0.5, v: 0.5 };
      const edit = planStampClick({
        stamps: stamps ?? {},
        hitOwnKey: layout ? hitOwnStamp(layout, sx, sy) : null,
        elementId: frame ? elementId : null,
        userKey: user.key,
        userName: user.name,
        kind: tool?.get().stampKind ?? "plus1",
        u: clampFraction(fraction.u),
        v: clampFraction(fraction.v),
        now: Date.now(),
        nonce: nonce(),
      });
      if (edit) writeStampEdit(store, edit);
    };
    container.addEventListener("pointerdown", onPointerDown, { capture: true });

    // --- hover card: who stamped this ---
    const onPointerMove = (e: PointerEvent) => {
      const layout = layoutRef.current;
      if (!layout || layout.stamps.length === 0) {
        dom.showHover(null);
        return;
      }
      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const hit = hitAnyStamp(layout, sx, sy);
      if (!hit) {
        dom.showHover(null);
        return;
      }
      const onElement = layout.stamps.filter((s) => s.stamp.el === hit.stamp.el);
      dom.showHover(describeStamps(onElement), { x: sx, y: sy });
    };
    const onPointerLeave = () => dom.showHover(null);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerleave", onPointerLeave);

    // --- keys: Mod+Alt+M comment, Esc / tool keys leave the ritual tool ---
    const onKeyDown = (e: KeyboardEvent) => {
      const isComment =
        (e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === "KeyM";
      if (isComment) {
        if (!canAct || e.repeat) return;
        if (isTextEntryTarget(e.target) && !editor.isTextEditing()) return;
        e.preventDefault();
        e.stopPropagation();
        const id = editor.getSelection().find((s) => framesRef.current.has(s)) ?? null;
        const frame = id ? framesRef.current.get(id) : undefined;
        if (id && frame) {
          // Top-right corner of the selected object, as FigJam pins it.
          startComment({
            kind: "board",
            elementId: id,
            u: 1,
            v: 0,
            ...frameFractionToWorld(frame, 1, 0),
          });
        } else {
          tool?.setMode("comment");
        }
        return;
      }
      if (!tool || tool.get().mode === "none") return;
      if (e.key === "Escape") {
        tool.setMode("none");
        return;
      }
      if (isTextEntryTarget(e.target) || editor.isTextEditing()) return;
      if (editor.getSelection().length === 0 && boardToolForKey(e)) tool.setMode("none");
    };
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      offStore();
      offTool?.();
      offHand();
      offInsert();
      container.removeEventListener("pointerdown", onPointerDown, { capture: true });
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("keydown", onKeyDown, true);
      delete container.dataset.boardRitual;
      menuRef.current = null;
      if (c0 && c0.focusAnchorRef.current) c0.focusAnchorRef.current = null;
      dom.dispose();
      style.remove();
    };
  }, [editor, store, doc, hand, containerRef, vpRef, readOnly, menuRef, navigateRef, canAct]);

  const pending = collab?.pending ?? null;
  const tally = useMemo(
    () => (voting?.status === "ended" ? tallyVotes(voting, new Set(framesRef.current.keys())) : []),
    // `framesRef` is read at render; the voting change is what matters.
    [voting],
  );

  return (
    <>
      <div
        ref={layerRef}
        data-board-rituals=""
        className="pointer-events-none absolute inset-0 overflow-hidden"
      />
      {pending && collab && canAct && (
        <div
          className="absolute z-20 w-72 max-w-[90%] rounded-md border bg-background p-3 shadow-lg"
          style={{
            left: Math.max(8, pending.screen.x + 16),
            top: Math.max(8, pending.screen.y - 8),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <CommentComposer
            submitLabel="Comment"
            autoFocus
            members={collab.members}
            onCancel={() => collab.setPending(null)}
            onSubmit={async (body) => {
              const id = await collab.addThread(pending.anchor, body);
              collab.setPending(null);
              if (id) collab.setActiveThreadId(id);
            }}
          />
        </div>
      )}
      {store && voting && (
        <BoardVotingPanel
          store={store}
          voting={voting}
          tally={tally}
          userKey={collab?.user?.key ?? null}
          readOnly={readOnly}
          labelFor={(id) => elementLabelFor(store, id)}
          onFocusElement={(id) => {
            const frame = framesRef.current.get(id);
            if (frame) navigateRef.current?.({ x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 });
            editor?.setSelection([id]);
          }}
        />
      )}
    </>
  );
}

function elementLabelFor(store: YorkieBoardStore, id: string): string {
  const el = store.read().slides[0]?.elements.find((e) => e.id === id);
  if (!el) return "Deleted object";
  return elementTextOrKind(el);
}

function elementTextOrKind(el: Element): string {
  const text = elementPlainText(el);
  if (text) return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  if (isStickyElement(el)) return "Empty sticky";
  return el.type === "shape" ? "Shape" : el.type === "image" ? "Image" : "Object";
}

/**
 * The reporting overlay: aim, capture, say what is wrong.
 *
 * TWO RULES SHAPE THIS FILE, both measured by driving the throwaway spike by
 * hand (`docs/design/debug-report.md`, findings 5 and 8).
 *
 * **The pointer is watched, not taken.** While idle this component adds one
 * passive `mousemove` listener and nothing else — no `preventDefault`, no
 * `stopPropagation`. The app underneath keeps tracking hover, keeps its menus
 * open, and keeps a drag already under way. Capture is a KEY, because a keypress
 * moves no pointer: the state being reported survives being reported. The one
 * exception is `region`, where dragging out a rectangle genuinely needs the
 * pointer, and which the reporter enters deliberately.
 *
 * **Nothing is dropped in silence.** Cancelling drops the item and never the
 * mode; an empty note is refused visibly rather than accepted and discarded; and
 * a capture the budget evicted is named. The `window.prompt` this replaced broke
 * all three at once — cancel and empty both discarded without a trace, and its
 * Escape reached the page and turned debug mode off, so cancelling once made the
 * whole overlay vanish with no reason given.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeRect } from "@wafflebase/core/geometry";
import {
  actionFor,
  isTypingTarget,
  type DebugItem,
  type Rect,
} from "@wafflebase/debug-report";
import {
  captureAtPoint,
  captureProblemMessage,
  captureRegion,
  forgetEvictedCaptures,
  type PendingReport,
} from "./capture-item";
import { locatePoint } from "./locate";
import { useDebugSession } from "./use-debug-session";

/** Above every app layer, below nothing. */
const OVERLAY_Z = 2147483646;
const PANEL_Z = 2147483647;

/**
 * Height the note form is kept inside.
 *
 * A reserve, not a measurement: the form grows with a capture-problem message
 * or an eviction notice, and reserving too little is what let it run off the
 * bottom edge with its buttons unreachable.
 */
const FORM_MAX_H = 220;

const ACCENT = "#ff3b6b";

/** A drag shorter than this is a mis-click, not a region. */
const MIN_REGION = 4;

type DragState = { x: number; y: number } | null;

function outlineStyle(rect: Rect): React.CSSProperties {
  return {
    position: "absolute",
    left: rect.x,
    top: rect.y,
    width: rect.w,
    height: rect.h,
    outline: `2px solid ${ACCENT}`,
    background: "rgba(255, 59, 107, 0.12)",
    pointerEvents: "none",
  };
}

function describeTarget(pending: PendingReport): string {
  const { target, capture } = pending;
  const what =
    target.kind === "dom"
      ? `${target.tag}${target.testId ? ` · ${target.testId}` : ""}`
      : target.kind === "canvas"
        ? `${target.surface}${target.address ? ` · ${target.address}` : ""}`
        : `region${target.elements ? ` · ${target.elements.length} element(s)` : ""}`;
  const pixels = capture
    ? `${capture.w}×${capture.h} · ${Math.max(1, Math.round(capture.bytes / 1024))} KB · ${capture.layers} layer(s)`
    : "no image";
  return `${what} · ${pixels}`;
}

export function DebugOverlay({ route }: { route: string }) {
  const { session, store, items, mode, persistent, droppedCaptures } =
    useDebugSession();

  const [hover, setHover] = useState<Rect | null>(null);
  const [band, setBand] = useState<Rect | null>(null);
  const [pending, setPending] = useState<PendingReport | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const cursor = useRef({ x: 0, y: 0 });
  const dragFrom = useRef<DragState>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const live = mode !== "off";
  const deps = useMemo(() => ({ store }), [store]);

  const announce = useCallback(
    (report: PendingReport) => {
      // The store deleted those blobs; the items that referenced them have to
      // stop claiming them, and the reporter has to be told WHICH reports lost
      // their evidence rather than only how many.
      const orphaned = forgetEvictedCaptures(session, report.evicted);
      const problems = [
        captureProblemMessage(report.captureProblem),
        orphaned.length > 0
          ? `Storage was full, so the image was dropped from: ${orphaned
              .map((note) => `“${note}”`)
              .join(", ")}. Those notes are kept.`
          : report.evicted.length > 0
            ? `Storage was full, so ${report.evicted.length} older image(s) were dropped to make room.`
            : undefined,
      ].filter(Boolean);
      setNotice(problems.length > 0 ? problems.join(" ") : null);
      setPending(report);
      setDraft("");
    },
    [session],
  );

  /**
   * Run a capture and announce it, or say why it failed.
   *
   * BOTH ENTRY POINTS GO THROUGH HERE. They used to be `void capture()` and
   * `void captureRegion(...).then(announce)`, which discarded the rejection
   * path: a refused IndexedDB write — quota, a private window, blocked site
   * data — produced no `pending`, no notice, and an unhandled rejection on
   * `window`. The keystroke did nothing and said nothing, which is the one
   * failure mode this file's header forbids.
   */
  const run = useCallback(
    async (capturing: Promise<PendingReport>) => {
      try {
        announce(await capturing);
      } catch (err) {
        setPending(null);
        setNotice(
          `The capture failed and nothing was recorded: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    },
    [announce],
  );

  /** Capture what is under the cursor, without touching the pointer. */
  const capture = useCallback(
    () => run(captureAtPoint({ ...cursor.current }, deps)),
    [deps, run],
  );

  const commit = useCallback(() => {
    const note = draft.trim();
    // Refused, not silently discarded: the reporter sees why and the target is
    // still in hand.
    if (!pending || note.length === 0) return;
    session.add({
      note,
      target: pending.target,
      ...(pending.capture ? { capture: pending.capture } : {}),
    });
    setPending(null);
    setDraft("");
    setNotice(null);
  }, [draft, pending, session]);

  /** Abandon this target. Never the mode. */
  const discard = useCallback(() => {
    setPending(null);
    setDraft("");
    setNotice(null);
  }, []);

  useEffect(() => {
    if (pending) inputRef.current?.focus();
  }, [pending]);

  // ── Keyboard ────────────────────────────────────────────────────────────
  //
  // Capture phase, so the single-letter bindings never reach the app while debug
  // mode is live — otherwise `r` would type into a cell. The overlay's own field
  // is exempt: there, `r` is a letter and Escape means "drop this one".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A FOCUSED TEXT FIELD OWNS THE KEYBOARD, pending or not. Gating this on
      // `pending` meant that with debug mode on and nothing in hand, typing
      // "chart" into a rename dialog or the formula bar delivered "hat" — `c`
      // was swallowed as the capture key and the mode switched underneath. The
      // overlay's own field is covered by the same rule via `formRef`.
      const inField =
        (e.target instanceof Node && formRef.current?.contains(e.target)) ||
        isTypingTarget(e.target);
      if (inField) return;

      const action = actionFor(e, live);
      if (!action) return;
      // A recognised binding belongs to the overlay, including the global
      // toggle: letting it through as well would mean one keystroke both
      // opening debug mode and doing whatever the app binds it to. Anything
      // unrecognised was returned above, untouched.
      e.preventDefault();
      e.stopPropagation();

      switch (action) {
        case "toggle":
          if (live) discard();
          session.toggle();
          return;
        case "capture":
          void capture();
          return;
        case "pick":
          session.setMode("pick");
          return;
        case "region":
          session.setMode("region");
          return;
        case "cancel":
          // Escape with something in hand drops THAT, and only that.
          if (pending) discard();
          else session.setMode("off");
          return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capture, discard, live, pending, session]);

  // ── Where the cursor is, tracked ALWAYS ─────────────────────────────────
  //
  // Not gated on `live`, and that is the whole point. The natural order for
  // reporting a transient state is to hover the thing FIRST and press the
  // hotkey second — and measured in a browser, gating this meant the first
  // capture after entering debug mode used (0, 0): it photographed the page
  // root instead of what the reporter was looking at.
  useEffect(() => {
    const track = (e: MouseEvent) => {
      cursor.current = { x: e.clientX, y: e.clientY };
    };
    document.addEventListener("mousemove", track, { passive: true });
    return () => document.removeEventListener("mousemove", track);
  }, []);

  // ── Pointer, watched passively ──────────────────────────────────────────
  useEffect(() => {
    // Cleared on every mode change, not only on leaving debug mode: pressing `r`
    // after aiming otherwise left the last pick outline painted on screen until
    // the first band replaced it.
    setHover(null);
    setBand(null);
    if (!live) {
      dragFrom.current = null;
      return;
    }
    const onMove = (e: MouseEvent) => {
      if (pending) return;
      const from = dragFrom.current;
      if (from) {
        setBand(normalizeRect(from.x, from.y, e.clientX, e.clientY));
        return;
      }
      if (mode === "pick") {
        // THE OUTLINE IS WHAT A CAPTURE WOULD RECORD, not the raw hit-test box.
        // Outlining `elementFromPoint` directly showed the glyph inside a button
        // while `c` recorded the button, and on the sheet it showed the wrapper
        // `div` covering the entire grid — the "photograph of everything" visual
        // this design rejects — while `c` recorded one cell. Routing the hover
        // through the same resolver the capture uses makes the reticle honest.
        setHover(locatePoint({ x: e.clientX, y: e.clientY }).rect);
      }
    };
    // `passive` is the point: this listener must never call `preventDefault`,
    // because the app underneath needs the same events to keep its hover state.
    document.addEventListener("mousemove", onMove, { passive: true });
    return () => document.removeEventListener("mousemove", onMove);
  }, [live, mode, pending]);

  // ── Region drag, the one place the pointer is taken ─────────────────────
  useEffect(() => {
    if (!live || mode !== "region" || pending) {
      // A drag origin that outlives its mode freezes a rubber band onto the
      // cursor: `onMove` keeps taking the `if (from)` branch, the band wins over
      // the hover outline, and pick mode shows a box anchored to a point the
      // reporter abandoned. Reachable by pressing `p` mid-drag, or by releasing
      // the button outside the window so no `mouseup` ever arrives.
      dragFrom.current = null;
      setBand(null);
      return;
    }
    const stop = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onDown = (e: MouseEvent) => {
      stop(e);
      dragFrom.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: MouseEvent) => {
      stop(e);
      const from = dragFrom.current;
      dragFrom.current = null;
      setBand(null);
      if (!from) return;
      const rect = normalizeRect(from.x, from.y, e.clientX, e.clientY);
      if (rect.w < MIN_REGION || rect.h < MIN_REGION) return;
      void run(captureRegion(rect, deps));
    };
    // A drag that ends outside the window never delivers `mouseup`, so the
    // origin is dropped when the pointer leaves the document instead.
    const onLeave = () => {
      dragFrom.current = null;
      setBand(null);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("mouseup", onUp, true);
    document.addEventListener("click", stop, true);
    document.addEventListener("mouseleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("mouseup", onUp, true);
      document.removeEventListener("click", stop, true);
      document.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("blur", onLeave);
      dragFrom.current = null;
    };
  }, [deps, live, mode, pending, run]);

  if (!live) return null;

  const outline = pending?.target.rect ?? band ?? hover;

  return (
    <>
      <div
        data-testid="debug-overlay"
        data-wb-debug=""
        data-debug-mode={pending ? "describing" : mode}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: OVERLAY_Z,
          // Never intercepts. The outline is a picture, not a surface.
          pointerEvents: "none",
        }}
      >
        {outline && <div style={outlineStyle(outline)} />}
      </div>

      <DebugBadge
        mode={pending ? "describing" : mode}
        count={items.length}
        persistent={persistent}
        droppedCaptures={droppedCaptures.length}
        route={route}
      />

      {pending && (
        <div
          ref={formRef}
          data-testid="debug-note-form"
          data-wb-debug=""
          style={{
            position: "fixed",
            left: Math.min(
              Math.max(8, pending.target.rect.x),
              Math.max(8, window.innerWidth - 436),
            ),
            // Clamped to the viewport on BOTH sides. The old form reserved a
            // fixed 120px below the target and clamped only the top, so a form
            // taller than that — a long note, a capture problem message, an
            // eviction notice — ran off the bottom edge with its buttons
            // unreachable. `FORM_MAX_H` is the reserve, and the last `min`
            // keeps the whole box on screen whichever branch was taken.
            top: Math.min(
              Math.max(
                8,
                pending.target.rect.y + pending.target.rect.h + FORM_MAX_H < window.innerHeight
                  ? pending.target.rect.y + pending.target.rect.h + 8
                  : pending.target.rect.y - FORM_MAX_H + 8,
              ),
              Math.max(8, window.innerHeight - FORM_MAX_H - 8),
            ),
            zIndex: PANEL_Z,
            width: 420,
            padding: 12,
            borderRadius: 8,
            background: "#111",
            color: "#fff",
            font: "13px/1.5 system-ui, sans-serif",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ marginBottom: 6, opacity: 0.7, fontSize: 11 }}>
            {describeTarget(pending)}
          </div>
          <input
            ref={inputRef}
            value={draft}
            aria-label="What is wrong?"
            placeholder="무엇이 문제인가요?"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Stopped here so the app underneath never sees the typing — the
              // sheet would otherwise start editing a cell.
              e.stopPropagation();
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") discard();
            }}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid #444",
              background: "#1b1b1b",
              color: "#fff",
              font: "inherit",
              outline: "none",
            }}
          />
          {notice && (
            <div
              data-testid="debug-notice"
              style={{ marginTop: 8, fontSize: 11, color: "#ffb4c6" }}
            >
              {notice}
            </div>
          )}
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={commit}
              disabled={draft.trim().length === 0}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                border: "none",
                background: draft.trim() ? ACCENT : "#3a3a3a",
                color: "#fff",
                font: "inherit",
                cursor: draft.trim() ? "pointer" : "default",
              }}
            >
              Save (Enter)
            </button>
            <button
              type="button"
              onClick={discard}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                border: "1px solid #444",
                background: "transparent",
                color: "#fff",
                font: "inherit",
                cursor: "pointer",
              }}
            >
              Discard (Esc)
            </button>
            {draft.trim().length === 0 && (
              <span style={{ fontSize: 11, opacity: 0.6 }}>
                A sentence is required — it is what gets verified.
              </span>
            )}
          </div>
        </div>
      )}
      {/* The notice above lives INSIDE the note form, so a capture that failed
          before there was anything to describe had nowhere to appear. This is
          the same message, rendered on its own. */}
      {!pending && notice && (
        <div
          data-testid="debug-notice"
          data-wb-debug=""
          style={{
            position: "fixed",
            bottom: 56,
            left: 16,
            zIndex: PANEL_Z,
            maxWidth: 420,
            padding: "8px 12px",
            borderRadius: 8,
            background: "#3a1d1d",
            color: "#fff",
            font: "12px/1.5 ui-monospace, monospace",
          }}
        >
          {notice}
        </div>
      )}
    </>
  );
}

function DebugBadge({
  mode,
  count,
  persistent,
  droppedCaptures,
  route,
}: {
  mode: string;
  count: number;
  persistent: boolean;
  droppedCaptures: number;
  route: string;
}) {
  return (
    <div
      data-testid="debug-badge"
      data-wb-debug=""
      // Bottom-LEFT: the documents list parks an upload panel at bottom-right
      // (`app/documents/upload-panel.tsx`, `fixed bottom-4 right-4 z-50`).
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        zIndex: PANEL_Z,
        padding: "8px 12px",
        borderRadius: 8,
        background: "#111",
        color: "#fff",
        font: "12px/1.5 ui-monospace, monospace",
        pointerEvents: "none",
        maxWidth: 420,
      }}
    >
      debug-report · <b>{mode}</b> · {count} item{count === 1 ? "" : "s"}
      <br />
      <span style={{ opacity: 0.7 }}>
        c capture · p pick · r region · Esc {mode === "describing" ? "discard" : "off"}
      </span>
      {!persistent && (
        <>
          <br />
          <span style={{ color: "#ffb4c6" }}>
            This browser refused persistent storage — images will not survive a reload.
          </span>
        </>
      )}
      {droppedCaptures > 0 && (
        <>
          <br />
          <span style={{ color: "#ffb4c6" }}>
            {droppedCaptures} restored item(s) lost their image.
          </span>
        </>
      )}
      <br />
      <span style={{ opacity: 0.45 }}>{route}</span>
    </div>
  );
}

export type { DebugItem };

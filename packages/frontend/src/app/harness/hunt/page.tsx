// The UI hunter's target surface — real engines, real toolbar, fake storage.
//
// WHY A SEPARATE ROUTE FROM /harness/visual AND /harness/interaction. Those two are
// built for what they measure: `visual` mounts scenes READ-ONLY for screenshot
// diffing, and `interaction` mounts a bare `Spreadsheet` with no chrome. Neither can
// exercise a toolbar, and a toolbar is where a large share of the product's real
// defects live — every UI bug the design doc cites (#343, #494, #333) is reached
// through one.
//
// So this route mounts the REAL engines over IN-MEMORY stores and hangs the REAL
// `DocsFormattingToolbar` off the editor. `MemStore`/`MemDocStore` mean there is no
// backend, no login, no docker, and nothing a probe does can touch real data —
// safety is a property of what is mounted rather than a rule the driver must respect.
//
// SURFACE SELECTION IS A QUERY PARAM, not bridge state. `?surface=doc` remounts from
// a fixed seed, mirroring `/harness/visual?section=…`. Navigation is therefore the
// reset primitive: every run starts from a byte-identical document, which is what
// makes a 3x replay comparable at all.

import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_PAGE_SETUP,
  MemDocStore,
  generateBlockId,
  initialize as initializeDocs,
  type Block,
  type Document as DocsDocument,
  type EditorAPI,
} from "@wafflebase/docs";
import {
  MemStore,
  initialize as initializeSheet,
  type Grid,
  type Spreadsheet,
} from "@wafflebase/sheets";
// THE SLIDES ENGINE AND ITS TOOLBAR ARE LOADED ON DEMAND, and that is load-bearing rather
// than tidy. `@wafflebase/slides`'s entry point re-exports `importPptx`, so a static import
// pulls jszip and the whole PPTX importer into this route — and this route mounts ONE
// surface at a time, so the sheet and doc surfaces were paying for all of it.
//
// Measured, not theorised: with both imported statically, the oracle lane's very first
// navigation timed out after 30s waiting for `networkidle` and the run printed no checks at
// all. The surfaces that changed were the two this feature does not touch, which is the
// worst shape of regression to debug. Both forms below keep them byte-identical.
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { DocsFormattingToolbar } from "@/app/docs/docs-formatting-toolbar";
import { FormattingToolbar } from "@/components/formatting-toolbar";

import type { Element, MemSlidesStore, SlidesDocument, SlidesEditor } from "@wafflebase/slides";

/** The slides module, as a type only — the value arrives from `await import(...)`. */
type SlidesModule = typeof import("@wafflebase/slides");

const SlidesToolbarLazy = lazy(() =>
  import("@/app/slides/toolbar").then((m) => ({ default: m.SlidesToolbar })),
);

const BoardToolbarLazy = lazy(() =>
  import("@/app/board/board-toolbar").then((m) => ({ default: m.BoardToolbar })),
);

import type { BoardGridKind } from "@/app/board/board-grid";

import { asBoardStore } from "./mem-board-store";
import { installHuntBridge, type HuntSurface } from "./bridge";
import { SEED_FRAMES } from "./slides-seed";

type HarnessStatus = "loading" | "ready" | "error";

// STILL DEFAULTS, and that is not the oversight it looks like. A URL is typed by hand, so
// an unrecognised `?surface=` has to resolve to something rather than fail. What changed
// with the slides surface is that the runner no longer TRUSTS this: since #847 it asks the
// bridge which surface actually mounted and refuses when the answer is not what the plan
// asked for. So a substitution here is loud at the only place it could mislead anyone,
// and this stays a convenience for a person opening the page.
const SURFACES: readonly HuntSurface[] = ["sheet", "doc", "slides", "board"];

function useSurfaceFromSearchParams(): HuntSurface {
  try {
    const surface = new URLSearchParams(window.location.search).get("surface");
    return SURFACES.includes(surface as HuntSurface) ? (surface as HuntSurface) : "sheet";
  } catch {
    return "sheet";
  }
}

// --- seeded faults: the hunter's positive control -----------------------------
//
// WHY A DELIBERATE DEFECT LIVES IN THE HARNESS.
//
// Every other guard in this pipeline is a negative control: it proves the hunter
// does not report things that are fine. Nothing proved the opposite — that a real
// defect actually survives explore → replay → verify → gate → report. The obvious
// control was issue #343, and it turned out to be already fixed, so there is no open
// UI bug with a known ground-A shape to aim at. A SEEDED defect is better anyway,
// because it is repeatable: run against `?fault=…` and the funnel must report it;
// run against the clean route and it must stay quiet.
//
// This is a deliberate reversal of PR 1's rule that faults come only from the
// driver, and the reason PR 1 could hold that line is the reason it cannot hold
// here: Playwright can inject a `pageerror` from outside, but it cannot inject a
// SEMANTIC defect into the editor's own code path. Only the app can do that.
//
// It cannot ship. `/harness/hunt` is already DEV-only — App.tsx gates the whole lazy
// import behind `import.meta.env.DEV`, which Vite replaces statically, so this file
// is not in a production bundle at all. No second gate is needed and adding one
// would imply the first is not trusted.
//
// The registry is CLOSED and the id is matched exactly, so `?fault=` can turn on one
// of these and nothing else. The active fault is also published as
// `data-hunt-harness-fault` on the root, so a seeded run can never be mistaken for a
// real one — a positive control that looks identical to a hunt is how a fabricated
// finding ends up in a report.

type FaultId = "drop-second-char";

const KNOWN_FAULTS: readonly FaultId[] = ["drop-second-char"] as const;

function useFaultFromSearchParams(): FaultId | null {
  try {
    const fault = new URLSearchParams(window.location.search).get("fault");
    return KNOWN_FAULTS.includes(fault as FaultId) ? (fault as FaultId) : null;
  } catch {
    return null;
  }
}

/**
 * Install a seeded fault, returning its uninstaller.
 *
 * `drop-second-char` swallows every second printable keystroke. Chosen because it is
 * the cleanest possible GROUND A defect: the agent types a literal, the literal is
 * therefore an `@input:` reference in its own journal, and what comes back is not
 * what it typed. No documentation, no convention and no opinion is involved — the
 * app contradicts the agent's own action.
 *
 * Capture phase on the container, so it intercepts before the editor sees the key
 * and works identically on both surfaces without either engine knowing about it.
 * Modified keys are left alone: swallowing Ctrl+Z would make undo behave oddly and
 * the control has to inject ONE defect, not a fog.
 *
 * The counter is per-install and starts at 0, so replaying the same action sequence
 * drops the same characters — a non-deterministic fault would fail replay and the
 * control would prove nothing.
 */
function installFault(fault: FaultId, container: HTMLElement): () => void {
  if (fault === "drop-second-char") {
    let seen = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (!printable) return;
      seen += 1;
      if (seen % 2 === 0) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    container.addEventListener("keydown", onKeyDown, true);
    return () => container.removeEventListener("keydown", onKeyDown, true);
  }
  return () => {};
}

/**
 * The doc seed.
 *
 * Block 0 deliberately carries THREE different font sizes on one line. That is the
 * exact shape issue #343 needs — "increasing font size on a mixed-size selection
 * resets to the minimum" is unobservable on uniformly-sized text — and it is the
 * same shape `harness/visual/docs-scenarios.tsx` uses for its baseline. Duplicated
 * rather than imported: coupling two harnesses means a change made for a screenshot
 * silently changes what the hunter explores.
 */
function seedDocument(): DocsDocument {
  const mixed: Block = {
    id: generateBlockId(),
    type: "paragraph",
    inlines: [
      { text: "Small ", style: { fontSize: 11 } },
      { text: "Medium ", style: { fontSize: 18 } },
      { text: "LARGE", style: { fontSize: 32, bold: true } },
    ],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
  const plain: Block = {
    id: generateBlockId(),
    type: "paragraph",
    inlines: [{ text: "The quick brown fox jumps over the lazy dog.", style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
  const styled: Block = {
    id: generateBlockId(),
    type: "paragraph",
    inlines: [
      { text: "Bold start ", style: { bold: true } },
      { text: "then italic ", style: { italic: true } },
      { text: "then plain.", style: {} },
    ],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
  return { blocks: [mixed, plain, styled], pageSetup: DEFAULT_PAGE_SETUP };
}

/**
 * The slides seed — two slides, four elements, every id fixed by hand.
 *
 * IDS ARE AUTHORED, NOT GENERATED. `store.addElement` mints a UUID, and a surface whose
 * element ids change every boot cannot support the one thing this harness is for: a
 * prediction naming what it expects. `slides.elements` would differ between two runs of
 * an identical plan, replay would read as divergent, and the fingerprint would treat the
 * same defect as new every time. `makeToolbarStore` in the visual harness fixes the slide
 * id for the same reason; this fixes the elements too.
 *
 * The scaffolding — themes, masters, layouts — still comes from a real empty store rather
 * than a literal, so the seed cannot drift away from what the product actually creates.
 *
 * The CONTENT is chosen to make round trips observable. Two elements overlap in z-order so
 * `Bring forward`/`Send backward` reorder something visible; two sit at different sizes so
 * an alignment operation has work to do; the title holds text so typing has somewhere to
 * land; and the second slide exists so navigation has a destination — a one-slide deck
 * makes `Next slide` a no-op that looks like a bug.
 */
/**
 * A seeded element's rect, from the constant `slides-seed.test.ts` asserts on.
 *
 * The frames live there rather than here so the "no centre under another element" rule is
 * checkable without booting a browser — that lane is not in CI and cannot finish on a
 * loaded machine, which is precisely when a geometry regression would slip through.
 * Reading them back here is what keeps the tested numbers and the shipped ones the same.
 */
function frameOf(id: string): { x: number; y: number; w: number; h: number } {
  const found = SEED_FRAMES.find((f) => f.id === id);
  if (!found) throw new Error(`[hunt-harness] no seed frame named ${id}`);
  return { x: found.x, y: found.y, w: found.w, h: found.h };
}

/**
 * The board seed — four elements on one unbounded plane, ids fixed by hand.
 *
 * WORLD COORDINATES, and small ones. A board has no rect to be inside, so these are chosen to
 * sit inside the pinned 960x540 view at `zoom: 1` — an element outside it is unclickable until
 * something scrolls, and a seed that starts half off-screen makes the first action a refusal.
 *
 * Kept clear of each other's CENTRES for the reason the slides seed is: `board.elementCenter`
 * aims at the middle and the canvas selects whatever is topmost there, so a covered centre
 * makes the reader name one element and select another. Still overlapping at the corners, so
 * a z-order change is visible.
 */
function seedBoardElements(): Element[] {
  const note: Element = {
    id: "note",
    type: "shape",
    frame: { x: 60, y: 60, w: 200, h: 140, rotation: 0 },
    data: { kind: "roundRect", fill: { kind: "role", role: "accent1" } },
  };
  const card: Element = {
    id: "card",
    type: "shape",
    frame: { x: 220, y: 150, w: 240, h: 160, rotation: 0 },
    data: { kind: "rect", fill: { kind: "role", role: "accent2" } },
  };
  const label: Element = {
    id: "label",
    type: "text",
    frame: { x: 560, y: 80, w: 320, h: 90, rotation: 0 },
    data: {
      blocks: [
        {
          id: "label-b1",
          type: "paragraph",
          inlines: [{ text: "Retro board", style: { fontSize: 28 } }],
          style: { alignment: "left", lineHeight: 1.2, marginTop: 0, marginBottom: 0, textIndent: 0, marginLeft: 0 },
        },
      ],
    },
  };
  const idea: Element = {
    id: "idea",
    type: "text",
    frame: { x: 560, y: 300, w: 300, h: 120, rotation: 0 },
    data: {
      blocks: [
        {
          id: "idea-b1",
          type: "paragraph",
          inlines: [{ text: "Ship the hunter.", style: {} }],
          style: { alignment: "left", lineHeight: 1.2, marginTop: 0, marginBottom: 0, textIndent: 0, marginLeft: 0 },
        },
      ],
    },
  };
  return [note, card, label, idea];
}

function seedSlides(S: SlidesModule): MemSlidesStore {
  const base = new S.MemSlidesStore();
  base.batch(() => {
    base.addSlide("blank");
    base.addSlide("blank");
  });
  const doc: SlidesDocument = base.read();

  const title: Element = {
    id: "title",
    type: "text",
    frame: { ...frameOf("title"), rotation: 0 },
    data: {
      blocks: [
        {
          id: "title-b1",
          type: "paragraph",
          inlines: [{ text: "Quarterly review", style: { fontSize: 56 } }],
          style: { alignment: "center", lineHeight: 1.2, marginTop: 0, marginBottom: 0, textIndent: 0, marginLeft: 0 },
        },
      ],
    },
  };
  const body: Element = {
    id: "body",
    type: "text",
    frame: { ...frameOf("body"), rotation: 0 },
    data: {
      blocks: [
        {
          id: "body-b1",
          type: "paragraph",
          inlines: [{ text: "Revenue is up.", style: {} }],
          style: { alignment: "left", lineHeight: 1.2, marginTop: 0, marginBottom: 0, textIndent: 0, marginLeft: 0 },
        },
      ],
    },
  };
  // OVERLAPPING AT THE CORNERS, AND AT NO ELEMENT'S CENTRE. Both halves are deliberate.
  //
  // They overlap because a z-order change has to be visible: with the shapes apart,
  // `Bring to front` paints an identical frame and reads exactly like a dead control.
  //
  // No element's centre may lie under another, because `slides.elementCenter` aims at the
  // centre and the canvas hit-tests the TOPMOST element there. The first seed had `badge`
  // squarely over `card`'s middle, and clicking `elementCenter("card")` selected `badge` —
  // correct hit-testing, and a trap: the explorer predicts `["card"]`, reads `["badge"]`,
  // and proposes "clicking an element selects a different one", which is a defect the
  // harness manufactured. Measured on the first live probe of this surface.
  const card: Element = {
    id: "card",
    type: "shape",
    frame: { ...frameOf("card"), rotation: 0 },
    data: { kind: "roundRect", fill: { kind: "role", role: "accent1" } },
  };
  const badge: Element = {
    id: "badge",
    type: "shape",
    frame: { ...frameOf("badge"), rotation: 0 },
    data: { kind: "ellipse", fill: { kind: "role", role: "accent2" } },
  };

  return new S.MemSlidesStore({
    ...doc,
    slides: [
      { ...doc.slides[0], id: "slide-1", elements: [card, badge, title, body] },
      { ...doc.slides[1], id: "slide-2", elements: [] },
    ],
  });
}

/** The sheet seed — values, a formula to recalculate, and rows to scroll through. */
function seedGrid(): Grid {
  const grid: Grid = new Map([
    ["A1", { v: "10" }],
    ["A2", { v: "20" }],
    ["A3", { v: "30" }],
    ["B1", { v: "Label" }],
    ["C1", { f: "=A1+A2", v: "30" }],
  ]);
  for (let row = 2; row <= 60; row++) {
    grid.set(`D${row}`, { v: `Row ${row}` });
  }
  return grid;
}

export default function HuntHarnessPage() {
  const surface = useSurfaceFromSearchParams();
  const fault = useFaultFromSearchParams();
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<HarnessStatus>("loading");
  // The toolbar is a React child of this page, so the editor has to reach it through
  // state rather than a ref — a ref assignment would not re-render and the toolbar
  // would stay permanently disabled.
  const [editor, setEditor] = useState<EditorAPI | null>(null);
  const [sheet, setSheet] = useState<Spreadsheet | null>(null);
  const [slides, setSlides] = useState<SlidesEditor | null>(null);
  const [slidesStore, setSlidesStore] = useState<MemSlidesStore | null>(null);
  const [board, setBoard] = useState<SlidesEditor | null>(null);
  const [boardStore, setBoardStore] = useState<MemSlidesStore | null>(null);
  // REAL STATE, NOT NO-OPS. `BoardToolbarProps` requires these and says why: the grid dropdown
  // is fully controlled, so "a consumer that omitted these would render a menu that shows a
  // selected mode and silently ignores every click". That is exactly the shape that produced a
  // false candidate on the sheet surface, and the component warned about it in advance.
  const [gridKind, setGridKind] = useState<BoardGridKind>("none");
  const [gridSnap, setGridSnap] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    // One effect owns install + mount + teardown. Split across two effects this is
    // correct but fiddly to reason about under StrictMode's mount/unmount/remount;
    // keeping it in one makes the ordering obvious and the cleanup total.
    const controller = installHuntBridge();
    controller.setSurface(surface);

    let disposed = false;
    let spreadsheet: Spreadsheet | undefined;
    let docEditor: EditorAPI | undefined;
    let slidesEditor: SlidesEditor | undefined;
    let boardEditor: SlidesEditor | undefined;
    let uninstallBoardWheel: (() => void) | null = null;

    /**
     * This mount's OWN container, not the shared host.
     *
     * Two facts collide here, and the isolation is what keeps them apart.
     *
     * First, the sheet branch awaits before it can assign `spreadsheet`, so an
     * unmount landing mid-await leaves the teardown's `spreadsheet?.cleanup()` with
     * nothing to clean; the promise then resolves into a live engine — RAF loop and
     * listeners — that nothing ever disposes. StrictMode's mount/unmount/remount
     * makes that the normal dev path.
     *
     * Second, and this is what makes the obvious fix wrong: disposing that abandoned
     * engine tears down whatever DOM it was given, and by then the NEXT mount has
     * already painted into the same host. Cleaning up the stale engine therefore
     * deletes the live canvas. Measured, not theorised — the first attempt at this
     * fix left the sheet surface with no canvas at all, which the bridge readers
     * cannot see because they read the engine rather than the DOM.
     *
     * Giving every mount its own child means a stale cleanup operates on a node that
     * was already detached, and the live mount is untouched.
     */
    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";

    // Installed on THIS mount's container and torn down with it, so a stale mount
    // cannot leave a listener intercepting the live one's keystrokes — the same
    // isolation argument as the container itself, and the failure would look
    // identical to a real defect, which is the worst possible bug for a positive
    // control to have.
    const uninstallFault = fault ? installFault(fault, container) : null;

    const disposeMounted = () => {
      uninstallFault?.();
      docEditor?.dispose();
      docEditor = undefined;
      spreadsheet?.cleanup();
      spreadsheet = undefined;
      // `detach()`, which is what the slides editor calls its teardown — it removes the
      // listeners and stops the render loop. Same contract as the other two engines'
      // `dispose`/`cleanup`, and it has to run for the same reason: StrictMode's
      // mount/unmount/remount otherwise leaves a live editor painting into a detached
      // canvas while the next one paints into the real host.
      slidesEditor?.detach();
      slidesEditor = undefined;
      uninstallBoardWheel?.();
      uninstallBoardWheel = null;
      boardEditor?.detach();
      boardEditor = undefined;
      container.remove();
    };

    async function mount() {
      setStatus("loading");
      host!.replaceChildren(container);
      try {
        if (surface === "doc") {
          const store = new MemDocStore();
          store.setDocument(seedDocument());
          docEditor = initializeDocs(container, store, "light", /* readOnly */ false);
          if (disposed) return disposeMounted();
          controller.setDoc({ editor: docEditor, host: container });
          setEditor(docEditor);
        } else if (surface === "board") {
          const S: SlidesModule = await import("@wafflebase/slides");
          const B = await import("@wafflebase/board");
          // The wheel helper is a frontend module, not part of the board package.
          const { applyWheelToViewport } = await import("@/app/board/board-wheel");
          if (disposed) return disposeMounted();

          // A BOARD IS ONE UNBOUNDED PLANE, so the seed is a flat element list rather than
          // slides. `boardToSlidesDocument` is the product's own adapter, used here so the
          // harness cannot drift from the shape a real board has.
          const doc = B.boardToSlidesDocument({ meta: { title: "Hunt board" }, elements: seedBoardElements() });
          // Wrapped so the 34 methods a real board REFUSES refuse here too. See
          // `mem-board-store.ts`: a harness laxer than production hides the constraint.
          const store = asBoardStore(new S.MemSlidesStore(doc));

          const hostW = 960;
          const hostH = 540;
          const dpr = window.devicePixelRatio || 1;

          // THE VIEWPORT IS PINNED, and that is what determinism rests on here. A slide gets
          // it from a fixed 1920x1080 rect; a board has no rect, so identical runs require an
          // identical starting pan and zoom. `zoom: 1` also makes world and screen pixels the
          // same number, which keeps a failing prediction readable.
          const viewport: { panX: number; panY: number; zoom: number } = { panX: 0, panY: 0, zoom: 1 };

          const wrap = document.createElement("div");
          wrap.style.position = "relative";
          wrap.style.width = `${hostW}px`;
          wrap.style.height = `${hostH}px`;
          wrap.style.margin = "0 auto";
          wrap.style.overflow = "hidden";

          const canvas = document.createElement("canvas");
          canvas.width = hostW * dpr;
          canvas.height = hostH * dpr;
          canvas.style.display = "block";
          canvas.style.width = `${hostW}px`;
          canvas.style.height = `${hostH}px`;
          canvas.style.position = "absolute";
          canvas.style.left = "0";
          canvas.style.top = "0";
          wrap.appendChild(canvas);

          const overlay = document.createElement("div");
          overlay.style.position = "absolute";
          overlay.style.left = "0";
          overlay.style.top = "0";
          overlay.style.width = `${hostW}px`;
          overlay.style.height = `${hostH}px`;
          overlay.style.pointerEvents = "none";
          wrap.appendChild(overlay);

          container.appendChild(wrap);

          boardEditor = S.initializeEditor({
            canvas,
            overlay,
            store,
            hostWidth: hostW,
            hostHeight: hostH,
            dpr,
            viewport,
          });
          if (disposed) return disposeMounted();

          // WHEEL PANS AND ZOOMS, because otherwise the defining feature of an infinite canvas
          // is unreachable and every off-screen refusal is a dead end. `board.pointAt` tells
          // the caller to "scroll toward it"; without this listener that advice is false, and
          // an instruction the harness cannot honour is worse than no instruction.
          //
          // `applyWheelToViewport` is the product's own helper — pan on a plain wheel, zoom
          // with ctrl/meta held — so the harness pans exactly as the real board does rather
          // than inventing a second rule.
          const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const next = applyWheelToViewport(viewport, {
              deltaX: e.deltaX,
              deltaY: e.deltaY,
              ctrlKey: e.ctrlKey,
              metaKey: e.metaKey,
              offsetX: e.offsetX,
              offsetY: e.offsetY,
            });
            viewport.panX = next.panX;
            viewport.panY = next.panY;
            viewport.zoom = next.zoom;
            boardEditor?.setViewport(viewport);
          };
          canvas.addEventListener("wheel", onWheel, { passive: false });
          uninstallBoardWheel = () => canvas.removeEventListener("wheel", onWheel);

          controller.setBoard({ editor: boardEditor, store, host: container, viewport: () => viewport });
          setBoard(boardEditor);
          setBoardStore(store);
        } else if (surface === "slides") {
          // Awaited HERE, inside the branch, so nothing about the slides engine is fetched
          // or transformed when the mounted surface is a sheet or a document.
          const S: SlidesModule = await import("@wafflebase/slides");
          if (disposed) return disposeMounted();
          const { SLIDE_WIDTH, SLIDE_HEIGHT } = S;
          const store = seedSlides(S);

          // A FIXED SLIDE SIZE, not one measured from the container.
          //
          // `slides.elementCenter` turns a slide-logical frame into a click point using
          // `scale = canvasWidth / SLIDE_WIDTH`, so the scale is part of this harness's
          // contract, not a detail of the window. Measuring the container would make every
          // click coordinate depend on the viewport, the toolbar's wrapped height, and the
          // machine's font metrics — three things that differ between a developer's run
          // and CI, and all of which would move clicks onto neighbouring elements rather
          // than fail outright. Half of 1920x1080 makes the scale exactly 0.5, so every
          // seeded element's centre lands on a whole pixel and the arithmetic has no
          // rounding to disagree about. It fits the runner's 1600x1200 viewport with the
          // header and toolbar above it.
          const hostW = SLIDE_WIDTH / 2;
          const hostH = SLIDE_HEIGHT / 2;
          const dpr = window.devicePixelRatio || 1;

          const wrap = document.createElement("div");
          wrap.style.position = "relative";
          wrap.style.width = `${hostW}px`;
          wrap.style.height = `${hostH}px`;
          wrap.style.margin = "0 auto";

          const canvas = document.createElement("canvas");
          canvas.width = hostW * dpr;
          canvas.height = hostH * dpr;
          canvas.style.display = "block";
          canvas.style.width = `${hostW}px`;
          canvas.style.height = `${hostH}px`;
          canvas.style.position = "absolute";
          canvas.style.left = "0";
          canvas.style.top = "0";
          wrap.appendChild(canvas);

          // `pointerEvents: none` mirrors the real view. The overlay hosts selection
          // handles and the text-box editor; letting it swallow clicks would make every
          // `slides.elementCenter` click land on a transparent div, which looks exactly
          // like a canvas that stopped hit-testing.
          const overlay = document.createElement("div");
          overlay.style.position = "absolute";
          overlay.style.left = "0";
          overlay.style.top = "0";
          overlay.style.width = `${hostW}px`;
          overlay.style.height = `${hostH}px`;
          overlay.style.pointerEvents = "none";
          wrap.appendChild(overlay);

          container.appendChild(wrap);

          // No pasteboard: `slideOffsetLogicalX/Y` stay at their `0` defaults, so the
          // canvas IS the slide rect. That is what lets `slides.elementCenter` invert
          // `clientToLogical` with the offsets dropped.
          slidesEditor = S.initializeEditor({ canvas, overlay, store, hostWidth: hostW, hostHeight: hostH, dpr });
          if (disposed) return disposeMounted();
          controller.setSlides({ editor: slidesEditor, store, host: container, slideWidth: SLIDE_WIDTH });
          setSlides(slidesEditor);
          setSlidesStore(store);
        } else {
          const store = new MemStore(seedGrid());
          await store.setDimensionSize("column", 1, 110);
          await store.setDimensionSize("column", 2, 160);
          await store.setDimensionSize("column", 3, 180);
          await store.setDimensionSize("column", 4, 260);
          spreadsheet = await initializeSheet(container, { theme: "light", store });
          if (disposed) return disposeMounted();
          await spreadsheet.focusCell({ r: 1, c: 1 });
          controller.setSheet({ spreadsheet, store, host: container });
          setSheet(spreadsheet);
        }
        if (disposed) return disposeMounted();
        // Ready is set LAST, after the surface is mounted and registered. The driver
        // gates on it, so flipping it earlier would let a probe act on a half-built
        // page and record the resulting mess as a defect.
        controller.setReady(true);
        setStatus("ready");
      } catch (error) {
        console.error("[hunt-harness] failed to initialize", error);
        if (!disposed) setStatus("error");
      }
    }

    void mount();

    return () => {
      disposed = true;
      setEditor(null);
      setSheet(null);
      setSlides(null);
      setSlidesStore(null);
      setBoard(null);
      setBoardStore(null);
      controller.dispose();
      // Removes only THIS mount's container; a later mount's container is a sibling
      // this closure never sees, so teardown cannot reach across into it.
      disposeMounted();
    };
  }, [surface, fault]);

  return (
    <main
      className="flex h-screen flex-col overflow-clip bg-muted/20"
      data-testid="hunt-harness-root"
      data-hunt-harness-ready={status === "ready" ? "true" : "false"}
      data-hunt-harness-status={status}
      data-hunt-harness-surface={surface}
      data-hunt-harness-fault={fault ?? "none"}
    >
      <header className="border-b bg-card px-4 py-2">
        <span className="text-xs text-muted-foreground">
          Wafflebase Hunt Harness — surface:{" "}
          <span data-testid="hunt-harness-surface">{surface}</span>, status:{" "}
          <span data-testid="hunt-harness-status">{status}</span>
        </span>
      </header>

      {surface === "doc" && (
        <div className="border-b bg-background" data-testid="hunt-harness-toolbar">
          <DocsFormattingToolbar editor={editor} />
        </div>
      )}

      {/*
        The sheet surface ran without chrome until now, and it showed: every defect this
        hunter has filed came from a TOOLBAR control, and the sheet persona -- asked to
        run the same round-trip shape with no controls to run it through -- produced one
        false finding and one empty run across two live sessions.

        Only `spreadsheet` is required. The optional handlers are deliberately NOT
        supplied: they open panels this harness does not mount, and stubbing them would
        invent behaviour the product does not have. Those buttons therefore render and
        do nothing, which `sheet-author.md` names explicitly -- the same treatment
        `MemStore`'s no-op undo already gets, for the same reason. A trap the brief
        names is a trap; one it does not is a false finding.
      */}
      {surface === "sheet" && (
        <div className="border-b bg-background" data-testid="hunt-harness-toolbar">
          <FormattingToolbar spreadsheet={sheet ?? undefined} />
        </div>
      )}

      {/*
        `onImagePick` is REQUIRED by the toolbar and there is no picker here, so it gets a
        no-op — which makes `Insert image` a control that renders and does nothing. Same
        for the four panel toggles, which are omitted rather than stubbed: opening a panel
        this harness does not mount would invent behaviour the product does not have.

        That is the same treatment the sheet toolbar's optional handlers get, and it has
        the same requirement attached — the brief must NAME them. The sheet persona
        proposed a false finding against exactly this shape until `sheet-author.md` said so
        out loud, and slides has more unwired controls than sheets does. A trap the brief
        names is a trap; one it does not is a defect report.
      */}
      {/*
        `gridKind`/`gridSnap` are REQUIRED and fully controlled — see the state above. The two
        optional callbacks are omitted on purpose, the same treatment the other surfaces'
        optional handlers get: `Insert sticky` and `Insert image` therefore render and do
        nothing, and the rubric names them. Sticky notes being inert is worth saying out loud,
        since they are the feature a board is best known for.
      */}
      {surface === "board" && (
        <div className="border-b bg-background" data-testid="hunt-harness-toolbar">
          <Suspense fallback={null}>
            <BoardToolbarLazy
              editor={board}
              store={boardStore}
              gridKind={gridKind}
              onGridKindChange={setGridKind}
              gridSnap={gridSnap}
              onGridSnapChange={setGridSnap}
            />
          </Suspense>
        </div>
      )}

      {surface === "slides" && (
        <div className="border-b bg-background" data-testid="hunt-harness-toolbar">
          {/*
            No fallback content. The driver gates on `data-hunt-harness-ready`, which the
            effect sets only after the engine has loaded and mounted, so by the time
            anything reads this page the toolbar's chunk has arrived. A placeholder here
            would be a control-shaped thing `dom.controls` could see and offer.
          */}
          <Suspense fallback={null}>
            <SlidesToolbarLazy editor={slides} store={slidesStore} onImagePick={() => {}} />
          </Suspense>
        </div>
      )}

      <section className="min-h-0 flex-1 overflow-hidden bg-white">
        <div className="h-full w-full" data-testid="hunt-harness-host" ref={hostRef} />
      </section>
    </main>
  );
}

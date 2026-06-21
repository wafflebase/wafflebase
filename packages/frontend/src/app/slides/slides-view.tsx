import {
  initializeEditor,
  mountThumbnailPanel,
  mountNotesPanel,
  SLIDES_RULER_SIZE,
  SLIDE_WIDTH,
  SLIDE_HEIGHT,
  type SlidesEditor,
  type ThumbnailPanelHandle,
  type NotesPanelHandle,
} from "@wafflebase/slides";
import { useEffect, useRef, useState } from "react";
import { useDocument } from "@yorkie-js/react";
import { toast } from "sonner";
import { Loader } from "@/components/loader";
import { useTheme } from "@/components/theme-provider";
import type { YorkieSlidesRoot } from "@/types/slides-document";
import type { SlidesPresence } from "@/types/users";
import { SlidesShortcutsHelp } from "./slides-shortcuts-help";
import { clearPendingImport, peekPendingImport } from "./pending-imports";
import { YorkieSlidesStore, ensureSlidesRoot } from "./yorkie-slides-store";
import { mapPresenceToPeerView } from "./peer-view";
import { FIT_ZOOM, type ZoomController } from "./zoom-controller";
import { useGoogleFontsLink } from "@/components/text-formatting/font-catalog";

export type { SlidesEditor } from "@wafflebase/slides";

interface SlidesViewProps {
  /**
   * Document id passed from the route. Currently unused inside the
   * component — Yorkie attach is handled by the surrounding
   * `DocumentProvider` keyed by id — but kept on the prop surface so
   * the parent route can pass it explicitly (matches DocsView).
   */
  documentId?: string;
  /**
   * Reserved for Phase 4b: when true the editor will mount in a
   * non-interactive presenter view. Phase 4a accepts the flag for
   * API parity with `DocsView` but does not act on it yet.
   */
  readOnly?: boolean;
  onEditorReady?: (editor: SlidesEditor | null) => void;
  /**
   * Fires once with the wired-up `YorkieSlidesStore` after the editor
   * mounts, and again with `null` on cleanup. Lets the surrounding
   * shell (theme picker, future side panels) run reads/batches against
   * the same store the editor uses, without each panel building its
   * own Yorkie store wrapper.
   */
  onStoreReady?: (store: YorkieSlidesStore | null) => void;
  /**
   * Invoked when the editor wants to enter present mode — currently
   * driven by Cmd/Ctrl+Enter (from current slide) and Cmd/Ctrl+Shift+
   * Enter (from the first slide). The parent shell owns the present
   * mode UI (Task 7); this prop just routes the editor-level shortcut
   * to it. Captured via a ref so a new callback identity from the
   * parent doesn't remount the editor.
   */
  onStartPresentation?: (from: "current" | "first") => void;
  /**
   * Optional zoom controller. When provided, `refitCanvas` multiplies
   * the fit-to-column size by the controller's value and re-fires
   * whenever it changes. Null / undefined keeps the legacy
   * always-Fit behavior. Owned by the parent shell so the toolbar
   * dropdown and view share state without each rebuilding the other.
   */
  zoomController?: ZoomController | null;
}

// Logical slide aspect (1920×1080 = 16:9). The canvas is sized to fit
// the available width of the right column, preserving this aspect.
const SLIDE_ASPECT = 16 / 9;
const MIN_HOST_W = 320;  // floor so very narrow viewports still paint something usable
const MAX_HOST_W = 1600; // ceiling so on ultra-wide displays we don't paint a 4K bitmap
/**
 * Breathing room (px) between the slide edge and the ruler / canvas-
 * area edge. Without this the slide touches the ruler at zoom-to-fit,
 * which:
 *   - lets the slide's 12-px drop-shadow blur into the ruler ticks
 *   - leaves the slide's 1-px hairline outline overlapping the ruler edge
 * Subtracting this from the available width / height shrinks the slide
 * just enough that the flex centering produces equal padding on every
 * side. `SlidesRuler` keeps its `(frame - host) / 2` offset math —
 * tick "0" still lands on the slide's actual left / top edge.
 */
const SLIDE_FRAME_GAP = 12;

function computeFitSize(availWidth: number, availHeight: number): {
  width: number;
  height: number;
} {
  // Width-binding fit (typical case — the column is shorter than wide).
  const widthFit = {
    width: availWidth,
    height: availWidth / SLIDE_ASPECT,
  };
  if (widthFit.height <= availHeight) return widthFit;
  // Height-binding fallback for tall narrow viewports.
  return {
    width: availHeight * SLIDE_ASPECT,
    height: availHeight,
  };
}

/**
 * SlidesView mounts the vanilla `@wafflebase/slides` editor inside a
 * Yorkie DocumentProvider context. It builds the canvas + overlay +
 * thumbnail + notes DOM hosts into a React-managed container, wires a
 * YorkieSlidesStore to the editor, and broadcasts presence updates on
 * selection / current-slide changes.
 *
 * Mirrors the structure of `docs-view.tsx`: `useDocument` for the
 * Yorkie doc handle, a `didMount` gate to dodge React strict-mode's
 * double mount, and a single mount-time `useEffect` whose cleanup
 * cancels the RAF tick, disposes the thumbnail panel, detaches the
 * editor, unsubscribes presence callbacks, and removes the injected
 * style tag.
 *
 * CJK fonts: the slides text renderer routes inline `fontFamily`
 * values through the docs font registry (see
 * `packages/slides/src/view/canvas/fonts.ts`), which appends
 * `'Noto Sans KR'` to Korean font name fallback chains. No font is
 * fetched here — Canvas relies on the browser's installed fonts plus
 * its own last-resort glyph fallback, matching how the docs editor
 * paints CJK in its live editor today. PDF export (Phase 5b) will
 * preload Noto KR via `document.fonts.load` the same way docs'
 * PDF exporter does.
 */
export function SlidesView({
  documentId,
  readOnly,
  onEditorReady,
  onStoreReady,
  onStartPresentation,
  zoomController,
}: SlidesViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<SlidesEditor | null>(null);
  const [didMount, setDidMount] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { doc, loading, error } = useDocument<YorkieSlidesRoot, SlidesPresence>();
  const readOnlyMount = readOnly === true;

  // Capture the resolved (light|dark) theme into a ref so the mount
  // effect — which doesn't track theme as a dependency — can read the
  // current value when seeding a brand-new deck. Only the value at
  // first-creation time matters; later toggles don't change the deck.
  const { resolvedTheme } = useTheme();
  const resolvedThemeRef = useRef(resolvedTheme);
  resolvedThemeRef.current = resolvedTheme;

  // Capture the latest onStartPresentation in a ref so the editor's
  // Cmd/Ctrl+Enter handler always calls the freshest callback, without
  // adding the prop to the mount effect's deps (which would tear down
  // and rebuild the editor whenever the parent re-renders with a new
  // callback identity).
  const onStartPresentationRef = useRef(onStartPresentation);
  onStartPresentationRef.current = onStartPresentation;

  // Stable ref for the toast callback — wired into the editor at mount time.
  // Using sonner's toast.info directly; the ref prevents stale closure issues.
  const onToastRef = useRef((msg: string) => toast.info(msg));
  onToastRef.current = (msg: string) => toast.info(msg);

  // Prevent double-initialization in React strict mode / dev HMR.
  useEffect(() => {
    setDidMount(true);
  }, []);

  // Inject the Google Fonts `<link>` for read-only / shared-URL viewers
  // that never mount the toolbar. Idempotent across surfaces.
  useGoogleFontsLink();

  useEffect(() => {
    if (!didMount || !doc) return;
    const container = containerRef.current;
    if (!container) return;

    // Consume any PPTX import staged for this document by the deck list
    // BEFORE ensureSlidesRoot runs. Pushing the imported deck into the
    // Yorkie root preempts the empty-deck initializer (which only fires
    // when `root.meta` is null). We peek-then-clear so a thrown update
    // leaves the entry in place for the next mount to retry.
    if (documentId) {
      const pending = peekPendingImport(documentId);
      if (pending) {
        try {
          doc.update((r) => {
            // Carry every optional field forward — `unit` (Format
            // options unit), `pxPerPt` (deck-DPI font scale set by the
            // PPTX importer from `<p:sldSz>`), and anything Meta gains
            // later. Listing them by name dropped silently before; copy
            // the imported meta wholesale instead.
            r.meta = { ...pending.meta };
            r.themes = pending.themes;
            r.masters = pending.masters;
            r.layouts = pending.layouts as unknown as YorkieSlidesRoot["layouts"];
            r.slides = pending.slides as unknown as YorkieSlidesRoot["slides"];
          });
          clearPendingImport(documentId);
        } catch (err) {
          console.error("Failed to apply pending PPTX import", err);
          toast.error(
            err instanceof Error
              ? `Failed to load imported deck: ${err.message}`
              : "Failed to load imported deck.",
          );
        }
      }
    }

    // Known gap (intentional in this PR): `ensureSlidesRoot` may run a
    // `doc.update()` migration block when a viewer mounts an
    // unmigrated pre-v0.5 deck, contradicting the empty-deck-seed
    // policy below. Fixing it properly (gating the migration on a
    // role, or migrating server-side) is owned by the doc-migration
    // workstream — not the share-link toolbar work.
    ensureSlidesRoot(doc, {
      initialThemePreference: resolvedThemeRef.current,
    });

    // Build the canvas + overlay DOM into the container. The slides
    // editor is vanilla DOM, so we hand-build the scaffolding here
    // instead of expressing it as JSX — a future refactor could move
    // this into a `useEditorMount` hook.
    container.innerHTML = "";
    const dpr = window.devicePixelRatio || 1;

    // Width of the left thumbnail panel — persisted to localStorage so
    // the user's resize preference survives reloads. Clamped on read in
    // case storage holds a stale value from a smaller / larger viewport.
    const STORAGE_KEY = "wfb-slides-left-width";
    const MIN_LEFT_W = 120;
    const MAX_LEFT_W = 480;
    const DEFAULT_LEFT_W = 220;
    let leftWidth = (() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const n = raw ? Number.parseInt(raw, 10) : NaN;
        if (!Number.isFinite(n)) return DEFAULT_LEFT_W;
        return Math.min(MAX_LEFT_W, Math.max(MIN_LEFT_W, n));
      } catch {
        return DEFAULT_LEFT_W;
      }
    })();

    const layout = document.createElement("div");
    layout.style.display = "grid";
    // 3 columns: thumbnails | drag handle | canvas. The handle is its
    // own column (no gap) so the cursor change spans the full gutter.
    layout.style.gridTemplateColumns = `${leftWidth}px 6px 1fr`;
    // minmax(0, 1fr) constrains the row height to the parent's height,
    // letting the left column's overflowY actually scroll instead of
    // expanding the grid to fit all thumbnails. min-height: 0 on the
    // grid items themselves is the standard CSS-grid scrollable-child
    // workaround.
    layout.style.gridTemplateRows = "minmax(0, 1fr)";
    layout.style.gap = "0";
    layout.style.padding = "12px";
    layout.style.boxSizing = "border-box";
    layout.style.height = "100%";

    const left = document.createElement("div");
    left.style.overflowY = "auto";
    left.style.minHeight = "0";
    left.style.paddingRight = "12px";
    const thumbsHost = document.createElement("div");
    left.appendChild(thumbsHost);
    layout.appendChild(left);

    // Drag handle between thumbnail panel and canvas. Visually a thin
    // vertical line that grows on hover; functionally drives the
    // leftWidth state on mousedown + mousemove.
    const resizer = document.createElement("div");
    resizer.style.cursor = "col-resize";
    resizer.style.position = "relative";
    resizer.setAttribute("aria-label", "Resize thumbnail panel");
    resizer.setAttribute("role", "separator");
    resizer.setAttribute("aria-orientation", "vertical");
    const resizerLine = document.createElement("div");
    resizerLine.style.position = "absolute";
    resizerLine.style.top = "0";
    resizerLine.style.bottom = "0";
    resizerLine.style.left = "50%";
    resizerLine.style.width = "1px";
    resizerLine.style.background = "var(--border, #4444)";
    resizerLine.style.transform = "translateX(-50%)";
    resizerLine.style.transition = "background 120ms";
    resizer.appendChild(resizerLine);
    resizer.addEventListener("mouseenter", () => {
      resizerLine.style.background = "var(--primary, #3a7)";
      resizerLine.style.width = "2px";
    });
    resizer.addEventListener("mouseleave", () => {
      resizerLine.style.background = "var(--border, #4444)";
      resizerLine.style.width = "1px";
    });
    layout.appendChild(resizer);

    const right = document.createElement("div");
    right.style.paddingLeft = "12px";
    right.style.display = "flex";
    right.style.flexDirection = "column";
    // Gap is 0 so the notes resizer sits flush against the notes panel
    // (mirrors Google Slides' divider treatment). Canvas-area to
    // resizer breathing is provided by the canvas drop shadow itself.
    right.style.gap = "0";
    right.style.minWidth = "0";  // allow the column to shrink + width-fit
    right.style.minHeight = "0";

    // Canvas area: flex-1 column that vertically + horizontally
    // centers the slide canvas inside the remaining space. The rulers
    // sit on the area's top + left edges (NOT around the slide
    // itself), so the slide can drift inside the frame while the
    // ruler stays pinned. Padding-top / padding-left reserve the
    // gutter the ruler occupies before the flex centering kicks in.
    const canvasArea = document.createElement("div");
    canvasArea.style.position = "relative";
    canvasArea.style.flex = "1 1 auto";
    canvasArea.style.minHeight = "0";
    // canvasArea is a positioning container for absolutely-pinned
    // rulers plus an absolutely-sized scroll host. Overflow stays
    // `hidden` so the rulers remain at the viewport edge during scroll
    // — only `scrollHost` (below) gets `overflow: auto`.
    canvasArea.style.overflow = "hidden";

    // Seed the host dimensions before mounting any DOM that references
    // them. `refitCanvas` will replace these on the first
    // ResizeObserver tick; the seed only avoids a 0×0 flash.
    const initial = computeFitSize(MIN_HOST_W, MIN_HOST_W / SLIDE_ASPECT);
    let hostW = initial.width;
    let hostH = initial.height;

    // Ruler DOM: corner square (top-left), horizontal canvas across
    // the top gutter, vertical canvas down the left gutter. All three
    // are absolute to canvasArea so they hug the frame's edges
    // regardless of where the slide ends up inside the centred
    // content box.
    const rulerCorner = document.createElement("div");
    rulerCorner.style.position = "absolute";
    rulerCorner.style.left = "0";
    rulerCorner.style.top = "0";
    rulerCorner.style.width = `${SLIDES_RULER_SIZE}px`;
    rulerCorner.style.height = `${SLIDES_RULER_SIZE}px`;
    rulerCorner.style.zIndex = "3";
    canvasArea.appendChild(rulerCorner);

    // Canvas elements don't expand to fill their containing block from
    // absolute-position `left/right` alone — they fall back to the
    // bitmap intrinsic size (300×150 default). Set explicit
    // width/height in `refitCanvas` below, and seed an initial value
    // here so the first paint isn't a 0×0 sliver in the corner.
    // Rulers sit at z-index 1 (below canvasWrap's z-index 2) so the
    // permanent guide lines — which extend past the slide bounds into
    // the ruler area — paint on top of the ruler ticks instead of
    // disappearing under them. The corner stays at z-index 3 above
    // both; no guide can cross the corner because guides always sit
    // at slide-x ≥ 0, which after centring + padding maps to a frame
    // x well to the right of the corner's 14×14 footprint.
    const hRulerCanvas = document.createElement("canvas");
    hRulerCanvas.style.position = "absolute";
    hRulerCanvas.style.left = `${SLIDES_RULER_SIZE}px`;
    hRulerCanvas.style.top = "0";
    hRulerCanvas.style.width = `${hostW}px`;
    hRulerCanvas.style.height = `${SLIDES_RULER_SIZE}px`;
    hRulerCanvas.style.zIndex = "1";
    canvasArea.appendChild(hRulerCanvas);

    const vRulerCanvas = document.createElement("canvas");
    vRulerCanvas.style.position = "absolute";
    vRulerCanvas.style.left = "0";
    vRulerCanvas.style.top = `${SLIDES_RULER_SIZE}px`;
    vRulerCanvas.style.width = `${SLIDES_RULER_SIZE}px`;
    vRulerCanvas.style.height = `${hostH}px`;
    vRulerCanvas.style.zIndex = "1";
    canvasArea.appendChild(vRulerCanvas);

    // The canvas can grow beyond the slide rect to cover the empty
    // area inside `scrollHost`. That surrounding band becomes the
    // pasteboard — off-slide shapes stay rendered, visible, and
    // pointer-reachable instead of being clipped by a slide-only
    // canvas. The slide rect itself keeps its fit size; the offsets
    // below center it inside `canvasWrap`.
    //
    // Seeded with the initial host size; lockstep updates land in
    // `refitCanvas` below.
    let canvasFullW = hostW;
    let canvasFullH = hostH;
    let slideOffsetCssX = 0;
    let slideOffsetCssY = 0;

    // Canvas + overlay live inside this wrapper. With the pasteboard,
    // the wrapper/canvas can be bigger than the slide rect; the slide
    // rect itself sits at `(slideOffsetCssX, slideOffsetCssY)` and is
    // the same `hostW × hostH` it always was. Off-slide elements
    // paint into the pasteboard band, where pointer events still
    // reach the canvas so selection works. `z-index: 2` pushes the
    // overlay (and the over-sized permanent guide lines inside it)
    // above the ruler canvases at z-index 1 so guides visually
    // connect through the ruler ticks.
    const canvasWrap = document.createElement("div");
    canvasWrap.style.position = "relative";
    canvasWrap.style.zIndex = "2";
    canvasWrap.style.width = `${canvasFullW}px`;
    canvasWrap.style.height = `${canvasFullH}px`;
    // Pasteboard background is intentionally transparent: the band
    // blends into the surrounding workspace (the `scrollHost` /
    // `canvasArea` parents have no explicit background, so the page
    // bg shows through). The slide rect stays visually distinct via
    // `slideElevation`'s drop shadow + hairline (below).
    canvasWrap.style.background = "transparent";

    // Slide elevation: an absolute-positioned transparent div pinned
    // to the slide rect, carrying the 1-px theme-aware hairline and
    // the soft drop shadow as CSS `box-shadow`. Painting the
    // elevation in CSS — rather than as canvas paint inside
    // `drawSlide` — keeps the shadow:
    //   - present in every paint regardless of `slideOffsetLogical`
    //     (so zoom > Fit, with no pasteboard, still shows elevation),
    //   - theme-reactive via the `--foreground` token (the hairline
    //     was load-bearing in dark mode + Simple Dark where the slide
    //     background and workspace background are both near-black),
    //   - constant in CSS-px size regardless of zoom (canvas-painted
    //     shadow would scale with the active `ctx.scale(scale,scale)`).
    //
    // The shadow extends OUTSIDE the elevation div's box — into the
    // pasteboard band — while the canvas (sitting on top in DOM order
    // and opaque inside the slide rect) hides the in-slide portion.
    // Net effect: hairline + drop shadow ring exactly the slide edge.
    const slideElevation = document.createElement("div");
    slideElevation.style.position = "absolute";
    slideElevation.style.left = `${slideOffsetCssX}px`;
    slideElevation.style.top = `${slideOffsetCssY}px`;
    slideElevation.style.width = `${hostW}px`;
    slideElevation.style.height = `${hostH}px`;
    slideElevation.style.pointerEvents = "none";
    slideElevation.style.boxShadow =
      "0 0 0 1px color-mix(in srgb, var(--foreground) 25%, transparent)," +
      " 0 4px 12px rgba(0, 0, 0, 0.08)";
    canvasWrap.appendChild(slideElevation);

    const canvas = document.createElement("canvas");
    canvas.width = canvasFullW * dpr;
    canvas.height = canvasFullH * dpr;
    canvas.style.display = "block";
    canvas.style.width = `${canvasFullW}px`;
    canvas.style.height = `${canvasFullH}px`;
    // The renderer paints the slide background at the slide rect
    // inside the canvas (see `drawSlide` with the
    // `slideOffsetLogicalX/Y` options). Canvas's CSS background stays
    // transparent so the surrounding workspace shows through the
    // off-slide band; slide elevation is owned by `slideElevation`.
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.background = "transparent";
    canvasWrap.appendChild(canvas);

    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.left = `${slideOffsetCssX}px`;
    overlay.style.top = `${slideOffsetCssY}px`;
    overlay.style.width = `${hostW}px`;
    overlay.style.height = `${hostH}px`;
    overlay.style.pointerEvents = "none";
    canvasWrap.appendChild(overlay);

    // Scroll host: covers the canvas-area minus the ruler gutter on
    // the top + left edges. The slide canvas (`canvasWrap`) lives
    // inside this host, centered when it fits and scrollable when the
    // user zooms beyond the column. Keeping the scroll boundary here
    // — rather than on `canvasArea` — lets the rulers stay pinned at
    // the viewport edges; the editor mirrors `scrollLeft`/`scrollTop`
    // into the ruler's tick origin so the ticks track the visible
    // portion of the slide.
    const scrollHost = document.createElement("div");
    scrollHost.style.position = "absolute";
    scrollHost.style.top = `${SLIDES_RULER_SIZE}px`;
    scrollHost.style.left = `${SLIDES_RULER_SIZE}px`;
    scrollHost.style.right = "0";
    scrollHost.style.bottom = "0";
    scrollHost.style.overflow = "auto";
    scrollHost.style.display = "flex";
    // `safe center` keeps the slide centered when it fits the host and
    // falls back to flex-start when it overflows. Without `safe`, the
    // left / top overflow becomes unreachable because justify-content:
    // center pushes the scroll origin past the visible area.
    scrollHost.style.justifyContent = "safe center";
    scrollHost.style.alignItems = "safe center";

    scrollHost.appendChild(canvasWrap);
    canvasArea.appendChild(scrollHost);
    right.appendChild(canvasArea);

    // Notes resizer — horizontal counterpart of the thumbnail-panel
    // divider. Drag up to expand the speaker-notes panel; drag down
    // to shrink it. Visually a hairline at the column edge that
    // thickens on hover, matching the left handle's behavior so the
    // two affordances feel like a set.
    const notesResizer = document.createElement("div");
    notesResizer.style.cursor = "row-resize";
    notesResizer.style.position = "relative";
    notesResizer.style.height = "6px";
    notesResizer.style.flexShrink = "0";
    notesResizer.setAttribute("aria-label", "Resize speaker notes");
    notesResizer.setAttribute("role", "separator");
    notesResizer.setAttribute("aria-orientation", "horizontal");
    const notesResizerLine = document.createElement("div");
    notesResizerLine.style.position = "absolute";
    notesResizerLine.style.left = "0";
    notesResizerLine.style.right = "0";
    notesResizerLine.style.top = "50%";
    notesResizerLine.style.height = "1px";
    notesResizerLine.style.background = "var(--border, #4444)";
    notesResizerLine.style.transform = "translateY(-50%)";
    notesResizerLine.style.transition = "background 120ms";
    notesResizer.appendChild(notesResizerLine);
    notesResizer.addEventListener("mouseenter", () => {
      notesResizerLine.style.background = "var(--primary, #3a7)";
      notesResizerLine.style.height = "2px";
    });
    notesResizer.addEventListener("mouseleave", () => {
      notesResizerLine.style.background = "var(--border, #4444)";
      notesResizerLine.style.height = "1px";
    });
    right.appendChild(notesResizer);

    // Notes height is user-controlled and persisted across reloads.
    // Mirrors the thumbnail-panel width persistence so both
    // dimensions of the editor chrome remember the user's choice.
    const NOTES_STORAGE_KEY = "wfb-slides-notes-height";
    const MIN_NOTES_H = 60;
    const DEFAULT_NOTES_H = 120;
    /** Cap so the canvas always gets ≥ 40 % of the column even with
     * notes maxed out. Re-evaluated against the current column height
     * during each drag tick (not just the initial value). */
    const MAX_NOTES_H_RATIO = 0.6;
    let notesHeight = (() => {
      try {
        const raw = window.localStorage.getItem(NOTES_STORAGE_KEY);
        const n = raw ? Number.parseInt(raw, 10) : NaN;
        if (!Number.isFinite(n)) return DEFAULT_NOTES_H;
        return Math.max(MIN_NOTES_H, n);
      } catch {
        return DEFAULT_NOTES_H;
      }
    })();

    const notesHost = document.createElement("div");
    notesHost.style.height = `${notesHeight}px`;
    notesHost.style.flexShrink = "0";
    notesHost.style.overflow = "auto";
    right.appendChild(notesHost);

    layout.appendChild(right);
    container.appendChild(layout);

    // Inject pointer-events for handles (overlay-level CSS). The
    // overlay itself uses pointer-events: none so empty-area clicks
    // pass through to the canvas; handle children opt back in.
    const style = document.createElement("style");
    style.textContent = "[data-handle] { pointer-events: auto !important; }";
    document.head.appendChild(style);

    const store = new YorkieSlidesStore(doc);
    // Brand-new presentations land here with `slides: []`. The editor's
    // `render()` bails out when no current slide exists, so without this
    // seed the canvas would stay blank until the user clicked the
    // "+ Slide" toolbar button. Seeding once on first mount matches
    // Google Slides' "new deck always opens with one slide" UX.
    //
    // Skipped when this mount is read-only — share-link viewers must
    // never write to the deck, and a viewer arriving before the owner
    // has saved the first slide should see an empty canvas rather
    // than mutating the doc on their behalf.
    if (!readOnlyMount && store.read().slides.length === 0) {
      store.batch(() => store.addSlide("blank"));
    }
    // Late-bound thumbnail handle. `mountThumbnailPanel` runs further
    // down (after the editor and the resize/notes wiring), but the
    // editor's `onFontsLoaded` callback fires from a document.fonts
    // event that can land at any later tick. Capturing a `let` lets
    // that closure read whichever value the assignment below has
    // installed by the time the event arrives.
    let thumbHandle: ThumbnailPanelHandle | null = null;
    let notesHandle: NotesPanelHandle | null = null;
    const editor = initializeEditor({
      canvas,
      overlay,
      store,
      hostWidth: hostW,
      hostHeight: hostH,
      dpr,
      // Slide offset inside the (potentially bigger) canvas. Seeded
      // to 0; updated on every `refitCanvas` once the scroll host's
      // size is known.
      slideOffsetLogicalX: 0,
      slideOffsetLogicalY: 0,
      readOnly: readOnlyMount,
      hRulerCanvas,
      vRulerCanvas,
      rulerCorner,
      bodyHost: scrollHost,
      onShowShortcutsHelp: () => setHelpOpen(true),
      onStartPresentation: (from) => onStartPresentationRef.current?.(from),
      onToast: (msg) => onToastRef.current(msg),
      // The editor clears the shared cachedMeasureText and repaints the
      // main canvas; we also repaint already-painted thumbnails so
      // their pre-font-load fallback widths stop showing through.
      onFontsLoaded: () => thumbHandle?.refreshContent(),
      // onLinkRequest is still intentionally unwired — the link popover
      // needs a richer TextBoxEditorAPI (insertLink / getLinkAtCursor)
      // before it can drive the docs text-box. Cmd+K no-ops at the
      // editor level until then.
    });
    editorRef.current = editor;
    onEditorReady?.(editor);
    onStoreReady?.(store);

    // Refit canvas to the right column, taking the current notes height
    // into account. Extracted into a function because two paths call
    // it: the ResizeObserver below, and the notes-drag handler (where
    // `notesHeight` changes without `right`'s own size changing).
    const refitCanvas = () => {
      const rightRect = right.getBoundingClientRect();
      // Re-clamp notesHeight against the live column cap. The drag
      // handler enforces MAX_NOTES_H_RATIO while the divider is being
      // dragged, but a height restored from localStorage or a window
      // resize would otherwise let the notes panel exceed the cap
      // until the next user drag.
      const maxNotesH = Math.max(
        MIN_NOTES_H,
        Math.floor(rightRect.height * MAX_NOTES_H_RATIO),
      );
      if (notesHeight > maxNotesH) {
        notesHeight = maxNotesH;
        notesHost.style.height = `${notesHeight}px`;
      }
      // Notes section reserves its own height + the 6 px resizer.
      const reservedBelow = notesHeight + 6;
      const availW = Math.max(MIN_HOST_W, Math.min(MAX_HOST_W, rightRect.width));
      const availH = Math.max(
        MIN_HOST_W / SLIDE_ASPECT,
        rightRect.height - reservedBelow,
      );
      // Reserve the ruler gutter so the slide canvas itself never
      // overflows the right column, plus a SLIDE_FRAME_GAP on both
      // sides so the slide elevation doesn't bleed into the rulers.
      const slideAvailW = Math.max(
        MIN_HOST_W,
        availW - SLIDES_RULER_SIZE - SLIDE_FRAME_GAP * 2,
      );
      const slideAvailH = Math.max(
        MIN_HOST_W / SLIDE_ASPECT,
        availH - SLIDES_RULER_SIZE - SLIDE_FRAME_GAP * 2,
      );
      // Fit and absolute zoom (N %) are two different sizing models:
      //
      //   FIT_ZOOM → the host fills the available column, preserving
      //              the slide aspect. MAX_HOST_W still clamps on
      //              ultra-wide displays so a 4K column does not
      //              allocate a 4K bitmap.
      //
      //   N %      → the host equals the slide's *logical* size times
      //              the zoom factor. 100 % == 1920 × 1080 CSS px
      //              regardless of the column width. canvasArea's
      //              overflow:auto produces horizontal + vertical
      //              scroll when the host exceeds the available area.
      //
      // No MAX_HOST_W clamp at non-Fit zoom — the user is asking for an
      // absolute size and the slide must read at exactly that size.
      const userZoom = zoomController?.get() ?? FIT_ZOOM;
      let nextW: number;
      let nextH: number;
      if (userZoom === FIT_ZOOM) {
        const fit = computeFitSize(slideAvailW, slideAvailH);
        const clampedW = Math.min(MAX_HOST_W, Math.round(fit.width));
        const scale = fit.width > 0 ? clampedW / fit.width : 1;
        nextW = clampedW;
        nextH = Math.round(fit.height * scale);
      } else {
        nextW = Math.round(SLIDE_WIDTH * userZoom);
        nextH = Math.round(SLIDE_HEIGHT * userZoom);
      }

      // Pin each ruler canvas to the full frame extent — canvas
      // elements don't pick up a width from `left + right` alone, so
      // they need explicit CSS dimensions. Updated unconditionally so
      // that a notes-drag (canvasArea height changes, host doesn't)
      // still refreshes the vertical ruler.
      const areaRect = canvasArea.getBoundingClientRect();
      const rulerHCss = Math.max(0, Math.round(areaRect.width - SLIDES_RULER_SIZE));
      const rulerVCss = Math.max(0, Math.round(areaRect.height - SLIDES_RULER_SIZE));
      hRulerCanvas.style.width = `${rulerHCss}px`;
      vRulerCanvas.style.height = `${rulerVCss}px`;

      // Pasteboard band: grow `canvasWrap` to fill `scrollHost` when
      // there is surrounding empty area, so off-slide shapes paint
      // into the same canvas the slide does and stay reachable for
      // pointer events. At zoom > Fit the slide overflows
      // `scrollHost`; canvasWrap stays exactly slide-sized so the
      // existing scroll behaviour is preserved (no extra pasteboard,
      // off-slide shapes clipped — acceptable limitation; the user
      // can drop to Fit to recover them).
      const scrollRect = scrollHost.getBoundingClientRect();
      const nextCanvasW = Math.max(nextW, Math.floor(scrollRect.width));
      const nextCanvasH = Math.max(nextH, Math.floor(scrollRect.height));
      // `Math.floor` over `/ 2` so the offset is always an integer CSS
      // px. A fractional offset (e.g. 0.5) would sub-pixel-position
      // both the elevation div and the overlay, AA-blurring the slide
      // hairline and risking 1-px misalignment between canvas paint
      // (browser handles sub-pixel) and absolute children (UA-rounded).
      const nextOffsetX = Math.floor((nextCanvasW - nextW) / 2);
      const nextOffsetY = Math.floor((nextCanvasH - nextH) / 2);
      const sameSlide = nextW === hostW && nextH === hostH;
      const sameCanvas =
        nextCanvasW === canvasFullW && nextCanvasH === canvasFullH;
      // Resync the ruler even when sizes match: a right-pane resize
      // (devtools open/close, sidebar collapse, notes-pane drag) can
      // shrink scrollHost without changing the canvas, leaving the
      // browser to clamp `scrollLeft` / `scrollTop` silently. No
      // scroll event fires for that clamp, so without this call the
      // ruler tick origin lags behind the actual viewport until the
      // next user scroll.
      editor.setRulerScroll(scrollHost.scrollLeft, scrollHost.scrollTop);
      if (sameSlide && sameCanvas) return;
      hostW = nextW;
      hostH = nextH;
      canvasFullW = nextCanvasW;
      canvasFullH = nextCanvasH;
      slideOffsetCssX = nextOffsetX;
      slideOffsetCssY = nextOffsetY;
      canvas.width = canvasFullW * dpr;
      canvas.height = canvasFullH * dpr;
      canvas.style.width = `${canvasFullW}px`;
      canvas.style.height = `${canvasFullH}px`;
      slideElevation.style.left = `${slideOffsetCssX}px`;
      slideElevation.style.top = `${slideOffsetCssY}px`;
      slideElevation.style.width = `${hostW}px`;
      slideElevation.style.height = `${hostH}px`;
      overlay.style.left = `${slideOffsetCssX}px`;
      overlay.style.top = `${slideOffsetCssY}px`;
      overlay.style.width = `${hostW}px`;
      overlay.style.height = `${hostH}px`;
      canvasWrap.style.width = `${canvasFullW}px`;
      canvasWrap.style.height = `${canvasFullH}px`;
      editor.setHostSize(hostW, hostH);
      const scaleCssPerLogical = hostW / SLIDE_WIDTH;
      editor.setSlideOffset(
        slideOffsetCssX / scaleCssPerLogical,
        slideOffsetCssY / scaleCssPerLogical,
      );
      // After a size change the browser may or may not emit a scroll
      // event (e.g. shrinking back to Fit clamps scrollLeft to 0
      // implicitly). Sync the ruler explicitly so its tick origin
      // tracks the current scroll position even when no scroll event
      // fires.
      editor.setRulerScroll(scrollHost.scrollLeft, scrollHost.scrollTop);
    };

    // Auto-fit the canvas to the right column. Re-fits on ResizeObserver
    // ticks (window resize, sidebar collapse, devtools open). Caps at
    // MAX_HOST_W so we don't paint a 4K bitmap on ultra-wide displays
    // — the slide is logically 1920×1080 anyway.
    const resizeObserver = new ResizeObserver(() => refitCanvas());
    resizeObserver.observe(right);

    // Re-fit on zoom changes from the toolbar dropdown. The controller
    // identity is stable (parent owns it via ref), so subscribing once
    // at mount is sufficient.
    const unsubscribeZoom =
      zoomController?.subscribe(() => refitCanvas()) ?? (() => {});

    // Mirror the scroll host's scroll offset into the editor's ruler.
    // The ruler is pinned at the canvas-area edges (so it stays visible
    // during scroll), but its tick origin needs to track the slide's
    // viewport position — without this the "0" tick stops aligning
    // with the slide's left edge after the user pans.
    const onScrollHostScroll = () => {
      editor.setRulerScroll(scrollHost.scrollLeft, scrollHost.scrollTop);
    };
    scrollHost.addEventListener("scroll", onScrollHostScroll, { passive: true });

    // Drag-to-resize the left column. Mousedown latches; mousemove
    // updates leftWidth (clamped + rounded); mouseup persists to
    // localStorage. Listeners attach to document so the drag continues
    // even if the cursor leaves the handle.
    let dragging = false;
    let dragStartX = 0;
    let dragStartLeft = 0;
    // Notes drag is a sibling state machine — single document
    // mousemove / mouseup pair routes both gestures.
    let draggingNotes = false;
    let dragStartY = 0;
    let dragStartNotesH = 0;
    const onResizerDown = (e: MouseEvent) => {
      e.preventDefault();
      dragging = true;
      dragStartX = e.clientX;
      dragStartLeft = leftWidth;
      // Lock the cursor and disable user-select so text in the panel
      // doesn't get selected during a drag.
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };
    const onNotesResizerDown = (e: MouseEvent) => {
      e.preventDefault();
      draggingNotes = true;
      dragStartY = e.clientY;
      dragStartNotesH = notesHeight;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    };
    const onDocMouseMove = (e: MouseEvent) => {
      if (dragging) {
        const next = Math.min(
          MAX_LEFT_W,
          Math.max(MIN_LEFT_W, dragStartLeft + (e.clientX - dragStartX)),
        );
        if (next === leftWidth) return;
        leftWidth = next;
        layout.style.gridTemplateColumns = `${leftWidth}px 6px 1fr`;
        return;
      }
      if (draggingNotes) {
        const rightRect = right.getBoundingClientRect();
        // Cap notes at MAX_NOTES_H_RATIO of the column so the canvas
        // always gets the remaining 40 %+. Re-evaluated each tick so
        // dragging works even after a window resize.
        const maxH = Math.max(
          MIN_NOTES_H,
          Math.floor(rightRect.height * MAX_NOTES_H_RATIO),
        );
        // Drag UP (cursor moves up the screen) ⇒ notes grow taller.
        const next = Math.min(
          maxH,
          Math.max(MIN_NOTES_H, dragStartNotesH - (e.clientY - dragStartY)),
        );
        if (next === notesHeight) return;
        notesHeight = next;
        notesHost.style.height = `${notesHeight}px`;
        // The right column's outer height didn't change, so the
        // ResizeObserver won't fire. Re-fit manually so the canvas
        // shrinks / grows in step with the notes panel.
        refitCanvas();
      }
    };
    const onDocMouseUp = () => {
      if (dragging) {
        dragging = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try {
          window.localStorage.setItem(STORAGE_KEY, String(leftWidth));
        } catch {
          /* ignore quota / privacy-mode failures */
        }
        return;
      }
      if (draggingNotes) {
        draggingNotes = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try {
          window.localStorage.setItem(NOTES_STORAGE_KEY, String(notesHeight));
        } catch {
          /* ignore quota / privacy-mode failures */
        }
      }
    };
    resizer.addEventListener("mousedown", onResizerDown);
    notesResizer.addEventListener("mousedown", onNotesResizerDown);
    document.addEventListener("mousemove", onDocMouseMove);
    document.addEventListener("mouseup", onDocMouseUp);

    thumbHandle = mountThumbnailPanel(
      thumbsHost,
      store,
      editor,
      { readOnly: readOnlyMount },
    );
    notesHandle = mountNotesPanel(notesHost, store, editor, {
      readOnly: readOnlyMount,
    });

    // Re-render on ANY store change — local batch commits OR remote
    // changes pushed in by another peer.
    //
    // markDirty before render is required because the renderer's
    // dirty flag is reset after each successful paint, so a remote
    // change wouldn't otherwise trigger a repaint (the editor doesn't
    // know the underlying data shifted under it). markDirty is also
    // safe to call after local edits — the next render is a no-op if
    // the renderer already painted the same frame.
    //
    // thumbHandle.refreshContent() picks up content edits (drag,
    // resize, color, text) on any slide without rebuilding the panel
    // DOM — full refresh() is reserved for structural changes (slide
    // add/remove), driven by the rAF tick's count check below. The
    // distinction matters because every refresh() wipes the canvas
    // bitmaps and the IntersectionObserver, causing a one-frame blank
    // flicker across the whole panel — visible every time the user
    // moves a shape if it's the wrong tool.
    // Push the current set of peers into the editor overlay (selection
    // rings, live drag frames, guide previews). Recomputed from the
    // resolved theme each call so peer colours follow light/dark.
    const pushPeers = () => {
      editor.setPeers(
        mapPresenceToPeerView(store.getPeers(), resolvedThemeRef.current),
      );
    };

    const offChange = store.onChange(() => {
      editor.markDirty();
      editor.render();
      thumbHandle?.refreshContent();
      // A peer's selection rings track elements they (or anyone) moved,
      // so refresh peer chrome on document changes too — not just on the
      // presence channel below.
      pushPeers();
    });

    // Presence rides a separate Yorkie channel from document changes, so
    // subscribe to it explicitly; otherwise a peer selecting / dragging
    // (without mutating the document) would not refresh their rings.
    const offPeers = store.onPresenceChange(pushPeers);
    // Seed once so peers already present at mount render immediately.
    pushPeers();

    // Local presence: broadcast active slide + selection. Yorkie's
    // Presence.set merges (does not replace), so we pass ONLY the
    // slides-specific fields. The username/email/photo were seeded by
    // SlidesDetail via `initialPresence` and stay intact across these
    // partial updates.
    const broadcast = () => {
      store.updatePresence({
        activeSlideId: editor.getCurrentSlideId(),
        selectedElementIds: editor.getSelection().slice(),
      });
    };
    const offSelection = editor.onSelectionChange(broadcast);
    const offSlide = editor.onCurrentSlideChange(broadcast);

    // RAF loop so async asset loads (image cache) repaint, and
    // thumbnail count stays in sync with store mutations the panel
    // doesn't observe directly. Use the O(1) `getSlideCount()`
    // accessor for the count comparison — `store.read()` here would
    // JSON-clone the whole presentation 60 times per second, scaling
    // linearly with deck size and stressing the GC at idle.
    let lastSlideCount = store.getSlideCount();
    let raf = 0;
    const tick = () => {
      editor.render();
      const n = store.getSlideCount();
      if (n !== lastSlideCount) {
        lastSlideCount = n;
        thumbHandle?.refresh();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      resizeObserver.disconnect();
      unsubscribeZoom();
      scrollHost.removeEventListener("scroll", onScrollHostScroll);
      document.removeEventListener("mousemove", onDocMouseMove);
      document.removeEventListener("mouseup", onDocMouseUp);
      // If the user navigated mid-drag, restore body cursor / select.
      if (dragging || draggingNotes) {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
      cancelAnimationFrame(raf);
      offSelection();
      offSlide();
      offChange();
      offPeers();
      thumbHandle?.dispose();
      notesHandle?.dispose();
      editor.detach();
      store.dispose();
      editorRef.current = null;
      onEditorReady?.(null);
      onStoreReady?.(null);
      style.remove();
    };
    // onEditorReady / onStoreReady are intentionally excluded — re-mounting
    // on every identity change of the parent's setter would tear down the
    // editor. `readOnlyMount` is also excluded: it is derived from a share-
    // link role that is fixed for the lifetime of the route, so toggling
    // it at runtime is not a supported scenario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [didMount, doc]);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-red-500">{error.message}</div>
      </div>
    );
  }

  return (
    <>
      <div ref={containerRef} className="relative flex-1 w-full min-h-0" />
      <SlidesShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}

export default SlidesView;

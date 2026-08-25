/**
 * The host side of the scene frame: the iframe, its viewport, and the protocol.
 *
 * WHY EVERY SIZE HERE IS REAL, UNSCALED PIXELS. A breakpoint is decided by the
 * frame's own width, so the frame has to BE 390px wide for `matchMedia` to agree —
 * not 1280px painted small. Zoom is therefore `transform: scale()` on a wrapper and
 * never a width change, and the iframe always gets an EXPLICIT pixel box rather than
 * a percentage, so `scale()` has an unambiguous size to scale from.
 *
 * PORTED FROM `design-sdk/src/scenes/SceneHost.tsx`. Three couplings §6 lists are
 * gone: `cn` now comes from the shell's own `lib/cn.ts`, the zoom dropdown from the
 * shell's own `ui/select.tsx` (a native `<select>` — measured, there is exactly ONE
 * `<Select>` in this file, not the 25 §6 claimed), and the theme sync no longer speaks
 * wafflebase's `{type:'theme-change'}` provider protocol.
 *
 * THE THEME CHANNEL IS THE ONE BEHAVIOUR CHANGE. The prototype posted
 * `{type:'theme-change'}` because wafflebase's own `ThemeProvider` already listened for
 * it — built for the homepage's demo iframe. A generic consumer has no such listener, so
 * that message would vanish and the frame would stay in whatever theme it loaded with.
 * The frame's theme is now baked into its URL (`sceneFrameUrl`'s `theme`), which is
 * already how it pre-paints, and `dark` is part of the iframe `key` so flipping it
 * reloads. A reload is heavier than a message and it is the only mechanism that works
 * without assuming anything about the consumer's app.
 *
 * `lucide-react` is bundled into the shell for the seven icons. Unlike the Radix
 * primitives — behaviour this file needed 30 lines of, not a library — icons are
 * irreducible artwork, and hand-drawing them from memory is how you ship a wrong path.
 * It tree-shakes to the seven and never reaches the consumer.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  AlertTriangle,
  Database,
  Monitor,
  MousePointerSquareDashed,
  RotateCw,
  Smartphone,
  Tablet,
} from 'lucide-react';
import { cn } from '../lib/cn.ts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.tsx';
import {
  VIEWPORT_WIDTH,
  isFrameMessage,
  sceneFrameUrl,
  componentFrameUrl,
  type FrameMessage,
  type FrameRect,
  type FrameSide,
  type HostMessage,
  type StampRef,
  type ViewportKey,
} from '../../scenes/frame-protocol.ts';

/**
 * Live scene frames, counted.
 *
 * A scene mounts real product code, and in a consumer with a canvas engine a real
 * engine instance with it. Two full instances in one tab is an OOM hazard on ordinary
 * hardware, so "exactly one live scene in steady state" is an invariant rather than a
 * preference. A leaked frame surfaces as a warning during development instead of as a
 * crash an hour later.
 */
let liveFrames = 0;

export interface SceneHostProps {
  sceneId: string;
  side?: FrameSide;
  dark: boolean;
  /** Classes the frame rendered, for Tailwind candidate registration. */
  onClasses?: (classes: string[]) => void;
  onSelect?: (node: StampRef) => void;
  /**
   * Hover in the FRAME → highlight the matching outline row. The reverse direction is
   * `hoverId`; without both, the two views agree only half the time and the outline
   * looks unresponsive to the thing you are pointing at.
   */
  onHover?: (node: StampRef | null) => void;
  /** Clicking the gutter around the frame clears the selection. */
  onDeselect?: () => void;
  /**
   * The frame navigated (picking OFF) to a path other than its own scene's route — the
   * host resolves it against the manifest and switches scenes.
   */
  onRouteChange?: (path: string) => void;
  /**
   * The selected node's rect, re-requested whenever `selectedId` changes. `null` means
   * the frame has no element for this id right now — zero instances, or every instance
   * `display: none` (a collapsed accordion, an inactive tab panel) — as distinct from
   * merely scrolled off-screen, which `wb:set-selection` already scrolls back into view.
   */
  onMeasured?: (rect: FrameRect | null) => void;
  /**
   * The same rect in HOST-PAGE pixels — what a floating panel anchors to. Recomputed on
   * every input that can move the on-screen box (a fresh measurement, a zoom change, the
   * pane scrolling or resizing), not once per selection, so the panel tracks the node
   * instead of drifting from it.
   */
  onSelectionHostRect?: (
    rect: { left: number; top: number; width: number; height: number } | null,
  ) => void;
  onReady?: (selectable: string[]) => void;
  /** Set when the frame reported a compile error — the host offers an undo. */
  onCompileError?: (message: string) => void;
  /** Driven from the outline panel — highlights and scrolls to a node. */
  selectedId?: string | null;
  hoverId?: string | null;
  /**
   * Live token overrides as CSS custom properties. An inline `style` cannot cross a
   * frame boundary, so the frame installs them as a real `:root` rule instead. Without
   * this, staging a token edit repaints the shell's own preview and leaves every scene
   * untouched.
   */
  tokenVars?: Record<string, string>;
  /**
   * The Mock Data toggle — every array in every fixture becomes `[]`, so an empty state
   * can be checked without hand-authoring a second fixture set. Read by the frame once
   * at load, so it is baked into the iframe's `key` rather than sent live.
   */
  mockDataEmpty?: boolean;
  onMockDataEmptyChange?: (empty: boolean) => void;
  /**
   * Show ONE COMPONENT across its variants instead of the scene.
   *
   * Absent means the scene; present replaces what the frame mounts and nothing else —
   * the picker, the guard and the token channel are the same either way.
   */
  preview?: {
    file: string;
    component: string;
    axes: Record<string, string[]>;
    /** Classes that force an interaction state, already stripped of their modifier. */
    forced?: string;
    /** The interaction states this component authors — the only ones worth offering. */
    states: string[];
    forcedState: string | null;
    /** Children for the preview. Empty falls back to the component's own name. */
    label?: string;
    /** Every value of every axis — the chooser, where `axes` is the choice. */
    allAxes?: Record<string, string[]>;
    mockProps?: Record<string, unknown>;
    noopProps?: string[];
    /** Where a stand-in glyph sits inside the component, and which one. */
    iconSlot?: string;
    icon?: string;
  };
  onVariantChange?: (axis: string, value: string) => void;
  onForcedStateChange?: (state: string | null) => void;
}

interface FrameError {
  /** `stream` is a REFUSED EventSource — the guard working, not a missing fixture. */
  kind: 'mount' | 'render' | 'compile' | 'fetch' | 'stream';
  message: string;
  url?: string;
}

const VIEWPORTS: { key: ViewportKey; icon: typeof Monitor; label: string }[] = [
  { key: 'mobile', icon: Smartphone, label: '390px' },
  { key: 'tablet', icon: Tablet, label: '768px' },
  { key: 'desktop', icon: Monitor, label: 'Fill' },
];

const ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

/** Positive modulo — `-3 % 16` is `-3` in JS, and a grid offset must not go backwards. */
const mod = (a: number, n: number) => (n > 0 ? ((a % n) + n) % n : 0);
const MIN_SIZE = 240;

export function SceneHost({
  sceneId,
  side = 'after',
  dark,
  onClasses,
  onSelect,
  onHover,
  onDeselect,
  onRouteChange,
  onMeasured,
  onSelectionHostRect,
  onReady,
  onCompileError,
  selectedId = null,
  hoverId = null,
  tokenVars,
  mockDataEmpty = false,
  onMockDataEmptyChange,
  preview,
  onForcedStateChange,
  onVariantChange,
}: SceneHostProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<ViewportKey>('desktop');
  const [zoom, setZoom] = useState(1);
  /**
   * A DevTools-style freeform override, dragged from the handles on the stage's edges.
   * `null` means "use the preset" — set on drag, cleared by picking a preset, so the two
   * controls never fight over which is authoritative. Stored in the same real, unscaled
   * px this component insists on.
   */
  const [customSize, setCustomSize] = useState<{ width: number; height: number } | null>(null);
  /**
   * The pane's own size in real px, because the iframe always gets an explicit pixel box.
   * Only "fill" depends on the width; every viewport needs the HEIGHT, since nothing else
   * supplies one.
   */
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  /**
   * Pan offset for the component preview, in unscaled pixels.
   *
   * Scenes do not pan: a page is anchored to its viewport and dragging it away from the
   * top-left loses the thing being judged. A component is one object on a ground, and
   * moving it is how you look at it against different parts of that ground.
   */
  const [pan, setPan] = useState({ x: 0, y: 0 });

  /** Live zoom for the message handler, which is registered once and must not close over it. */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  /**
   * The content point a zoom must leave where it was, and where that was on screen.
   * Consumed by the layout effect below, which is the whole of the cursor-anchoring.
   */
  const zoomAnchor = useRef<{ fx: number; fy: number; hx: number; hy: number } | null>(null);

  /**
   * ONE PAN COMMIT PER FRAME.
   *
   * `pointermove` fires faster than the compositor draws, and each message was its own
   * `setPan` — so a drag queued several full re-renders of this pane per frame and the
   * canvas stuttered under the cursor. Accumulating the deltas and flushing once per
   * animation frame drops that to one, and loses nothing: the intermediate positions
   * were never painted anyway.
   */
  const panQueue = useRef({ dx: 0, dy: 0, raf: 0 });
  const queuePan = useCallback((dx: number, dy: number) => {
    const q = panQueue.current;
    q.dx += dx;
    q.dy += dy;
    if (q.raf) return;
    q.raf = requestAnimationFrame(() => {
      q.raf = 0;
      const { dx: ax, dy: ay } = q;
      q.dx = 0;
      q.dy = 0;
      setPan((prev) => ({ x: prev.x + ax, y: prev.y + ay }));
    });
  }, []);
  useEffect(
    () => () => {
      if (panQueue.current.raf) cancelAnimationFrame(panQueue.current.raf);
    },
    [],
  );
  const [error, setError] = useState<FrameError | null>(null);
  /** Refused EventSources, by URL. Expected behaviour, reported rather than raised. */
  const [streams, setStreams] = useState<string[]>([]);
  const [nonce, setNonce] = useState(0);
  /**
   * Picking ON suppresses the product's own click handlers so a click selects a node;
   * picking OFF hands clicks back so the interaction can be exercised. Both are needed
   * and they cannot coexist: a click on a link is either a selection or a navigation.
   * Making it a visible mode is honest about that, where a modifier key would have half
   * the clicks in a session do the wrong thing.
   */
  const [picking, setPicking] = useState(true);
  /**
   * What `picking` was before the frame's bug reporter armed, or `null` when no
   * report is being aimed. See the `wb:debug-report` case below.
   */
  const pickingBeforeReport = useRef<boolean | null>(null);
  /**
   * `picking`, readable from the frame-message listener.
   *
   * THROUGH A REF, NOT A DEPENDENCY. That listener's dependency array is
   * deliberately made of stable callbacks — adding `picking` would re-subscribe
   * the whole channel every time the mode is toggled. Read out of the closure
   * instead, the value would be whatever it was when the effect last ran, so
   * toggling to Use and then arming the reporter would have remembered `true`
   * and put Pick mode back on the way out.
   */
  const pickingRef = useRef(picking);
  pickingRef.current = picking;

  /** One place that knows the frame's origin rule. */
  const post = useCallback((msg: HostMessage) => {
    frameRef.current?.contentWindow?.postMessage(msg, window.location.origin);
  }, []);

  /**
   * Ignore a `wb:measured` reply that arrives after a NEWER request went out — selecting
   * node B while node A's reply is in flight must not land A's rect as B's answer.
   */
  const measureNonceRef = useRef(0);

  /**
   * The last FRAME-LOCAL rect for the current selection, so a scroll or zoom can
   * recompute the host rect without round-tripping: scrolling the pane moves where the
   * frame sits on the host page, not where the node sits inside the frame's document.
   *
   * KNOWN GAP: if the node scrolls inside the frame's OWN scroll container without the
   * selection changing, this goes stale until the next measurement. Only the frame knows
   * about that scroll and nothing re-requests one on a timer.
   */
  const lastFrameRectRef = useRef<FrameRect | null>(null);

  const recomputeHostRect = useCallback(() => {
    const frameRect = lastFrameRectRef.current;
    const frameEl = frameRef.current;
    if (!frameRect || !frameEl) {
      onSelectionHostRect?.(null);
      return;
    }
    // `getBoundingClientRect` on the IFRAME already reflects host scroll and the
    // `scale()` transform — it is the painted box, not the declared CSS size — so the
    // only extra scaling needed is for the frame-local rect, measured inside the frame's
    // own unscaled document.
    const frameBox = frameEl.getBoundingClientRect();
    onSelectionHostRect?.({
      left: frameBox.left + frameRect.x * zoom,
      top: frameBox.top + frameRect.y * zoom,
      width: frameRect.width * zoom,
      height: frameRect.height * zoom,
    });
  }, [zoom, onSelectionHostRect]);

  /**
   * Reload from scratch. Distinct from an HMR update: this is the "the scene wedged,
   * start over" affordance, and it is how a scene switch gets a clean realm rather than
   * a half-torn-down one.
   */
  const reload = useCallback(() => {
    setReady(false);
    setError(null);
    setStreams([]);
    setNonce((n) => n + 1);
  }, []);

  // The pane's real size. `stageRef` is the scroll container, not the iframe: measuring
  // the iframe would be circular once it is sized from this value.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // Rounded and skipped when unchanged: sub-pixel measurement noise would otherwise
      // re-trigger `setState` on every observation with no visible size change.
      setStage((prev) => {
        const next = { width: Math.round(width), height: Math.round(height) };
        return prev.width === next.width && prev.height === next.height ? prev : next;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Switching scenes replaces the iframe (keyed on `sceneId`), but `ready` is host state
  // and would still say `true` from the outgoing frame. Every host→frame effect below is
  // gated on it, so leaving it set means the new frame's selection, picking mode and
  // token vars are posted into a window that has not installed its listener yet — and
  // then never re-posted.
  useEffect(() => {
    setReady(false);
    setError(null);
    setStreams([]);
  }, [sceneId, side]);

  useEffect(() => {
    liveFrames += 1;
    if (liveFrames > 1) {
      // `console.warn` is allowed by the lint config: the shell has no other channel for a
      // developer-facing invariant breach, and silence is what turns this into an OOM.
      console.warn(
        `[design-editor] ${liveFrames} scene frames are mounted. Exactly one is expected ` +
          `outside a diff view — a leaked frame keeps a whole app instance alive.`,
      );
    }
    return () => {
      liveFrames -= 1;
    };
  }, []);

  // Frame → host. Origin-checked, source-checked, and filtered to our own shapes: the
  // same window receives Vite's HMR chatter and anything else on the page.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.source !== frameRef.current?.contentWindow) return;
      if (!isFrameMessage(e.data)) return;
      const msg = e.data as FrameMessage;
      switch (msg.type) {
        case 'wb:ready':
          setReady(true);
          setError(null);
          onReady?.(msg.selectable);
          break;
        case 'wb:error':
          /*
           * A REFUSED STREAM IS NOT AN ERROR STATE. The guard turning an EventSource away
           * is the guard working, and routing it here put a full-bleed red overlay over a
           * scene that had rendered perfectly — the one failure mode that teaches you to
           * dismiss the overlay without reading it, which is exactly when a real fetch
           * miss goes unnoticed. It is still worth SEEING, so it lands in a quiet line on
           * the toolbar instead of replacing the scene.
           */
          if (msg.kind === 'stream') {
            setStreams((prev) => (prev.includes(msg.url ?? '') ? prev : [...prev, msg.url ?? '']));
            break;
          }
          setError({ kind: msg.kind, message: msg.message, url: msg.url });
          if (msg.kind === 'compile') onCompileError?.(msg.message);
          break;
        case 'wb:classes':
          onClasses?.(msg.classes);
          break;
        case 'wb:select':
          onSelect?.(msg.node);
          break;
        case 'wb:hover':
          onHover?.(msg.node);
          break;
        case 'wb:route-change':
          onRouteChange?.(msg.path);
          break;
        case 'wb:deselect':
          onDeselect?.();
          break;
        case 'wb:debug-report':
          /*
           * PICKING OFF WHILE A REPORT IS BEING AIMED, AND BACK AFTERWARDS.
           *
           * Picking suppresses the product's own click handlers so a click
           * selects a node — the exact opposite of what someone reporting on the
           * running interface needs, and it also takes the clicks the reporter's
           * own note form wants. So the reporter arming implies Use mode.
           *
           * RESTORED, not left off: whoever was in Pick mode was mid-task there,
           * and a tool that quietly changes the mode you were working in and
           * walks away is worse than one that never touched it. The pre-report
           * value is remembered in a ref rather than derived on the way out,
           * because by then `picking` is false either way and there would be
           * nothing left to tell the two cases apart.
           */
          if (msg.live) {
            if (pickingBeforeReport.current === null) {
              pickingBeforeReport.current = pickingRef.current;
            }
            setPicking(false);
          } else if (pickingBeforeReport.current !== null) {
            setPicking(pickingBeforeReport.current);
            pickingBeforeReport.current = null;
          }
          break;
        case 'wb:view': {
          if (msg.kind === 'pan') {
            queuePan(msg.dx, msg.dy);
            break;
          }
          /*
           * ZOOM ABOUT THE CURSOR — MEASURED, not derived.
           *
           * Solving for the pan algebraically needs a model of where the frame sits, and
           * the model was wrong twice over: `msg.x` is a FRAME-LOCAL coordinate, so it
           * had to be scaled by the current zoom before it could be added to a rendered
           * offset, and the footprint is `mx-auto`, so its left edge moves with the zoom
           * while its top does not. The result was a cursor that held in one axis and
           * drifted in the other — a point tracing an arc where it should have sat still.
           *
           * Recording where the anchor IS and putting it back after the scale needs no
           * model at all, and cannot drift when the layout around it changes. The
           * correction runs in a layout effect, before paint, so nothing is seen moving.
           */
          const box = frameRef.current?.getBoundingClientRect();
          if (box) {
            zoomAnchor.current = {
              fx: msg.x,
              fy: msg.y,
              hx: box.left + zoomRef.current * msg.x,
              hy: box.top + zoomRef.current * msg.y,
            };
          }
          setZoom((z) =>
            Math.min(4, Math.max(0.25, +(z * (msg.dy < 0 ? 1.1 : 1 / 1.1)).toFixed(3))),
          );
          break;
        }
        case 'wb:measured':
          if (msg.nonce === measureNonceRef.current) {
            onMeasured?.(msg.rect);
            lastFrameRectRef.current = msg.rect;
            recomputeHostRect();
          }
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [
    onClasses,
    onSelect,
    onHover,
    onReady,
    onCompileError,
    onRouteChange,
    onDeselect,
    onMeasured,
    recomputeHostRect,
    queuePan,
  ]);

  /**
   * Every host→frame channel is gated on `ready`, because a message sent before the
   * frame's listener is installed is dropped silently — and each is re-sent when `ready`
   * flips, so a reload restores the selection, the picking mode and the staged token
   * values instead of coming back blank.
   */
  useEffect(() => {
    if (ready) post({ type: 'wb:set-selection', id: selectedId });
  }, [ready, selectedId, post]);

  // Paired with the selection: is the node actually visible right now?
  // `wb:set-selection` already scrolls a scrolled-away node into view frame-side, so
  // what is left for the host to know is the other case — zero instances, or every
  // instance `display: none` — which no scroll can fix.
  useEffect(() => {
    if (!ready || !selectedId) {
      onMeasured?.(null);
      lastFrameRectRef.current = null;
      onSelectionHostRect?.(null);
      return;
    }
    const n = ++measureNonceRef.current;
    post({ type: 'wb:measure', id: selectedId, nonce: n });
  }, [ready, selectedId, post, onMeasured, onSelectionHostRect]);

  useEffect(() => {
    recomputeHostRect();
  }, [zoom, stage.width, stage.height, recomputeHostRect]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    el.addEventListener('scroll', recomputeHostRect, { passive: true });
    return () => el.removeEventListener('scroll', recomputeHostRect);
  }, [recomputeHostRect]);

  useEffect(() => {
    if (ready) post({ type: 'wb:set-hover', id: hoverId });
  }, [ready, hoverId, post]);

  useEffect(() => {
    /*
     * NEVER IN A COMPONENT PREVIEW, whatever the toggle last said.
     *
     * Hiding the button was not enough: `picking` is state, it stays true from the last
     * scene, and the frame goes on suppressing pointer events for it — so the preview
     * still selected on click and swallowed the drag that pans. The control is gone from
     * that mode, so the behaviour has to be too.
     */
    if (ready) post({ type: 'wb:set-picking', enabled: preview ? false : picking });
  }, [ready, picking, preview, post]);

  /*
   * A NEW SUBJECT STARTS CENTRED. Panning is per-component; carrying an offset into the
   * next one opens it somewhere off the pane with nothing to say why.
   */
  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [preview?.component, preview?.file]);

  useEffect(() => {
    if (ready) post({ type: 'wb:set-token-vars', vars: tokenVars ?? {} });
  }, [ready, tokenVars, post]);

  /**
   * Put the zoom anchor back where it was, now that the new scale has laid out.
   *
   * `useLayoutEffect`, not `useEffect`: this runs between the DOM update and the paint,
   * so the frame is never drawn at the uncorrected position and there is nothing to see
   * flicker. Reading the rect here is also the point — it is the measurement the old
   * algebra was trying and failing to predict.
   */
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    if (!a) return;
    zoomAnchor.current = null;
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return;
    const dx = a.hx - (box.left + zoom * a.fx);
    const dy = a.hy - (box.top + zoom * a.fy);
    if (dx || dy) setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  }, [zoom]);

  const width = VIEWPORT_WIDTH[viewport];
  /*
   * Same frame, two subjects. `preview` set means the host wants one component across
   * its variants instead of a route — see `componentFrameUrl` for why that reuses the
   * scene document rather than adding a second one.
   */
  const src = preview
    ? componentFrameUrl({
        file: preview.file,
        component: preview.component,
        axes: preview.axes,
        forced: preview.forced,
        label: preview.label,
        mockProps: preview.mockProps,
        noopProps: preview.noopProps,
        iconSlot: preview.iconSlot,
        icon: preview.icon,
        side,
        theme: dark ? 'dark' : 'light',
      })
    : sceneFrameUrl({
        scene: sceneId,
        side,
        theme: dark ? 'dark' : 'light',
        mockDataEmpty,
      });

  /*
   * ONE SIZING RULE FOR BOTH SUBJECTS.
   *
   * A preview used to be pinned to `stage.width` on the reasoning that a component has
   * no breakpoints of its own. Half true: a PRIMITIVE has none, but an app component is
   * a slab of layout — `DocumentList` has `sm:` rules on its filter row, `SiteHeader`
   * collapses — and those are exactly what you open the mode to look at. So the same
   * viewport control drives both, and `desktop` (fill) stays the default, which is the
   * behaviour this replaced: the grid still reaches the pane's edges until you ask for
   * a narrower frame.
   */
  const renderWidth = customSize?.width ?? width ?? stage.width;
  const renderHeight = customSize?.height ?? stage.height;

  /**
   * Wires one drag handle. `axis` says which dimension(s) it controls — the corner
   * handle drives both from one pointer.
   *
   * Read once at pointerdown rather than accumulated frame-to-frame, so a dropped
   * pointermove cannot compound into drift the way `prev + delta-since-last` would.
   *
   * The delta IS divided by `zoom`, because `customSize` is stored in real px while the
   * pointer moves in screen px.
   */
  /** Teardown for an in-flight resize, so unmounting mid-drag cannot leak its listeners. */
  const endResize = useRef<(() => void) | null>(null);
  useEffect(() => () => endResize.current?.(), []);

  const beginResize = useCallback(
    (axis: 'width' | 'height' | 'both') => (e: ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // The drag crosses the iframe, and the frame's document swallows the pointer events
      // the window is listening for. Capturing keeps them routed here for the whole drag.
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = renderWidth || stage.width || MIN_SIZE;
      const startHeight = renderHeight || stage.height || MIN_SIZE;
      const z = zoom;
      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) / z;
        const dy = (ev.clientY - startY) / z;
        setCustomSize({
          width: axis === 'height' ? startWidth : Math.max(MIN_SIZE, Math.round(startWidth + dx)),
          height: axis === 'width' ? startHeight : Math.max(MIN_SIZE, Math.round(startHeight + dy)),
        });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        endResize.current = null;
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      // `pointercancel` too: capture is lost to a gesture or a focus change without ever
      // producing a `pointerup`, which would otherwise leave `onMove` live and let a
      // later stray move resize the frame with no drag in progress.
      window.addEventListener('pointercancel', onUp);
      endResize.current = onUp;
    },
    [renderWidth, renderHeight, stage.width, stage.height, zoom],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        {/*
          THE SCENE'S CONTROLS, and only the scene's — minus the viewport, which is now
          shared and sits below.
          
          Zoom, picking and mock data all describe a PAGE. A component preview has
          nothing to pick inside (the whole frame is the one component) and no fixtures,
          so offering them made the mode look like a scene that had lost its content.
          What this row shows instead is the scope: which variant, in which interaction
          state.
        */}
        {preview ? (
          <div className="flex items-center gap-1.5">
            {/*
              THE AXES THEMSELVES, not a readout of them.
              
              They lived in the bindings inspector, one panel away from the thing they
              change, so choosing a variant meant looking right to pick and centre to
              see. Both are STATE — which variant, which interaction state — and state
              belongs on the bar above what it describes. The inspector keeps the
              bindings, which is what it is for.
            */}
            {Object.entries(preview.allAxes ?? {}).map(([axis, values]) => (
              <div key={axis} className="flex items-center gap-1">
                <span className="font-mono text-[10px] text-wb-muted">{axis}</span>
                <div className="flex items-center gap-0.5 rounded-md bg-wb-subtle p-0.5">
                  {values.map((v) => (
                    <button
                      key={v}
                      onClick={() => onVariantChange?.(axis, v)}
                      className={cn(
                        'rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                        preview.axes[axis]?.[0] === v
                          ? 'bg-wb-bg text-wb-fg shadow-sm'
                          : 'text-wb-muted hover:text-wb-fg',
                      )}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!Object.keys(preview.allAxes ?? {}).length && (
              <span className="font-mono text-[10px] text-wb-muted">no variants</span>
            )}

            {/*
              STATE, beside the variant it applies to.
              
              Only the states the component actually authors are offered — a `disabled:`
              chip on a component with no disabled styling would toggle nothing and read
              as the control being broken. `Default` is always there, because leaving a
              forced state has to be as easy as entering one.
            */}
            {/*
              The children input moved into the Preview data panel, beside the component's
              other required values. Text and a `Document[]` are the same question, and
              answering one on the toolbar and the other in a panel made them look like
              different features.
            */}
            {onForcedStateChange && preview.states.length > 0 && (
              <div className="ml-1 flex items-center gap-0.5 rounded-md bg-wb-subtle p-0.5">
                {[null, ...preview.states].map((st) => (
                  <button
                    key={st ?? 'default'}
                    onClick={() => onForcedStateChange(st)}
                    className={cn(
                      'rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                      (preview.forcedState ?? null) === st
                        ? 'bg-wb-bg text-wb-fg shadow-sm'
                        : 'text-wb-muted hover:text-wb-fg',
                    )}
                  >
                    {st ?? 'default'}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
        <>
        <Select value={String(zoom)} onValueChange={(v) => setZoom(Number(v))}>
          <SelectTrigger
            size="sm"
            className="h-[26px] gap-1 px-1.5 font-mono text-[10px]"
            title="Zoom — scales the picture only; the frame still reports its real width"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ZOOMS.map((z) => (
              <SelectItem key={z} value={String(z)}>
                {z * 100}%
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/*
          PICKING IS A SCENE CONTROL, and the component pane reaches the same thing a
          better way.
          
          Selecting a node inside a component IS what restyles one that has no variants —
          that part was right. But a click-to-pick and a drag-to-pan are the same gesture
          on the same surface, so enabling one always cost the other, and a pick had no
          way to show what it had caught. The Layout tab lists the component's own tree,
          highlights the selected row, and drives the same class editor. Selection you
          can see, and the canvas keeps its gestures.
        */}
        {!preview && (
          <button
            onClick={() => setPicking((p) => !p)}
            title={
              picking
                ? 'Picking ON — a click selects a node. Turn it off to use the scene.'
                : 'Picking OFF — clicks reach the scene. Turn it on to select nodes.'
            }
            className={cn(
              'ml-2 inline-flex items-center gap-1 rounded-md border border-wb-border px-1.5 py-1 text-[10px] transition-colors',
              picking ? 'bg-wb-accent/12 text-wb-accent' : 'text-wb-muted hover:text-wb-fg',
            )}
          >
            <MousePointerSquareDashed className="size-3.5" />
            {picking ? 'Pick' : 'Use'}
          </button>
        )}

        {onMockDataEmptyChange && (
          <button
            onClick={() => onMockDataEmptyChange(!mockDataEmpty)}
            title={
              mockDataEmpty
                ? 'Mock data OFF — every list fixture is emptied to []. Click to restore it.'
                : 'Mock data ON — the scene renders its normal fixture rows.'
            }
            className={cn(
              'inline-flex items-center gap-1 rounded-md border border-wb-border px-1.5 py-1 text-[10px] transition-colors',
              mockDataEmpty ? 'bg-wb-danger/15 text-wb-danger' : 'text-wb-muted hover:text-wb-fg',
            )}
          >
            <Database className="size-3.5" />
            {mockDataEmpty ? 'Empty' : 'Mock data'}
          </button>
        )}

        </>
        )}

        {/*
          THE VIEWPORT GROUP IS SHARED, and it is the one scene control that is.
          
          Zoom, picking and mock data describe a page. A WIDTH does not: it decides which
          `sm:` / `md:` rules resolve, and an app component carries those too. Keeping it
          in the scenes-only branch meant the mode could show `DocumentList` but never at
          390px, which is where its filter row actually breaks.
        */}
        <div className="flex items-center rounded-md border border-wb-border">
          {VIEWPORTS.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => {
                setViewport(key);
                setCustomSize(null);
              }}
              title={`Viewport: ${label} — a real width, so breakpoints resolve truthfully`}
              className={cn(
                'p-1.5 text-wb-muted transition-colors first:rounded-l-md last:rounded-r-md hover:text-wb-fg',
                viewport === key && !customSize && 'bg-wb-accent/12 text-wb-accent',
              )}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>

        <span className="font-mono text-[10px] text-wb-muted">
          {customSize
            ? `${customSize.width}×${customSize.height} (custom)`
            : width
              ? `${width}px`
              : 'fill'}
        </span>

        {customSize && (
          <button
            onClick={() => setCustomSize(null)}
            title="Clear the custom size and go back to the selected viewport preset"
            className="rounded-md border border-wb-border px-1.5 py-1 text-[10px] text-wb-muted transition-colors hover:text-wb-fg"
          >
            Reset size
          </button>
        )}

        <button
          onClick={() => {
            // Also restores zoom and pan. Double-click on the canvas does it too, but
            // that is something you have to already know; this is the button people
            // reach for when the view looks wrong, which is exactly when it should.
            setPan({ x: 0, y: 0 });
            setZoom(1);
            reload();
          }}
          title={preview ? 'Reset the view and reload the frame' : 'Reload the frame'}
          className="ml-auto rounded-md border border-wb-border p-1.5 text-wb-muted transition-colors hover:text-wb-fg"
        >
          <RotateCw className="size-3.5" />
        </button>
      </div>

      {/*
        Frame, in a gutter that deselects.

        The click lands here only when it did NOT land in the iframe — a click inside is
        consumed by the frame's own document and never reaches this element, so there is
        no need to test the target. That is also why the frame cannot implement this
        itself: "outside the frame" is, by definition, not something the frame can see.
      */}
      <div
        ref={stageRef}
        onClick={() => onDeselect?.()}
        /*
         * THE GRID LIVES HERE, and so does the clipping.
         *
         * It was inside the frame, which is why it stopped at the frame's edges and why
         * dragging produced scrollbars: the iframe is a fixed box, so moving it pushed
         * content past this container and `overflow-auto` did what it is for.
         *
         * On the container it covers the whole pane, and offsetting `backgroundPosition`
         * by the pan makes it travel with the content — which is what reads as an
         * infinite canvas rather than a picture of one. `overflow-hidden` in preview
         * mode because panning is the scroll here; a scrollbar would be a second,
         * disagreeing one.
         */
        className={cn(
          'relative min-h-0 flex-1 rounded-md border border-wb-border',
          preview ? 'overflow-hidden' : 'overflow-auto bg-wb-panel',
        )}
        style={
          preview
            ? {
                // The ground follows the THEME BEING PREVIEWED, not the chrome. A dark
                // component on a bright grid is unreadable, and the grid is there to be
                // the surface the component sits on — it has to belong to the same world.
                backgroundColor: dark ? '#1a1a1a' : '#fbfbfa',
              }
            : undefined
        }
      >
        {/*
          THE GRID IS ITS OWN LAYER, MOVED BY `transform`.
          
          It was `backgroundPosition` on this container, which is not a composited
          property: every pan frame repainted the whole pane, and the drag stuttered
          under the cursor. A transform on a separate layer is handed to the compositor
          instead, so panning costs no repaint at all.
          
          It only ever travels ONE CELL. The pattern repeats, so `pan % cell` is visually
          identical to the full offset and keeps the layer's own box still — and the
          `-cell` inset on every side is what hides the seam the wrap would otherwise
          show at the edges.
        */}
        {preview && (
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              left: -16 * zoom,
              top: -16 * zoom,
              right: -16 * zoom,
              bottom: -16 * zoom,
              backgroundImage: dark
                ? 'linear-gradient(rgba(255,255,255,.07) 1px, transparent 1px),' +
                  'linear-gradient(90deg, rgba(255,255,255,.07) 1px, transparent 1px)'
                : 'linear-gradient(rgba(0,0,0,.055) 1px, transparent 1px),' +
                  'linear-gradient(90deg, rgba(0,0,0,.055) 1px, transparent 1px)',
              backgroundSize: `${16 * zoom}px ${16 * zoom}px`,
              transform: `translate3d(${mod(pan.x, 16 * zoom)}px, ${mod(pan.y, 16 * zoom)}px, 0)`,
              willChange: 'transform',
            }}
          />
        )}
        {/*
          FOOTPRINT wrapper, sized to the scaled box's actual on-screen dimensions, so
          the resize handles — its direct children, siblings of the scaled div rather
          than descendants — sit on the visible edge at any zoom without themselves being
          shrunk. A handle inside the scaled div would be a 3px hitbox at 25% zoom.
        */}
        <div
          className="relative mx-auto"
          style={{
            width: (renderWidth || 0) * zoom || undefined,
            height: (renderHeight || 0) * zoom || undefined,
          }}
        >
          {/*
            The scaled stage. Its own box is the REAL, unscaled size, so the iframe never
            resolves against a zoomed containing block; `scale()` only repaints it,
            top-left anchored so it exactly fills the footprint above.
          */}
          <div
            style={{
              width: renderWidth || undefined,
              height: renderHeight || undefined,
              transform:
                zoom !== 1 || pan.x || pan.y
                  ? `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
                  : undefined,
              transformOrigin: 'top left',
            }}
          >
            <iframe
              // `src` is in the key because the frame reads its whole configuration from
              // the URL once, at load. Changing the previewed component changes only the
              // query string, and React would reuse the element and keep the old mount.
              key={`${src}|${nonce}`}
              ref={frameRef}
              src={src}
              title={preview ? `Component: ${preview.component}` : `Scene: ${sceneId}`}
              /*
               * How the shell finds a scene frame from a bare DOM node. The bug
               * reporter's hotkey is pressed while LOOKING at a frame, and the
               * shell has to hand it to the one under the pointer — see
               * `App.tsx`'s key handler. Matching on `src` would couple that
               * handler to the frame URL's shape.
               */
              data-wb-scene-frame={side}
              /*
               * A SCENE gets white: a page renders against its own background and a
               * transparent frame would show the panel through the gaps. A COMPONENT
               * preview is an object on the host's grid, so the frame must not paint
               * over it — the grid is the ground and this is what lets it show.
               */
              className={cn(
                'block h-full w-full border-0',
                preview ? 'bg-transparent' : 'bg-white',
              )}
            />
          </div>

          {/*
            FLUSH WITH THE EDGE, NEVER PAST IT — `right-0`/`bottom-0`, not a negative
            offset. This footprint box is exactly what `stageRef`'s `overflow-auto`
            measures, and "fill" derives `renderWidth` from that measurement. A handle
            spilling a few px past the box is overflow the container cannot satisfy
            without a scrollbar — which shrinks the measured size, which shrinks this box,
            which the handle still spills past by the same few px, forever.
          */}
          <div
            onPointerDown={beginResize('width')}
            title="Drag to resize width"
            className="group absolute right-0 top-0 z-10 h-full w-3 cursor-ew-resize"
          >
            <div className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-wb-border opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <div
            onPointerDown={beginResize('height')}
            title="Drag to resize height"
            className="group absolute bottom-0 left-0 z-10 h-3 w-full cursor-ns-resize"
          >
            <div className="absolute left-1/2 top-1/2 h-1 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-wb-border opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <div
            onPointerDown={beginResize('both')}
            title="Drag to resize width and height"
            className="absolute bottom-0.5 right-0.5 z-10 h-3.5 w-3.5 cursor-nwse-resize rounded-full border border-wb-border bg-wb-bg opacity-0 shadow-sm transition-opacity hover:opacity-100"
          />
        </div>

        {!ready && !error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-wb-bg/60">
            {/*
              Names WHAT is mounting. In component mode the frame prints its own
              "loading <Component>…" while this said "mounting login…", so the pane
              showed two different things loading and neither was the scene.
            */}
            <span className="font-mono text-[11px] text-wb-muted">
              mounting {preview ? preview.component : sceneId}…
            </span>
          </div>
        )}

        {error && <FrameErrorOverlay error={error} onReload={reload} />}

        {/*
          Streams, said once and quietly. It answers "why is nothing live in here?"
          without claiming the scene is broken.
        */}
        {streams.length > 0 && !error && (
          <p
            title={`Refused, by design — a stream has no fixture shape:\n${streams.join('\n')}`}
            className="pointer-events-auto absolute bottom-1 left-1 max-w-[60%] truncate rounded-sm bg-wb-panel/90 px-1.5 py-0.5 font-mono text-[10px] text-wb-muted"
          >
            {streams.length} live stream{streams.length > 1 ? 's' : ''} refused
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The four failures are separated because the fix differs, and conflating them is what
 * turns a missing fixture into an afternoon.
 */
export function FrameErrorOverlay({
  error,
  onReload,
}: {
  error: FrameError;
  onReload: () => void;
}) {
  const help: Record<FrameError['kind'], string> = {
    mount:
      'The scene never rendered — usually a missing export, or a mock the scene needs. ' +
      'Check the scene’s entry in the scene manifest.',
    render:
      'The scene mounted and then threw. This is usually the staged edit being wrong ' +
      'rather than the editor.',
    compile:
      'The module did not transform — a write from this editor probably broke the file. ' +
      'Revert the last write from the write log.',
    stream:
      'The scene opened an EventSource, and the guard turned it away — a stream has no ' +
      'fixture shape and nothing here reads what it carries. Expected, not a fixture gap.',
    fetch:
      'The scene asked for a URL no fixture covers. Requests are never allowed out of ' +
      'the frame: a real 401 makes an auth wrapper navigate the frame away, which looks ' +
      'exactly like a broken scene.',
  };
  return (
    <div className="absolute inset-0 flex items-start justify-center overflow-auto bg-wb-bg/95 p-6">
      <div className="w-full max-w-xl rounded-lg border border-wb-danger/40 bg-wb-danger/5 p-4">
        <p className="flex items-center gap-1.5 text-sm font-medium text-wb-danger">
          <AlertTriangle className="size-4" />
          Scene {error.kind} error
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-wb-muted">{help[error.kind]}</p>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-sm bg-wb-panel p-2 font-mono text-[10px] leading-relaxed text-wb-fg">
          {error.message}
        </pre>
        <button
          onClick={onReload}
          className="mt-3 rounded-sm border border-wb-border px-2 py-1 text-[11px] text-wb-muted transition-colors hover:text-wb-fg"
        >
          Reload frame
        </button>
      </div>
    </div>
  );
}

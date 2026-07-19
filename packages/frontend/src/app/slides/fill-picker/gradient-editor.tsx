import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { GradientFill, GradientStop, ThemeColor, Theme } from '@wafflebase/slides';
import { resolveColor } from '@wafflebase/slides';
import { ThemedColorPicker } from '../themed-color-picker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { releaseFocusToBody, useMenuCloseHandlers } from '@/components/menu-focus';
import {
  sortStops,
  insertStopAt,
  removeStopAt,
  degToRad,
  radToDeg,
} from './gradient-helpers';

/**
 * The 8 compass directions, laid out as a 3×3 grid with the center cell
 * left empty (`null` renders an inert spacer) so the arrows keep their
 * intuitive positions. `deg` is clockwise from +x (0 = left→right), matching
 * the stored `GradientFill.angle` after `degToRad`.
 */
const LINEAR_PRESETS: ({ label: string; deg: number } | null)[] = [
  { label: '↖', deg: 225 },
  { label: '↑', deg: 270 },
  { label: '↗', deg: 315 },
  { label: '←', deg: 180 },
  null,
  { label: '→', deg: 0 },
  { label: '↙', deg: 135 },
  { label: '↓', deg: 90 },
  { label: '↘', deg: 45 },
];

/** Pixels the pointer must move before a marker press counts as a drag
 *  rather than a click — otherwise every drag-release would also open the
 *  recolor popover (both share the same pointerdown). */
const DRAG_THRESHOLD_PX = 3;

export interface GradientEditorProps {
  value: GradientFill;
  theme: Theme;
  recentColors?: readonly string[];
  onChange: (next: GradientFill, opts?: { commit?: boolean }) => void;
}

/**
 * PowerPoint-style stops-bar for editing a linear {@link GradientFill}:
 * click the track to add a stop, drag a marker to reposition it, click a
 * marker to recolor via a nested `ThemedColorPicker`, and pick one of 8
 * direction presets or type an exact angle in degrees. Radial gradients are
 * a later phase — this editor only ever emits `type: 'linear'`.
 */
export function GradientEditor({ value, theme, recentColors, onChange }: GradientEditorProps) {
  const stops = sortStops(value.stops);
  const [selected, setSelected] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const [angleDraft, setAngleDraft] = useState<string | null>(null);

  const cssGradient = `linear-gradient(90deg, ${stops
    .map((s) => `${resolveColor(s.color, theme)} ${Math.round(s.pos * 100)}%`)
    .join(', ')})`;

  const emit = (next: Partial<GradientFill>, commit = true) =>
    onChange({ ...value, ...next, stops: sortStops(next.stops ?? value.stops) }, { commit });

  const posFromEvent = (clientX: number): number => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  // Track click on empty space adds a stop. Marker buttons handle their own
  // drag/click, and this target check keeps their presses from also adding
  // a stop as the pointerdown bubbles up.
  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== trackRef.current) return;
    const pos = posFromEvent(e.clientX);
    const next = insertStopAt(stops, pos);
    emit({ stops: next }, true);
    setSelected(next.findIndex((s) => s.pos === pos));
  };

  // Marker drag repositions live (no commit); commit once on pointer-up.
  // Below `DRAG_THRESHOLD_PX` of movement, treat the press as a click
  // instead so `onOpenRecolor` can open the color popover.
  const startDrag = (index: number, onOpenRecolor: () => void) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    // `DropdownMenuTrigger` opens on `pointerdown` by default (see the
    // marker doc comment below) — `preventDefault()` here blocks Radix's
    // own toggle so opening is fully decided by whether this press turns
    // into a drag.
    e.preventDefault();
    setSelected(index);
    const startX = e.clientX;
    let dragged = false;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    // Accumulate the live-dragged stops here and commit THIS on pointer-up —
    // `value` is captured pre-drag, so committing `value.stops` would snap
    // the marker back to its start. The live path is deliberately NOT
    // sorted: re-sorting mid-drag would reorder the array and the captured
    // `index` would stop pointing at the dragged marker (breaking the
    // Position%/Delete row and further moves). We sort exactly once, on up.
    let latest = stops;
    const move = (ev: PointerEvent) => {
      if (!dragged && Math.abs(ev.clientX - startX) >= DRAG_THRESHOLD_PX) {
        dragged = true;
      }
      if (!dragged) return;
      const pos = posFromEvent(ev.clientX);
      latest = stops.map((s, i) => (i === index ? { ...s, pos } : s));
      onChange({ ...value, stops: latest }, { commit: false });
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    const up = () => {
      cleanup();
      if (dragged) {
        // Sort + commit once. `sortStops` preserves object references, so
        // `indexOf` re-finds the dragged marker to keep it selected.
        const sorted = sortStops(latest);
        onChange({ ...value, stops: sorted }, { commit: true });
        const ni = sorted.indexOf(latest[index]);
        if (ni >= 0) setSelected(ni);
      } else {
        onOpenRecolor();
      }
    };
    // Pointer-cancel discards the in-progress drag: the last live change was
    // never committed, so there's nothing in undo — just tear down.
    const cancel = () => {
      cleanup();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  // Forward ThemedColorPicker's commit flag: its native `<input type="color">`
  // fires onChange continuously during a drag with no `commit`, so those live
  // updates must stay uncommitted (one undo unit per pick, not per frame). A
  // discrete swatch/role click passes `{ commit: true }` and commits.
  const recolor =
    (index: number) =>
    (color: ThemeColor, opts?: { commit?: boolean; record?: boolean }) => {
      const next = stops.map((s, i) => (i === index ? { ...s, color } : s));
      emit({ stops: next }, opts?.commit ?? false);
    };

  const deleteSelected = () => {
    const next = removeStopAt(stops, selected);
    emit({ stops: next }, true);
    setSelected(Math.max(0, selected - 1));
  };

  const setPreset = (deg: number) => emit({ angle: degToRad(deg) }, true);

  const cur = stops[selected] ?? stops[0];
  const angleDeg = Math.round(((radToDeg(value.angle) % 360) + 360) % 360);

  return (
    <div className="w-[208px] space-y-2" role="group" aria-label="Gradient editor">
      {/* Preview + stops track */}
      <div
        ref={trackRef}
        role="slider"
        aria-label="Gradient stops"
        aria-valuenow={cur ? Math.round(cur.pos * 100) : 0}
        onPointerDown={onTrackPointerDown}
        className="relative h-6 w-full cursor-copy rounded border border-border"
        style={{ background: cssGradient }}
      >
        {stops.map((s, i) => (
          <GradientStopMarker
            key={i}
            stop={s}
            index={i}
            selected={i === selected}
            theme={theme}
            recentColors={recentColors}
            startDrag={startDrag}
            onRecolor={recolor(i)}
          />
        ))}
      </div>

      {/* Linear direction: 8 presets + numeric angle */}
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-3 gap-0.5">
          {LINEAR_PRESETS.map((p, i) =>
            p === null ? (
              <span key={i} className="h-5 w-5" aria-hidden="true" />
            ) : (
              <button
                key={i}
                type="button"
                aria-label={`Direction ${p.label}`}
                onClick={() => setPreset(p.deg)}
                className="h-5 w-5 rounded border border-border text-[11px] hover:bg-muted"
              >
                {p.label}
              </button>
            ),
          )}
        </div>
        <label className="flex items-center gap-1 text-[11px]">
          <span className="text-muted-foreground">Angle</span>
          <input
            type="number"
            aria-label="Angle"
            className="w-12 rounded border border-border px-1 text-right"
            value={angleDraft ?? String(angleDeg)}
            onChange={(e) => setAngleDraft(e.target.value)}
            onBlur={(e) => {
              setAngleDraft(null);
              const deg = parseFloat(e.target.value);
              if (!Number.isNaN(deg)) setPreset(((deg % 360) + 360) % 360);
            }}
          />
          <span className="text-muted-foreground">°</span>
        </label>
      </div>

      {/* Selected-stop row */}
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Position</span>
        <input
          type="number"
          aria-label="Stop position"
          min={0}
          max={100}
          className="w-12 rounded border border-border px-1 text-right"
          value={cur ? Math.round(cur.pos * 100) : 0}
          onChange={(e) => {
            const pos = Math.max(0, Math.min(1, parseFloat(e.target.value) / 100));
            if (Number.isNaN(pos)) return;
            emit({ stops: stops.map((s, i) => (i === selected ? { ...s, pos } : s)) }, true);
          }}
        />
        <span>%</span>
        <button
          type="button"
          onClick={deleteSelected}
          disabled={stops.length <= 2}
          className="rounded border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-40"
        >
          Delete stop
        </button>
      </div>
    </div>
  );
}

interface GradientStopMarkerProps {
  stop: GradientStop;
  index: number;
  selected: boolean;
  theme: Theme;
  recentColors?: readonly string[];
  startDrag: (
    index: number,
    onOpenRecolor: () => void,
  ) => (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onRecolor: (
    color: ThemeColor,
    opts?: { commit?: boolean; record?: boolean },
  ) => void;
}

/**
 * One draggable/recolorable stop marker. Split out from `GradientEditor` so
 * each marker owns its own popover-open state and `useMenuCloseHandlers`
 * instance — hooks can't live inside the `stops.map()` loop directly.
 *
 * Unlike the other color palettes (which moved to the `Popover` primitive),
 * this marker deliberately stays on `DropdownMenu`: it depends on the trigger
 * toggling on `pointerdown` so `startDrag`'s `preventDefault()` can suppress
 * that toggle mid-drag (see below). `Popover` toggles on `click`, which a
 * pointerdown `preventDefault()` does not cancel, so it would reopen/close on
 * every stop tap. The controlled `open` state (closed after a discrete swatch
 * pick) plus `useMenuCloseHandlers` (drops focus to the document body on close
 * so arrow keys keep reaching the slide canvas) are unchanged.
 *
 * `DropdownMenuTrigger` normally opens on `pointerdown` itself, which would
 * fire on every drag-start too (opening the popover mid-drag). `startDrag`
 * calls `e.preventDefault()` on that same pointerdown, which — per Radix's
 * `composeEventHandlers` — suppresses Radix's own toggle, so opening is
 * decided entirely by `startDrag`'s `up` handler: a plain press (no
 * movement past the drag threshold) calls `onOpenRecolor`, a real drag
 * commits the reposition instead.
 */
function GradientStopMarker({
  stop,
  index,
  selected,
  theme,
  recentColors,
  startDrag,
  onRecolor,
}: GradientStopMarkerProps) {
  const [open, setOpen] = useState(false);
  const menu = useMenuCloseHandlers(releaseFocusToBody);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Gradient stop ${index + 1}`}
          aria-pressed={selected}
          onPointerDown={startDrag(index, () => setOpen(true))}
          className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
            selected ? 'border-foreground ring-2 ring-ring/50' : 'border-white'
          }`}
          style={{ left: `${stop.pos * 100}%`, backgroundColor: resolveColor(stop.color, theme) }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto p-2" onCloseAutoFocus={menu.onCloseAutoFocus}>
        <ThemedColorPicker
          value={stop.color}
          theme={theme}
          onChange={(color, opts) => {
            onRecolor(color, opts);
            if (opts?.commit) {
              menu.markSwatchClicked();
              setOpen(false);
            }
          }}
          allowAlpha
          recentColors={recentColors}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

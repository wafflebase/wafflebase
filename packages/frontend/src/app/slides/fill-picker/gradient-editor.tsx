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

const LINEAR_PRESETS: { label: string; deg: number }[] = [
  { label: '↖', deg: 225 },
  { label: '↑', deg: 270 },
  { label: '↗', deg: 315 },
  { label: '←', deg: 180 },
  { label: '•', deg: 90 },
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
    const move = (ev: PointerEvent) => {
      if (!dragged && Math.abs(ev.clientX - startX) >= DRAG_THRESHOLD_PX) {
        dragged = true;
      }
      if (!dragged) return;
      const pos = posFromEvent(ev.clientX);
      const next = stops.map((s, i) => (i === index ? { ...s, pos } : s));
      emit({ stops: next }, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (dragged) {
        emit({ stops: sortStops(value.stops) }, true);
      } else {
        onOpenRecolor();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const recolor = (index: number) => (color: ThemeColor) => {
    const next = stops.map((s, i) => (i === index ? { ...s, color } : s));
    emit({ stops: next }, true);
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
          {LINEAR_PRESETS.map((p, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Direction ${p.label}`}
              onClick={() => setPreset(p.deg)}
              className="h-5 w-5 rounded border border-border text-[11px] hover:bg-muted"
            >
              {p.label}
            </button>
          ))}
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
  onRecolor: (color: ThemeColor) => void;
}

/**
 * One draggable/recolorable stop marker. Split out from `GradientEditor` so
 * each marker owns its own popover-open state and `useMenuCloseHandlers`
 * instance — hooks can't live inside the `stops.map()` loop directly.
 *
 * There's no `Popover` primitive in this repo's `components/ui` (only
 * `DropdownMenu`/`Dialog`/etc.), so the nested per-stop color picker reuses
 * `DropdownMenu`, mirroring the fill-color palette in
 * `toolbar/shape-controls.tsx`: a controlled `open` state (closed after a
 * discrete swatch pick) plus `useMenuCloseHandlers` to drop focus to the
 * document body on close so arrow keys keep reaching the slide canvas
 * instead of getting stuck on the trigger `<button>`.
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
            onRecolor(color);
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

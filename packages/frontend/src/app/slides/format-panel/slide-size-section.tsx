import { useMemo } from 'react';
import { SLIDE_WIDTH } from '@wafflebase/slides';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UnitInput } from './size-position-section';
import { formatDisplay, type DisplayUnit } from './units';

/**
 * Deck-level slide-size presets. Width is fixed at {@link SLIDE_WIDTH}
 * (1920 px), so a preset is just its logical height:
 *   16:9  → 1920 × 9/16 = 1080   (the app default)
 *   4:3   → 1920 × 3/4  = 1440
 *   16:10 → 1920 × 10/16 = 1200
 */
const PRESETS: { id: string; label: string; height: number }[] = [
  { id: 'wide-16-9', label: 'Widescreen 16:9', height: 1080 },
  { id: 'std-4-3', label: 'Standard 4:3', height: 1440 },
  { id: 'wide-16-10', label: 'Widescreen 16:10', height: 1200 },
];

export interface SlideSizeSectionProps {
  /** Current deck logical height in px. */
  heightPx: number;
  unit: DisplayUnit;
  /** Commit a new logical height (px); applied deck-wide, one undo step. */
  onCommit: (heightPx: number) => void;
}

/**
 * "Slide size" section shown in the Format panel's idle (no-selection)
 * state. Since a deck has one size (not per-slide), this is the natural
 * home for the Google-Slides-style page-setup control without a menu bar.
 * Changing it scales existing content proportionally (see the store's
 * `setSlideHeight`).
 */
export function SlideSizeSection({ heightPx, unit, onCommit }: SlideSizeSectionProps) {
  const active = useMemo(
    () => PRESETS.find((p) => p.height === heightPx)?.id ?? 'custom',
    [heightPx],
  );

  return (
    <section aria-labelledby="format-slide-size-label" className="p-3">
      <h3 id="format-slide-size-label" className="mb-3 text-xs font-semibold">
        Slide size
      </h3>
      <Select
        value={active}
        onValueChange={(v) => {
          const p = PRESETS.find((pp) => pp.id === v);
          if (p && p.height !== heightPx) onCommit(p.height);
        }}
      >
        <SelectTrigger
          className="h-7 w-full text-xs"
          aria-label="Slide size preset"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p.id} value={p.id} className="text-xs">
              {p.label}
            </SelectItem>
          ))}
          {/* Selectable only implicitly — the value reads "Custom" whenever
              the height matches no preset (e.g. an imported 4:3.2 deck or a
              hand-typed height). Picking it is a no-op; edit Height to go
              custom. */}
          <SelectItem value="custom" className="text-xs">
            Custom
          </SelectItem>
        </SelectContent>
      </Select>
      <div className="mt-3 space-y-2">
        <UnitInput
          label="Width"
          valuePx={SLIDE_WIDTH}
          unit={unit}
          disabled
          disabledTooltip="Slide width is fixed; only the height (aspect) changes."
          onCommit={() => undefined}
        />
        <UnitInput
          label="Height"
          valuePx={heightPx}
          unit={unit}
          onCommit={(px) => {
            const next = Math.round(px);
            // UnitInput commits on every blur; the px→unit→px round-trip
            // (toFixed(2)) drifts, so a no-change blur on the default
            // 1080 px ("5.63" in) would come back as 1081 and rescale the
            // whole deck. Only commit when the *displayed* value actually
            // changed.
            if (
              next > 0 &&
              formatDisplay(next, unit) !== formatDisplay(heightPx, unit)
            ) {
              onCommit(next);
            }
          }}
        />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Applies to the whole presentation. Existing content is scaled to fit.
      </p>
    </section>
  );
}

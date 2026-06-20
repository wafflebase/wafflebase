import { useEffect, useState } from 'react';
import type { DropShadow, Element } from '@wafflebase/slides';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

export interface DropShadowSectionProps {
  /** Selected shape / image / text elements (all carry `data.effects`). */
  elements: readonly Element[];
  /**
   * Commit a shadow value (or `undefined` to remove it) to every
   * selected element. The parent merges it into each element's own
   * `effects` so a co-existing reflection is preserved.
   */
  onCommit: (ids: readonly string[], shadow: DropShadow | undefined) => void;
}

/**
 * Default shadow seeded when the toggle is switched on. Mirrors the
 * Google Slides default — soft black, 60% transparency, 45° down-right.
 * Distance / blur are in slide-logical px (canvas is 1920×1080).
 */
const DEFAULT_SHADOW: DropShadow = {
  color: '#000000',
  opacity: 0.4,
  angle: Math.PI / 4,
  distance: 8,
  blur: 8,
};

function readShadow(el: Element): DropShadow | undefined {
  // Connectors have no `data`; they are never routed to this section.
  const data = (el as { data?: { effects?: { shadow?: DropShadow } } }).data;
  return data?.effects?.shadow;
}

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export function DropShadowSection({
  elements,
  onCommit,
}: DropShadowSectionProps) {
  // Display the first element's shadow (matches the toolbar's multi-select
  // convention); committing writes to every selected element.
  const current = readShadow(elements[0]);
  const [shadow, setShadow] = useState<DropShadow | undefined>(current);

  // Re-sync when the selection changes or a remote edit updates the shadow.
  // The deps are flattened to primitives so the lint rule can check them
  // statically; `current` itself is intentionally read inside the effect.
  const firstId = elements[0]?.id;
  const curColor = current?.color;
  const curOpacity = current?.opacity;
  const curAngle = current?.angle;
  const curDistance = current?.distance;
  const curBlur = current?.blur;
  useEffect(() => {
    setShadow(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstId, curColor, curOpacity, curAngle, curDistance, curBlur]);

  const enabled = shadow !== undefined;
  const ids = elements.map((el) => el.id);

  const commit = (next: DropShadow | undefined): void => {
    setShadow(next);
    onCommit(ids, next);
  };

  // Live drag preview — update local state only, no store write per tick.
  const preview = (patch: Partial<DropShadow>): void => {
    setShadow({ ...(shadow ?? DEFAULT_SHADOW), ...patch });
  };

  // Persist a discrete change (or slider release) to the store.
  const persist = (patch: Partial<DropShadow>): void => {
    commit({ ...(shadow ?? DEFAULT_SHADOW), ...patch });
  };

  const transparency = Math.round((1 - (shadow?.opacity ?? 0)) * 100);
  const angleDeg = Math.round(((shadow?.angle ?? 0) * RAD_TO_DEG) % 360);
  const colorValue =
    typeof shadow?.color === 'string' ? shadow.color : '#000000';

  return (
    <section aria-labelledby="format-drop-shadow-label" className="p-3">
      <div className="mb-2 flex items-center gap-2">
        <Checkbox
          id="format-drop-shadow-toggle"
          checked={enabled}
          onCheckedChange={(c) => commit(c === true ? DEFAULT_SHADOW : undefined)}
        />
        <Label
          htmlFor="format-drop-shadow-toggle"
          id="format-drop-shadow-label"
          className="text-xs font-semibold"
        >
          Drop shadow
        </Label>
      </div>

      {enabled && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center justify-between text-xs">
            <span>Color</span>
            <input
              aria-label="Shadow color"
              type="color"
              value={colorValue}
              onChange={(e) => persist({ color: e.target.value })}
              className="h-6 w-10 rounded border bg-transparent"
            />
          </label>

          <div className="block text-xs">
            <span className="mb-1 block">Transparency</span>
            <Slider
              aria-label="Shadow transparency"
              min={0}
              max={100}
              step={1}
              value={[transparency]}
              onValueChange={([v]) => preview({ opacity: 1 - v / 100 })}
              onValueCommit={([v]) => persist({ opacity: 1 - v / 100 })}
            />
            <span className="text-muted-foreground">{transparency}%</span>
          </div>

          <div className="block text-xs">
            <span className="mb-1 block">Angle</span>
            <Slider
              aria-label="Shadow angle"
              min={0}
              max={359}
              step={1}
              value={[angleDeg]}
              onValueChange={([v]) => preview({ angle: v * DEG_TO_RAD })}
              onValueCommit={([v]) => persist({ angle: v * DEG_TO_RAD })}
            />
            <span className="text-muted-foreground">{angleDeg}°</span>
          </div>

          <div className="block text-xs">
            <span className="mb-1 block">Distance</span>
            <Slider
              aria-label="Shadow distance"
              min={0}
              max={50}
              step={1}
              value={[Math.round(shadow?.distance ?? 0)]}
              onValueChange={([v]) => preview({ distance: v })}
              onValueCommit={([v]) => persist({ distance: v })}
            />
            <span className="text-muted-foreground">
              {Math.round(shadow?.distance ?? 0)} px
            </span>
          </div>

          <div className="block text-xs">
            <span className="mb-1 block">Blur</span>
            <Slider
              aria-label="Shadow blur"
              min={0}
              max={50}
              step={1}
              value={[Math.round(shadow?.blur ?? 0)]}
              onValueChange={([v]) => preview({ blur: v })}
              onValueCommit={([v]) => persist({ blur: v })}
            />
            <span className="text-muted-foreground">
              {Math.round(shadow?.blur ?? 0)} px
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

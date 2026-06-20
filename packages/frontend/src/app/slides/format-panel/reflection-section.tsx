import { useEffect, useState } from 'react';
import type { Element, Reflection } from '@wafflebase/slides';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

export interface ReflectionSectionProps {
  /** Selected shape / image / text elements (all carry `data.effects`). */
  elements: readonly Element[];
  /**
   * Commit a reflection value (or `undefined` to remove it) to every
   * selected element. The parent merges it into each element's own
   * `effects` so a co-existing drop shadow is preserved.
   */
  onCommit: (ids: readonly string[], reflection: Reflection | undefined) => void;
}

/**
 * Default reflection seeded when the toggle is switched on. Mirrors the
 * Google Slides default — ~50% start transparency, short gap, half-height
 * fade. `distance` is in slide-logical px; `size` is a fraction of frame
 * height.
 */
const DEFAULT_REFLECTION: Reflection = {
  opacity: 0.5,
  distance: 0,
  size: 0.5,
};

function readReflection(el: Element): Reflection | undefined {
  // Connectors have no `data`; they are never routed to this section.
  const data = (el as { data?: { effects?: { reflection?: Reflection } } })
    .data;
  return data?.effects?.reflection;
}

export function ReflectionSection({
  elements,
  onCommit,
}: ReflectionSectionProps) {
  // Display the first element's reflection (matches the multi-select
  // convention); committing writes to every selected element.
  const current = readReflection(elements[0]);
  const [reflection, setReflection] = useState<Reflection | undefined>(current);

  // Re-sync on selection change / remote edit. Deps flattened to primitives
  // so the lint rule can check them statically.
  const firstId = elements[0]?.id;
  const curOpacity = current?.opacity;
  const curDistance = current?.distance;
  const curSize = current?.size;
  useEffect(() => {
    setReflection(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstId, curOpacity, curDistance, curSize]);

  const enabled = reflection !== undefined;
  const ids = elements.map((el) => el.id);

  const commit = (next: Reflection | undefined): void => {
    setReflection(next);
    onCommit(ids, next);
  };

  // Live drag preview — local state only; persist writes to the store.
  const preview = (patch: Partial<Reflection>): void => {
    setReflection({ ...(reflection ?? DEFAULT_REFLECTION), ...patch });
  };
  const persist = (patch: Partial<Reflection>): void => {
    commit({ ...(reflection ?? DEFAULT_REFLECTION), ...patch });
  };

  const transparency = Math.round((1 - (reflection?.opacity ?? 0)) * 100);
  const sizePct = Math.round((reflection?.size ?? 0) * 100);

  return (
    <section aria-labelledby="format-reflection-label" className="p-3">
      <div className="mb-2 flex items-center gap-2">
        <Checkbox
          id="format-reflection-toggle"
          checked={enabled}
          onCheckedChange={(c) =>
            commit(c === true ? DEFAULT_REFLECTION : undefined)
          }
        />
        <Label
          htmlFor="format-reflection-toggle"
          id="format-reflection-label"
          className="text-xs font-semibold"
        >
          Reflection
        </Label>
      </div>

      {enabled && (
        <div className="flex flex-col gap-2">
          <div className="block text-xs">
            <span className="mb-1 block">Transparency</span>
            <Slider
              aria-label="Reflection transparency"
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
            <span className="mb-1 block">Distance</span>
            <Slider
              aria-label="Reflection distance"
              min={0}
              max={50}
              step={1}
              value={[Math.round(reflection?.distance ?? 0)]}
              onValueChange={([v]) => preview({ distance: v })}
              onValueCommit={([v]) => persist({ distance: v })}
            />
            <span className="text-muted-foreground">
              {Math.round(reflection?.distance ?? 0)} px
            </span>
          </div>

          <div className="block text-xs">
            <span className="mb-1 block">Size</span>
            <Slider
              aria-label="Reflection size"
              min={0}
              max={100}
              step={1}
              value={[sizePct]}
              onValueChange={([v]) => preview({ size: v / 100 })}
              onValueCommit={([v]) => persist({ size: v / 100 })}
            />
            <span className="text-muted-foreground">{sizePct}%</span>
          </div>
        </div>
      )}
    </section>
  );
}

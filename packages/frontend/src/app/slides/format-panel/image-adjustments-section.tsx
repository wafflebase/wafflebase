import { useEffect, useState } from 'react';
import type { ImageElement } from '@wafflebase/slides';
import { getCommonValue } from './units';

export interface ImageAdjustmentsSectionProps {
  elements: readonly ImageElement[];
  onCommit: (ids: readonly string[], opacity: number) => void;
}

/** Convert opacity (0..1, undefined → 1) to transparency percent (0..100). */
function opacityToTransparency(opacity: number | undefined): number {
  return Math.round((1 - (opacity ?? 1)) * 100);
}

export function ImageAdjustmentsSection({
  elements,
  onCommit,
}: ImageAdjustmentsSectionProps) {
  const common = getCommonValue(elements, (el) =>
    opacityToTransparency(el.data.opacity),
  );
  const [draft, setDraft] = useState<number>(common ?? 0);
  // Re-sync the slider when the parent swaps to a different image (or a
  // remote edit changes opacity). Without this the draft sticks to the
  // value captured at mount and the next pointerUp commits stale data.
  useEffect(() => {
    setDraft(common ?? 0);
  }, [common]);

  // Commit on both pointerUp (drag release) and keyUp (arrow / Home / End
  // / Page Up / Page Down on a native range input). Keyboard adjustments
  // fire onChange to update the draft but never a pointer event, so
  // without onKeyUp the change would be visible in the slider thumb but
  // never reach the store.
  const commit = (): void => {
    const opacity = 1 - draft / 100;
    onCommit(
      elements.map((el) => el.id),
      opacity,
    );
  };

  return (
    <section aria-labelledby="format-adjustments-label" className="p-3">
      <h3
        id="format-adjustments-label"
        className="mb-2 text-xs font-semibold"
      >
        Adjustments
      </h3>
      <label className="block text-xs">
        <span className="mb-1 block">Transparency</span>
        <input
          aria-label="Transparency"
          type="range"
          min={0}
          max={100}
          step={1}
          value={draft}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          className="w-full"
        />
        <span className="text-xs text-muted-foreground">{draft}%</span>
      </label>
    </section>
  );
}

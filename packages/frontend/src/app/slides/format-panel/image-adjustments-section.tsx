import { useEffect, useState } from 'react';
import type { ImageElement } from '@wafflebase/slides';
import { getCommonValue } from './units';

/** Patch of the adjustable image data fields committed by this section. */
export type ImageAdjustmentsPatch = {
  opacity?: number;
  brightness?: number;
  contrast?: number;
};

export interface ImageAdjustmentsSectionProps {
  elements: readonly ImageElement[];
  onCommit: (ids: readonly string[], patch: ImageAdjustmentsPatch) => void;
}

/** Convert opacity (0..1, undefined → 1) to transparency percent (0..100). */
function opacityToTransparency(opacity: number | undefined): number {
  return Math.round((1 - (opacity ?? 1)) * 100);
}

export function ImageAdjustmentsSection({
  elements,
  onCommit,
}: ImageAdjustmentsSectionProps) {
  const ids = elements.map((el) => el.id);

  // Transparency 0..100 ⇒ opacity 1 - t/100.
  const commonTransparency = getCommonValue(elements, (el) =>
    opacityToTransparency(el.data.opacity),
  );
  // Brightness / contrast stored as -1..1; shown as -100..100.
  const commonBrightness = getCommonValue(elements, (el) =>
    Math.round((el.data.brightness ?? 0) * 100),
  );
  const commonContrast = getCommonValue(elements, (el) =>
    Math.round((el.data.contrast ?? 0) * 100),
  );

  const [transparency, setTransparency] = useState<number>(
    commonTransparency ?? 0,
  );
  const [brightness, setBrightness] = useState<number>(commonBrightness ?? 0);
  const [contrast, setContrast] = useState<number>(commonContrast ?? 0);

  // Re-sync each draft when the parent swaps images or a remote edit lands.
  useEffect(() => {
    setTransparency(commonTransparency ?? 0);
  }, [commonTransparency]);
  useEffect(() => {
    setBrightness(commonBrightness ?? 0);
  }, [commonBrightness]);
  useEffect(() => {
    setContrast(commonContrast ?? 0);
  }, [commonContrast]);

  return (
    <section aria-labelledby="format-adjustments-label" className="p-3">
      <h3 id="format-adjustments-label" className="mb-2 text-xs font-semibold">
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
          value={transparency}
          onChange={(e) => setTransparency(Number(e.target.value))}
          onPointerUp={() => onCommit(ids, { opacity: 1 - transparency / 100 })}
          onKeyUp={() => onCommit(ids, { opacity: 1 - transparency / 100 })}
          className="w-full"
        />
        <span className="text-muted-foreground">{transparency}%</span>
      </label>

      <label className="mt-2 block text-xs">
        <span className="mb-1 block">Brightness</span>
        <input
          aria-label="Brightness"
          type="range"
          min={-100}
          max={100}
          step={1}
          value={brightness}
          onChange={(e) => setBrightness(Number(e.target.value))}
          onPointerUp={() => onCommit(ids, { brightness: brightness / 100 })}
          onKeyUp={() => onCommit(ids, { brightness: brightness / 100 })}
          className="w-full"
        />
        <span className="text-muted-foreground">{brightness}%</span>
      </label>

      <label className="mt-2 block text-xs">
        <span className="mb-1 block">Contrast</span>
        <input
          aria-label="Contrast"
          type="range"
          min={-100}
          max={100}
          step={1}
          value={contrast}
          onChange={(e) => setContrast(Number(e.target.value))}
          onPointerUp={() => onCommit(ids, { contrast: contrast / 100 })}
          onKeyUp={() => onCommit(ids, { contrast: contrast / 100 })}
          className="w-full"
        />
        <span className="text-muted-foreground">{contrast}%</span>
      </label>
    </section>
  );
}

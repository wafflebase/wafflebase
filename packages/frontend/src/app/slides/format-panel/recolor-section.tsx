import type { ImageElement, ImageRecolor } from '@wafflebase/slides';
import { Button } from '@/components/ui/button';
import { getCommonValue } from './units';

export interface RecolorSectionProps {
  elements: readonly ImageElement[];
  onCommit: (ids: readonly string[], recolor: ImageRecolor) => void;
}

const PRESETS: ReadonlyArray<{ value: ImageRecolor; label: string }> = [
  { value: 'none', label: 'No recolor' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'sepia', label: 'Sepia' },
];

export function RecolorSection({ elements, onCommit }: RecolorSectionProps) {
  // `undefined` when the selection mixes recolor values; treat absent as
  // 'none' so a single fresh image shows the default selected.
  const common = getCommonValue(elements, (el) => el.data.recolor ?? 'none');
  const ids = elements.map((el) => el.id);

  return (
    <section aria-labelledby="format-recolor-label" className="p-3">
      <h3 id="format-recolor-label" className="mb-2 text-xs font-semibold">
        Recolor
      </h3>
      <div className="grid grid-cols-3 gap-1">
        {PRESETS.map((preset) => {
          const selected = common === preset.value;
          return (
            <Button
              key={preset.value}
              type="button"
              size="sm"
              variant={selected ? 'secondary' : 'outline'}
              aria-pressed={selected}
              onClick={() => onCommit(ids, preset.value)}
              className="h-7 px-2 text-xs"
            >
              {preset.label}
            </Button>
          );
        })}
      </div>
    </section>
  );
}

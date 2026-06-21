import type { AutofitMode, TextElement } from '@wafflebase/slides';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { getCommonValue } from './units';

export interface TextFittingSectionProps {
  elements: readonly TextElement[];
  onCommit: (ids: readonly string[], mode: AutofitMode) => void;
}

const MODES: { mode: AutofitMode; label: string }[] = [
  { mode: 'none', label: 'Do not autofit' },
  { mode: 'shrink', label: 'Shrink text on overflow' },
  { mode: 'grow', label: 'Resize shape to fit text' },
];

export function TextFittingSection({
  elements,
  onCommit,
}: TextFittingSectionProps) {
  // Absent autofit defaults to 'grow' per slides-text-autofit.md.
  const common = getCommonValue(
    elements,
    (el): AutofitMode => el.data.autofit ?? 'grow',
  );
  return (
    <section aria-labelledby="format-text-fitting-label" className="p-3">
      <h3
        id="format-text-fitting-label"
        className="mb-2 text-xs font-semibold"
      >
        Text fitting
      </h3>
      <RadioGroup
        className="space-y-1.5"
        value={common ?? undefined}
        onValueChange={(value) =>
          onCommit(
            elements.map((el) => el.id),
            value as AutofitMode,
          )
        }
      >
        {MODES.map(({ mode, label }) => (
          <label key={mode} className="flex items-center gap-2 text-xs">
            <RadioGroupItem value={mode} aria-label={label} />
            {label}
          </label>
        ))}
      </RadioGroup>
    </section>
  );
}

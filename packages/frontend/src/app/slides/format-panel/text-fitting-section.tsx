import type { AutofitMode, TextElement } from '@wafflebase/slides';
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
      <div role="radiogroup" className="space-y-1.5">
        {MODES.map(({ mode, label }) => (
          <label key={mode} className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name="format-text-fitting"
              aria-label={label}
              checked={common === mode}
              onChange={() =>
                onCommit(
                  elements.map((el) => el.id),
                  mode,
                )
              }
            />
            {label}
          </label>
        ))}
      </div>
    </section>
  );
}

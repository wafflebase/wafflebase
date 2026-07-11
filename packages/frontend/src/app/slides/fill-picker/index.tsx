import { useState } from 'react';
import type { Fill, GradientFill, ThemeColor, Theme } from '@wafflebase/slides';
import { representativeColor } from '@wafflebase/slides';
import { ThemedColorPicker } from '../themed-color-picker';
import { GradientEditor } from './gradient-editor';
import { seedGradient } from './gradient-helpers';

export interface FillPickerProps {
  /** Current fill of the first selected shape. */
  fill: Fill | undefined;
  theme: Theme;
  recentColors?: readonly string[];
  onChangeSolid: (
    color: ThemeColor,
    opts?: { commit?: boolean; record?: boolean },
  ) => void;
  onChangeGradient: (fill: GradientFill, opts?: { commit?: boolean }) => void;
  onClear: () => void;
}

/**
 * Solid | Gradient tabbed fill picker: wraps the existing `ThemedColorPicker`
 * (solid) and the linear `GradientEditor` (gradient) behind a two-tab shell.
 *
 * Switching tabs seeds/collapses the fill so the shape always shows *some*
 * result of the tab you're on: entering Gradient from a solid seeds a 2-stop
 * gradient from that solid (or the theme accent1 default); leaving Gradient
 * back to Solid collapses to the gradient's first stop
 * (`representativeColor`). Both transitions commit immediately (`commit:
 * true`) since they're discrete, deliberate actions, not live drags.
 */
export function FillPicker({
  fill,
  theme,
  recentColors,
  onChangeSolid,
  onChangeGradient,
  onClear,
}: FillPickerProps) {
  const isGradient = fill?.kind === 'gradient';
  const [tab, setTab] = useState<'solid' | 'gradient'>(
    isGradient ? 'gradient' : 'solid',
  );

  const toGradient = () => {
    setTab('gradient');
    if (fill?.kind !== 'gradient') {
      onChangeGradient(seedGradient(fill, theme), { commit: true });
    }
  };
  const toSolid = () => {
    setTab('solid');
    // Tab switch only — do NOT commit here. Committing routed through
    // onChangeSolid/onFillChange, which closes the popover on {commit:true}.
    // The gradient stays intact until the user actually picks a solid swatch
    // (which then applies + closes normally); switching back to Gradient keeps
    // the original gradient (non-destructive toggle).
  };

  return (
    <div className="w-[208px]">
      <div role="tablist" className="mb-2 flex gap-1 rounded bg-muted/50 p-0.5">
        <button
          role="tab"
          aria-selected={tab === 'solid'}
          onClick={toSolid}
          className={`flex-1 rounded px-2 py-1 text-xs ${tab === 'solid' ? 'bg-background shadow' : ''}`}
        >
          Solid
        </button>
        <button
          role="tab"
          aria-selected={tab === 'gradient'}
          onClick={toGradient}
          className={`flex-1 rounded px-2 py-1 text-xs ${tab === 'gradient' ? 'bg-background shadow' : ''}`}
        >
          Gradient
        </button>
      </div>

      {tab === 'solid' ? (
        <ThemedColorPicker
          value={fill?.kind === 'gradient' ? representativeColor(fill) : fill}
          theme={theme}
          onChange={onChangeSolid}
          onClear={onClear}
          allowAlpha
          recentColors={recentColors}
        />
      ) : (
        <GradientEditor
          value={fill?.kind === 'gradient' ? fill : seedGradient(fill, theme)}
          theme={theme}
          recentColors={recentColors}
          onChange={onChangeGradient}
        />
      )}
    </div>
  );
}

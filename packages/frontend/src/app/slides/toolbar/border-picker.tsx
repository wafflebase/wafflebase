import { useState } from 'react';
import type { Stroke, Theme, ThemeColor } from '@wafflebase/slides';
import { resolveColor } from '@wafflebase/slides';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ThemedColorPicker } from '../themed-color-picker';
import {
  releaseFocusToBody,
  useMenuCloseHandlers,
} from '@/components/menu-focus';
import { ColorSwatchButton } from '@/components/color-swatch-button';
import { IconBorderStyle2, IconChevronDown, IconLineHeight, IconPencil } from '@tabler/icons-react';

export interface BorderPickerProps {
  value?: Stroke;
  theme?: Theme | null;
  /**
   * Emits the next stroke. `opts.record` marks a final color pick (swatch
   * / custom blur) so the parent can record a recent color; `opts.commit`
   * marks a discrete swatch pick that should close the palette. Weight /
   * dash changes and live custom-color drags pass neither.
   */
  onChange(
    stroke: Stroke | undefined,
    opts?: { commit?: boolean; record?: boolean },
  ): void;
  /** Recently used srgb hex colors, forwarded to the color picker. */
  recentColors?: readonly string[];
  disabled?: boolean;
}

const BORDER_WEIGHTS = [0, 1, 2, 4, 8, 16] as const;
const DASH_STYLES: Array<'solid' | 'dashed' | 'dotted'> = ['solid', 'dashed', 'dotted'];
const DEFAULT_STROKE: Stroke = { color: '#000000', width: 1, dash: 'solid' };

/** Resolve `Stroke.color` to a ThemeColor for the picker. Plain hex strings become `{ kind: 'srgb' }`. */
function resolvePickerColor(color: Stroke['color'] | undefined): ThemeColor | undefined {
  if (!color) return undefined;
  if (typeof color === 'string') return { kind: 'srgb', value: color };
  return color as ThemeColor;
}

/**
 * Border picker — three controls (color, weight, dash) reused by both
 * shape-controls (Task 8) and text-element-controls (Task 10).
 */
export function BorderPicker({
  value,
  theme,
  onChange,
  recentColors,
  disabled,
}: BorderPickerProps) {
  // Controlled open state so the palette closes after a swatch click — the
  // color swatches are plain <button>s, not DropdownMenuItem, so Radix can't
  // auto-close them.
  const [colorOpen, setColorOpen] = useState(false);
  // Drop the trigger button's focus only when the user picked a swatch,
  // so arrows can reach the slide canvas. Outside-click / Esc fall
  // through.
  const colorMenu = useMenuCloseHandlers(releaseFocusToBody);

  const onColorChange = (
    color: ThemeColor,
    opts?: { commit?: boolean; record?: boolean },
  ) => {
    const next: Stroke = { ...(value ?? DEFAULT_STROKE), color };
    // Re-enable stroke if weight was 0 (user picking color implies they want a border).
    if (next.width === 0) next.width = 1;
    onChange(next, opts);
    // Only a discrete swatch pick closes the palette; live custom-input
    // changes (and the custom blur, which records only) keep it open.
    if (opts?.commit) {
      colorMenu.markSwatchClicked();
      setColorOpen(false);
    }
  };

  const onWeightChange = (width: number) => {
    if (width === 0) {
      // 0-weight means "no border" — clear the stroke entirely.
      onChange(undefined);
    } else {
      onChange({ ...(value ?? DEFAULT_STROKE), width });
    }
  };

  const onDashChange = (dash: 'solid' | 'dashed' | 'dotted') => {
    onChange({ ...(value ?? DEFAULT_STROKE), dash });
  };

  const btnClass =
    'inline-flex h-7 cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50';

  const pickerColor = resolvePickerColor(value?.color);
  const currentBorderColor =
    pickerColor && theme ? resolveColor(pickerColor, theme) : undefined;

  return (
    <>
      {/* Border color */}
      <DropdownMenu open={colorOpen} onOpenChange={setColorOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <ColorSwatchButton
                icon={<IconPencil size={14} />}
                color={currentBorderColor}
                label="Border color"
                disabled={disabled}
              />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Border color</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="start"
          className="w-auto p-2"
          onCloseAutoFocus={colorMenu.onCloseAutoFocus}
        >
          {theme && (
            <ThemedColorPicker
              value={pickerColor}
              theme={theme}
              onChange={onColorChange}
              allowAlpha
              recentColors={recentColors}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Border weight */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Border weight" disabled={disabled} className={btnClass}>
                <IconLineHeight size={16} />
                <IconChevronDown size={12} className="ml-0.5 opacity-50" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Border weight</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          {BORDER_WEIGHTS.map((w) => (
            <DropdownMenuItem key={w} onClick={() => onWeightChange(w)}>
              {w === 0 ? 'No border' : `${w}px`}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Border dash */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Border dash" disabled={disabled} className={btnClass}>
                <IconBorderStyle2 size={16} />
                <IconChevronDown size={12} className="ml-0.5 opacity-50" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Border dash</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          {DASH_STYLES.map((d) => (
            <DropdownMenuItem key={d} onClick={() => onDashChange(d)}>
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

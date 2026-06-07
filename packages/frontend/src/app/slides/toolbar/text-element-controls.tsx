import { useCallback, useState } from 'react';
import type {
  SlidesEditor,
  SlidesStore,
  TextElement,
  Stroke,
  Theme,
  ThemeColor,
  ThemeFont,
} from '@wafflebase/slides';
import { resolveColor, resolveFont } from '@wafflebase/slides';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ToolbarSeparator } from '@/components/ui/toolbar';
import { IconBucketDroplet } from '@tabler/icons-react';
import { ThemedColorPicker } from '../themed-color-picker';
import { ThemedFontPicker } from '../themed-font-picker';
import { BorderPicker } from './border-picker';
import { ColorSwatchButton } from '@/components/color-swatch-button';
import { FontSizePicker } from '@/components/text-formatting';

export interface TextElementControlsProps {
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  theme?: Theme | null;
  ids: readonly string[];
}

/**
 * Box-level controls for text element selection (State 2c).
 *
 * Shown when one or more text elements are selected as objects (single click,
 * not double-click to enter text edit). Applies to the whole box:
 *   - Background fill
 *   - Border (color / weight / dash)
 *   - Font family — writes fontFamily across all inlines in all blocks
 *   - Font size — writes fontSize across all inlines in all blocks
 *
 * Per-run text editing (bold, italic, etc.) happens in the text-editing
 * toolbar state, after double-click enters the box.
 */
export function TextElementControls({ editor, store, theme, ids }: TextElementControlsProps) {
  const slideId = editor?.getCurrentSlideId();
  const firstId = ids[0];

  const slide =
    store && slideId
      ? store.read().slides.find((s) => s.id === slideId)
      : undefined;
  const firstElement = slide?.elements.find(
    (e) => e.id === firstId && e.type === 'text',
  ) as TextElement | undefined;

  // Controlled open state so the swatch click closes the palette — the
  // color swatches are plain <button>s, not DropdownMenuItem.
  const [fillOpen, setFillOpen] = useState(false);

  const onBackgroundFill = useCallback(
    (color: ThemeColor) => {
      if (!store || !slideId || !slide) return;
      store.batch(() => {
        for (const id of ids) {
          const el = slide.elements.find((e) => e.id === id);
          if (el?.type === 'text') {
            store.updateElementData(slideId, id, { fill: color });
          }
        }
      });
      setFillOpen(false);
    },
    [store, slideId, slide, ids],
  );

  const onStrokeChange = useCallback(
    (stroke: Stroke | undefined) => {
      if (!store || !slideId || !slide) return;
      store.batch(() => {
        for (const id of ids) {
          const el = slide.elements.find((e) => e.id === id);
          if (el?.type === 'text') {
            store.updateElementData(slideId, id, { stroke });
          }
        }
      });
    },
    [store, slideId, slide, ids],
  );

  const onFontFamily = useCallback(
    (font: ThemeFont) => {
      if (!store || !slideId || !theme) return;
      const family = resolveFont(font, theme);
      store.batch(() => {
        for (const id of ids) {
          store.withTextElement(slideId, id, (blocks) =>
            blocks.map((b) => ({
              ...b,
              inlines: b.inlines.map((run) => ({
                ...run,
                style: { ...run.style, fontFamily: family },
              })),
            })),
          );
        }
      });
    },
    [store, slideId, theme, ids],
  );

  const onFontSize = useCallback(
    (size: number) => {
      if (!store || !slideId) return;
      store.batch(() => {
        for (const id of ids) {
          store.withTextElement(slideId, id, (blocks) =>
            blocks.map((b) => ({
              ...b,
              inlines: b.inlines.map((run) => ({
                ...run,
                style: { ...run.style, fontSize: size },
              })),
            })),
          );
        }
      });
    },
    [store, slideId, ids],
  );

  const buttonClass =
    'inline-flex h-7 cursor-pointer items-center justify-center rounded-md px-2 text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50';

  const currentTextBoxFill =
    firstElement?.data.fill && theme
      ? resolveColor(firstElement.data.fill, theme)
      : undefined;

  return (
    <>
      {/* Background fill — the text box itself, not text color */}
      <DropdownMenu open={fillOpen} onOpenChange={setFillOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <ColorSwatchButton
                icon={<IconBucketDroplet size={14} />}
                color={currentTextBoxFill}
                label="Text box background"
                disabled={!store || !theme}
              />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Text box background</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-auto p-2">
          {theme && (
            <ThemedColorPicker
              value={firstElement?.data.fill}
              theme={theme}
              onChange={onBackgroundFill}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <BorderPicker
        value={firstElement?.data.stroke}
        theme={theme}
        onChange={onStrokeChange}
        disabled={!store || !slideId}
      />

      <ToolbarSeparator className="mx-1" />

      {/* Font family — themed font picker */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Font"
                disabled={!store || !theme}
                className={buttonClass}
              >
                Aa
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Font</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-auto p-2">
          {theme && (
            <ThemedFontPicker value={undefined} theme={theme} onChange={onFontFamily} />
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Font size — input + ± steppers + click-to-open preset list */}
      <FontSizePicker
        value={firstRunFontSize(firstElement)}
        onChange={(size) => onFontSize(size)}
        disabled={!store || !slideId}
      />
    </>
  );
}

/**
 * Probe the first text run's `fontSize` for the box-level stepper. The
 * box may legitimately have many runs at different sizes; for the
 * stepper baseline we follow the same rule the existing Font picker
 * does (first run wins) so the up / down steps feel like extensions of
 * the dropdown selection. Returns `undefined` if no run is present;
 * the stepper then falls back to its default of 11pt.
 */
function firstRunFontSize(el: TextElement | undefined): number | undefined {
  const firstRun = el?.data.blocks?.[0]?.inlines?.[0];
  return firstRun?.style?.fontSize;
}

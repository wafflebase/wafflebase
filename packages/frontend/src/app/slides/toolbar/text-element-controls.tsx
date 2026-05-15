import { useCallback } from 'react';
import type {
  SlidesEditor,
  SlidesStore,
  TextElement,
  Stroke,
  Theme,
  ThemeColor,
  ThemeFont,
} from '@wafflebase/slides';
import { resolveFont } from '@wafflebase/slides';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ToolbarSeparator } from '@/components/ui/toolbar';
import { IconColorSwatch } from '@tabler/icons-react';
import { ThemedColorPicker } from '../themed-color-picker';
import { ThemedFontPicker } from '../themed-font-picker';
import { BorderPicker } from './border-picker';

export interface TextElementControlsProps {
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  theme?: Theme | null;
  ids: readonly string[];
}

const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 32, 48, 64, 96] as const;

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

  return (
    <>
      {/* Background fill — the text box itself, not text color */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Text box background"
                disabled={!store || !theme}
                className={buttonClass}
              >
                <IconColorSwatch size={16} />
              </button>
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

      {/* Font size */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Font size"
                disabled={!store}
                className={buttonClass}
              >
                Size
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Font size</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          {FONT_SIZES.map((s) => (
            <DropdownMenuItem key={s} onClick={() => onFontSize(s)}>
              {s}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

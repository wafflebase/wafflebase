import { useCallback, useState } from 'react';
import type {
  SlidesEditor,
  SlidesStore,
  TextElement,
  Stroke,
  Theme,
  ThemeColor,
} from '@wafflebase/slides';
import { resolveColor } from '@wafflebase/slides';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IconBucketDroplet } from '@tabler/icons-react';
import { ThemedColorPicker } from '../themed-color-picker';
import { BorderPicker } from './border-picker';
import {
  releaseFocusToBody,
  useMenuCloseHandlers,
} from '@/components/menu-focus';
import { ColorSwatchButton } from '@/components/color-swatch-button';

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
 *
 * Matches the shape toolbar (ShapeControls), which also shows only
 * fill + border for the object-level selection. Font family / size and
 * per-run text editing (bold, italic, etc.) happen in the text-editing
 * toolbar state, after double-click enters the box — text boxes and
 * text-bearing shapes share that path.
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
  const fillMenu = useMenuCloseHandlers(releaseFocusToBody);

  const onBackgroundFill = useCallback(
    (color: ThemeColor, opts?: { commit?: boolean; record?: boolean }) => {
      if (!store || !slideId || !slide) return;
      store.batch(() => {
        for (const id of ids) {
          const el = slide.elements.find((e) => e.id === id);
          if (el?.type === 'text') {
            store.updateElementData(slideId, id, { fill: color });
          }
        }
        if (opts?.record && color.kind === 'srgb') {
          store.pushRecentColor(color.value);
        }
      });
      // Only a discrete swatch pick closes the palette; live custom-input
      // changes (and the custom blur, which records only) keep it open.
      if (opts?.commit) {
        fillMenu.markSwatchClicked();
        setFillOpen(false);
      }
    },
    [store, slideId, slide, ids, fillMenu],
  );

  const onStrokeChange = useCallback(
    (stroke: Stroke | undefined, opts?: { commit?: boolean; record?: boolean }) => {
      if (!store || !slideId || !slide) return;
      store.batch(() => {
        for (const id of ids) {
          const el = slide.elements.find((e) => e.id === id);
          if (el?.type === 'text') {
            store.updateElementData(slideId, id, { stroke });
          }
        }
        if (
          opts?.record &&
          typeof stroke?.color === 'object' &&
          stroke.color.kind === 'srgb'
        ) {
          store.pushRecentColor(stroke.color.value);
        }
      });
    },
    [store, slideId, slide, ids],
  );

  const currentTextBoxFill =
    firstElement?.data.fill && theme
      ? resolveColor(firstElement.data.fill, theme)
      : undefined;

  return (
    <>
      {/* Background fill — the text box itself, not text color */}
      <Popover modal open={fillOpen} onOpenChange={setFillOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <ColorSwatchButton
                icon={<IconBucketDroplet size={14} />}
                color={currentTextBoxFill}
                label="Fill color"
                disabled={!store || !theme}
              />
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Fill color</TooltipContent>
        </Tooltip>
        <PopoverContent
          align="start"
          className="w-auto p-2"
          onCloseAutoFocus={fillMenu.onCloseAutoFocus}
        >
          {theme && (
            <ThemedColorPicker
              value={firstElement?.data.fill}
              theme={theme}
              onChange={onBackgroundFill}
              allowAlpha
              recentColors={store?.read().meta.recentColors}
            />
          )}
        </PopoverContent>
      </Popover>

      <BorderPicker
        value={firstElement?.data.stroke}
        theme={theme}
        onChange={onStrokeChange}
        recentColors={store?.read().meta.recentColors}
        disabled={!store || !slideId}
      />
    </>
  );
}

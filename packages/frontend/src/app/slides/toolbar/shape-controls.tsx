import { useCallback } from 'react';
import type {
  ConnectorElement,
  ShapeElement,
  SlidesEditor,
  SlidesStore,
  Stroke,
  Theme,
  ThemeColor,
} from '@wafflebase/slides';
import { resolveColor } from '@wafflebase/slides';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ToolbarSeparator } from '@/components/ui/toolbar';
import { IconBucketDroplet } from '@tabler/icons-react';
import { ThemedColorPicker } from '../themed-color-picker';
import { readShapeFill } from '../themed-color-picker-helpers';
import { BorderPicker } from './border-picker';
import { ColorSwatchButton } from '@/components/color-swatch-button';

export interface ShapeControlsProps {
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  theme?: Theme | null;
  /** IDs of all selected elements — may be a mix of shapes and connectors. */
  ids: readonly string[];
}

/**
 * Contextual controls for shape and connector selections: Fill color (shapes
 * only) and Border (color + weight + dash, both shapes and connectors).
 *
 * Used for `selectionType: 'shape'` and `selectionType: 'connector'` in
 * object-section.tsx. Multi-select shows the first element's values for
 * initial pre-population and writes to all selected shapes/connectors on change.
 */
export function ShapeControls({ editor, store, theme, ids }: ShapeControlsProps) {
  const slideId = editor?.getCurrentSlideId();
  const firstId = ids[0];

  const slide =
    store && slideId
      ? store.read().slides.find((s) => s.id === slideId)
      : undefined;
  const firstElement = slide?.elements.find((e) => e.id === firstId);
  const isShape = firstElement?.type === 'shape';

  const onFillChange = useCallback(
    (color: ThemeColor) => {
      if (!store || !slideId || !slide) return;
      store.batch(() => {
        for (const id of ids) {
          const el = slide.elements.find((e) => e.id === id);
          if (el?.type === 'shape') {
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
          if (!el) continue;
          if (el.type === 'shape') {
            store.updateElementData(slideId, id, { stroke });
          } else if (el.type === 'connector') {
            store.updateConnectorStroke(slideId, id, stroke);
          }
        }
      });
    },
    [store, slideId, slide, ids],
  );

  const firstStroke =
    firstElement?.type === 'shape'
      ? (firstElement as ShapeElement).data.stroke
      : firstElement?.type === 'connector'
        ? (firstElement as ConnectorElement).stroke
        : undefined;

  const currentFill =
    isShape && theme
      ? (() => {
          const v = readShapeFill(firstElement as ShapeElement);
          return v ? resolveColor(v, theme) : undefined;
        })()
      : undefined;

  return (
    <>
      {/* Fill: shapes only — connectors have no fill */}
      {isShape && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <ColorSwatchButton
                  icon={<IconBucketDroplet size={14} />}
                  color={currentFill}
                  label="Fill color"
                  disabled={!store || !slideId || !theme}
                />
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Fill color</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-auto p-2">
            {theme && (
              <ThemedColorPicker
                value={
                  firstElement?.type === 'shape'
                    ? readShapeFill(firstElement as ShapeElement)
                    : undefined
                }
                theme={theme}
                onChange={onFillChange}
              />
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {isShape && <ToolbarSeparator className="mx-1" />}
      <BorderPicker
        value={firstStroke}
        theme={theme}
        onChange={onStrokeChange}
        disabled={!store || !slideId}
      />
    </>
  );
}

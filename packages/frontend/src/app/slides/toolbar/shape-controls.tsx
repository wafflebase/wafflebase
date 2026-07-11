import { useCallback, useEffect, useState } from 'react';
import type {
  ConnectorElement,
  Fill,
  GradientFill,
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
import { IconBucketDroplet } from '@tabler/icons-react';
import { FillPicker } from '../fill-picker';
import { applyShapeFillValue, readShapeFill } from '../themed-color-picker-helpers';
import { BorderPicker } from './border-picker';
import {
  releaseFocusToBody,
  useMenuCloseHandlers,
} from '@/components/menu-focus';
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

  // Controlled open state so the swatch click closes the palette — the
  // color swatches are plain <button>s, not DropdownMenuItem.
  const [fillOpen, setFillOpen] = useState(false);
  const fillMenu = useMenuCloseHandlers(releaseFocusToBody);

  // Local draft: the in-progress gradient shown in the editor + on the bar.
  // `null` when not editing a gradient. Lives here (not in FillPicker) so
  // the dropdown-close handler can flush it. `GradientEditor` emits live
  // `{commit:false}` calls on every pointermove during a stop drag (and the
  // nested per-stop native color input emits live calls with no `commit` at
  // all); writing every one of those to the store would flood Yorkie with
  // an op per pointermove and shred the undo stack, so the draft absorbs
  // them and only commit boundaries (release / preset / angle blur) or the
  // dropdown closing persist to the store.
  const [gradientDraft, setGradientDraft] = useState<GradientFill | null>(
    null,
  );

  const persistGradient = useCallback(
    (fill: GradientFill) => {
      if (!store || !slideId || !slide) return;
      applyShapeFillValue(store, slideId, ids, slide, fill); // one store.batch
    },
    [store, slideId, slide, ids],
  );

  // GradientEditor/FillPicker onChange(next, opts). Always update the draft
  // (live bar preview); write to the store only on a commit boundary.
  const onFillGradient = useCallback(
    (fill: GradientFill, opts?: { commit?: boolean }) => {
      setGradientDraft(fill);
      if (opts?.commit) persistGradient(fill);
    },
    [persistGradient],
  );

  // Reset the draft whenever the selection changes (stale draft must not
  // leak onto a different shape).
  useEffect(() => {
    setGradientDraft(null);
  }, [ids]);

  const onFillChange = useCallback(
    (color: ThemeColor, opts?: { commit?: boolean; record?: boolean }) => {
      if (!store || !slideId || !slide) return;
      store.batch(() => {
        for (const id of ids) {
          const el = slide.elements.find((e) => e.id === id);
          if (el?.type === 'shape') {
            store.updateElementData(slideId, id, { fill: color });
          }
        }
        if (opts?.record && color.kind === 'srgb') {
          store.pushRecentColor(color.value);
        }
      });
      // Switching to (or staying on) a solid pick abandons any in-progress
      // gradient draft — it must not resurrect on the next open/close.
      setGradientDraft(null);
      // Only a discrete swatch pick closes the palette; live custom-input
      // changes (and the custom blur, which records only) keep it open.
      if (opts?.commit) {
        fillMenu.markSwatchClicked();
        setFillOpen(false);
      }
    },
    [store, slideId, slide, ids, fillMenu],
  );

  const onFillClear = useCallback(() => {
    if (!store || !slideId || !slide) return;
    store.batch(() => {
      for (const id of ids) {
        const el = slide.elements.find((e) => e.id === id);
        if (el?.type === 'shape') {
          store.updateElementData(slideId, id, { fill: undefined });
        }
      }
    });
    setGradientDraft(null);
    fillMenu.markSwatchClicked();
    setFillOpen(false);
  }, [store, slideId, slide, ids, fillMenu]);

  // Flush any uncommitted draft to the store when the dropdown closes, as a
  // single batch, then clear it. Switching to the Solid tab persists via
  // onFillChange, so the draft is also cleared there.
  const onFillOpenChange = useCallback(
    (open: boolean) => {
      if (!open && gradientDraft) {
        persistGradient(gradientDraft);
        setGradientDraft(null);
      }
      setFillOpen(open);
    },
    [gradientDraft, persistGradient],
  );

  const onStrokeChange = useCallback(
    (stroke: Stroke | undefined, opts?: { commit?: boolean; record?: boolean }) => {
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

  // The current fill object for the first shape, with the live draft taking
  // precedence so the editor + preview reflect in-progress gradient edits.
  const firstFill: Fill | undefined =
    gradientDraft ??
    (firstElement?.type === 'shape'
      ? (firstElement as ShapeElement).data.fill
      : undefined);

  return (
    <>
      {/* Fill: shapes only — connectors have no fill */}
      {isShape && (
        <DropdownMenu open={fillOpen} onOpenChange={onFillOpenChange}>
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
          <DropdownMenuContent
            align="start"
            className="w-auto p-2"
            onCloseAutoFocus={fillMenu.onCloseAutoFocus}
          >
            {theme && (
              <FillPicker
                fill={firstFill}
                theme={theme}
                recentColors={store?.read().meta.recentColors}
                onChangeSolid={onFillChange}
                onChangeGradient={onFillGradient}
                onClear={onFillClear}
              />
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <BorderPicker
        value={firstStroke}
        theme={theme}
        onChange={onStrokeChange}
        recentColors={store?.read().meta.recentColors}
        disabled={!store || !slideId}
      />
    </>
  );
}

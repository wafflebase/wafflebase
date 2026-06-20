import { useCallback, useState } from 'react';
import type {
  CellBorder,
  CellStyle,
  SlidesEditor,
  SlidesStore,
  TableElement,
  Theme,
  ThemeColor,
  VerticalAnchorMode,
} from '@wafflebase/slides';
import { DEFAULT_CELL_PADDING } from '@wafflebase/slides';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Toggle } from '@/components/ui/toggle';
import { ToolbarSeparator } from '@/components/ui/toolbar';
import {
  IconAlignBoxLeftTop,
  IconAlignBoxLeftMiddle,
  IconAlignBoxLeftBottom,
  IconBorderAll,
  IconBoxPadding,
  IconBucketDroplet,
  IconCheck,
} from '@tabler/icons-react';
import { ThemedColorPicker } from '../themed-color-picker';
import { ColorSwatchButton } from '@/components/color-swatch-button';
import {
  releaseFocusToBody,
  useMenuCloseHandlers,
} from '@/components/menu-focus';

const BORDER_PRESET_DEFAULT: CellBorder = { color: '#000000', width: 1 };

/**
 * Uniform cell-padding presets (px), applied to all four sides. Mirrors
 * Google Slides' single "Cell padding" control rather than per-side
 * margins — per-side editing belongs in the Format options panel.
 */
const PADDING_PRESETS = [0, 2, 5, 10] as const;
const PADDING_MIN = 0;
const PADDING_MAX = 100;

export interface TableControlsProps {
  editor: SlidesEditor | null;
  store: SlidesStore | null;
  theme?: Theme | null;
  /** IDs of selected elements — exactly one table id when this renders. */
  ids: readonly string[];
  /**
   * Live cell-range inside the selected table, or `null` when the
   * user has only the table at the element level. With a range, ops
   * scope to the selected cells; without it, ops apply to every
   * non-covered cell in the table (matches Google Slides where
   * "Cell border: all" with no cell range modifies the whole table).
   */
  cellRange:
    | { tableId: string; r0: number; c0: number; r1: number; c1: number }
    | null
    | undefined;
}

/**
 * Contextual controls for table selections: cell fill, vertical
 * alignment, and a border-preset dropdown.
 *
 * Rendered for `selectionType: 'table'` in object-section.tsx —
 * mirrors the layout of ShapeControls so the toolbar reads
 * consistently across element kinds. Right-click context menu still
 * carries the structural ops (insert / delete row & col, merge,
 * distribute, delete table) — the toolbar is for cell *style* edits.
 */
export function TableControls({
  editor,
  store,
  theme,
  ids,
  cellRange,
}: TableControlsProps) {
  const slideId = editor?.getCurrentSlideId();
  const tableId = ids[0];
  const slide =
    store && slideId
      ? store.read().slides.find((s) => s.id === slideId)
      : undefined;
  const table =
    slide?.elements.find((e) => e.id === tableId && e.type === 'table') as
      | TableElement
      | undefined;

  const [fillOpen, setFillOpen] = useState(false);
  const fillMenu = useMenuCloseHandlers(releaseFocusToBody);

  const [paddingOpen, setPaddingOpen] = useState(false);
  const [paddingCustom, setPaddingCustom] = useState(false);
  const [paddingDraft, setPaddingDraft] = useState('');

  /**
   * Resolve the target cell coordinates: explicit range when set,
   * else every non-covered cell in the table. Both paths skip covered
   * cells (gridSpan/rowSpan === 0) since `updateTableCellStyle`
   * throws on them.
   */
  const targetCells = useCallback((): Array<{ row: number; col: number }> => {
    if (!table) return [];
    const out: Array<{ row: number; col: number }> = [];
    if (cellRange && cellRange.tableId === tableId) {
      const rmin = Math.min(cellRange.r0, cellRange.r1);
      const rmax = Math.max(cellRange.r0, cellRange.r1);
      const cmin = Math.min(cellRange.c0, cellRange.c1);
      const cmax = Math.max(cellRange.c0, cellRange.c1);
      for (let r = rmin; r <= rmax; r++) {
        for (let c = cmin; c <= cmax; c++) {
          const cell = table.data.rows[r]?.cells[c];
          if (!cell) continue;
          if (cell.gridSpan === 0 || cell.rowSpan === 0) continue;
          out.push({ row: r, col: c });
        }
      }
      return out;
    }
    for (let r = 0; r < table.data.rows.length; r++) {
      for (let c = 0; c < table.data.columnWidths.length; c++) {
        const cell = table.data.rows[r]?.cells[c];
        if (!cell) continue;
        if (cell.gridSpan === 0 || cell.rowSpan === 0) continue;
        out.push({ row: r, col: c });
      }
    }
    return out;
  }, [cellRange, table, tableId]);

  const applyStyle = useCallback(
    (patch: Partial<CellStyle>) => {
      if (!store || !slideId) return;
      const cells = targetCells();
      if (cells.length === 0) return;
      store.batch(() => {
        for (const { row, col } of cells) {
          store.updateTableCellStyle(slideId, tableId, row, col, patch);
        }
      });
    },
    [store, slideId, tableId, targetCells],
  );

  const applyFill = useCallback(
    (color: ThemeColor, opts?: { commit?: boolean; record?: boolean }) => {
      if (!store || !slideId) return;
      const cells = targetCells();
      if (cells.length === 0) return;
      // Single batch so the fill and the recent-color push share one
      // undo unit (can't call pushRecentColor after applyStyle's batch
      // closes — pushRecentColor itself requires an open batch).
      store.batch(() => {
        for (const { row, col } of cells) {
          store.updateTableCellStyle(slideId, tableId, row, col, {
            fill: color,
          });
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
    [store, slideId, tableId, targetCells, fillMenu],
  );

  /**
   * Apply a border preset to the active range / whole table:
   *   - 'all'   — set the default border on all four sides
   *   - 'outer' — set the border only on the perimeter of the
   *               selection rectangle (range only; with no range
   *               this collapses to the table's outer edges)
   *   - 'clear' — drop the whole style.border field
   *
   * Without a cellRange, the "outer" preset uses the table's outer
   * row / column indices so the user can pick a perimeter on the
   * whole table without first selecting a cell range.
   */
  const applyBorderPreset = useCallback(
    (preset: 'all' | 'outer' | 'clear') => {
      if (!store || !slideId || !table) return;
      const targets = targetCells();
      if (targets.length === 0) return;
      const rmin = Math.min(...targets.map((t) => t.row));
      const rmax = Math.max(...targets.map((t) => t.row));
      const cmin = Math.min(...targets.map((t) => t.col));
      const cmax = Math.max(...targets.map((t) => t.col));
      store.batch(() => {
        for (const { row, col } of targets) {
          if (preset === 'clear') {
            store.updateTableCellStyle(slideId, tableId, row, col, {
              border: undefined,
            });
            continue;
          }
          const onTop = preset === 'all' || row === rmin;
          const onBottom = preset === 'all' || row === rmax;
          const onLeft = preset === 'all' || col === cmin;
          const onRight = preset === 'all' || col === cmax;
          const next: NonNullable<CellStyle['border']> = {
            top: onTop ? { ...BORDER_PRESET_DEFAULT } : undefined,
            right: onRight ? { ...BORDER_PRESET_DEFAULT } : undefined,
            bottom: onBottom ? { ...BORDER_PRESET_DEFAULT } : undefined,
            left: onLeft ? { ...BORDER_PRESET_DEFAULT } : undefined,
          };
          store.updateTableCellStyle(slideId, tableId, row, col, {
            border: next,
          });
        }
      });
    },
    [store, slideId, tableId, table, targetCells],
  );

  /** Set uniform padding on all four sides of every target cell. */
  const applyPadding = useCallback(
    (px: number) => {
      applyStyle({ padding: { top: px, right: px, bottom: px, left: px } });
    },
    [applyStyle],
  );

  const commitPaddingCustom = useCallback(() => {
    const n = Number(paddingDraft);
    if (Number.isFinite(n)) {
      applyPadding(Math.max(PADDING_MIN, Math.min(PADDING_MAX, Math.round(n))));
    }
    setPaddingOpen(false);
    setPaddingCustom(false);
  }, [paddingDraft, applyPadding]);

  // The vAlign group reflects the FIRST cell in the target set —
  // mixed ranges show no toggle pressed (sampleVAlign === undefined).
  const sampleCell = (() => {
    if (!table) return undefined;
    const cells = targetCells();
    if (cells.length === 0) return undefined;
    return table.data.rows[cells[0].row]?.cells[cells[0].col];
  })();
  const sampleVAlign: VerticalAnchorMode | undefined =
    sampleCell?.style.verticalAlign;
  const setVAlign = (anchor: VerticalAnchorMode): void => {
    applyStyle({ verticalAlign: anchor });
  };

  // Current padding, sampled from the first target cell with the
  // renderer's DEFAULT_CELL_PADDING fallback. A check mark / custom
  // default only shows when all four sides match (the uniform control
  // can't represent an asymmetric value — e.g. the 4/8/4/8 default).
  const sampleUniformPadding: number | undefined = (() => {
    if (!sampleCell) return undefined;
    const p = sampleCell.style.padding;
    const sides = [
      p?.top ?? DEFAULT_CELL_PADDING.top,
      p?.right ?? DEFAULT_CELL_PADDING.right,
      p?.bottom ?? DEFAULT_CELL_PADDING.bottom,
      p?.left ?? DEFAULT_CELL_PADDING.left,
    ];
    return sides.every((s) => s === sides[0]) ? sides[0] : undefined;
  })();

  return (
    <>
      {/* Cell fill — themed color picker shared with shapes */}
      <DropdownMenu open={fillOpen} onOpenChange={setFillOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <ColorSwatchButton
                icon={<IconBucketDroplet size={14} />}
                color={
                  typeof sampleCell?.style.fill === 'string'
                    ? sampleCell.style.fill
                    : undefined
                }
                label="Cell fill"
              />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Cell fill</TooltipContent>
        </Tooltip>
        <DropdownMenuContent onCloseAutoFocus={fillMenu.onCloseAutoFocus}>
          {theme && (
            <>
              <ThemedColorPicker
                theme={theme}
                value={
                  typeof sampleCell?.style.fill === 'object'
                    ? (sampleCell.style.fill as ThemeColor)
                    : undefined
                }
                onChange={applyFill}
                recentColors={store?.read().meta.recentColors}
              />
              <DropdownMenuItem
                onSelect={() => {
                  applyStyle({ fill: undefined });
                  fillMenu.markSwatchClicked();
                  setFillOpen(false);
                }}
              >
                No fill
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ToolbarSeparator className="mx-1" />

      {/* Vertical alignment — three toggles */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={sampleVAlign === 'top'}
            onPressedChange={(p) => p && setVAlign('top')}
            aria-label="Align cell top"
          >
            <IconAlignBoxLeftTop size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Align cell top</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={sampleVAlign === 'middle'}
            onPressedChange={(p) => p && setVAlign('middle')}
            aria-label="Align cell middle"
          >
            <IconAlignBoxLeftMiddle size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Align cell middle</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={sampleVAlign === 'bottom'}
            onPressedChange={(p) => p && setVAlign('bottom')}
            aria-label="Align cell bottom"
          >
            <IconAlignBoxLeftBottom size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Align cell bottom</TooltipContent>
      </Tooltip>

      <ToolbarSeparator className="mx-1" />

      {/* Border preset dropdown */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Cell borders"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted"
              >
                <IconBorderAll size={16} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Cell borders</TooltipContent>
        </Tooltip>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => applyBorderPreset('all')}>
            All borders
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => applyBorderPreset('outer')}>
            Outer border
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => applyBorderPreset('clear')}>
            Clear borders
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Cell padding — uniform on all four sides */}
      <DropdownMenu
        open={paddingOpen}
        onOpenChange={(o) => {
          setPaddingOpen(o);
          if (!o) setPaddingCustom(false);
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Cell padding"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted"
              >
                <IconBoxPadding size={16} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Cell padding</TooltipContent>
        </Tooltip>
        <DropdownMenuContent className="w-[140px]">
          {paddingCustom ? (
            <form
              className="flex items-center gap-1 p-1"
              onSubmit={(e) => {
                e.preventDefault();
                commitPaddingCustom();
              }}
            >
              <input
                autoFocus
                type="number"
                step={1}
                min={PADDING_MIN}
                max={PADDING_MAX}
                value={paddingDraft}
                onChange={(e) => setPaddingDraft(e.target.value)}
                onBlur={commitPaddingCustom}
                className="h-7 w-full rounded border border-border bg-background px-2 text-sm outline-none"
              />
              <span className="pr-1 text-xs text-muted-foreground">px</span>
            </form>
          ) : (
            <>
              {PADDING_PRESETS.map((p) => (
                <DropdownMenuItem
                  key={p}
                  onSelect={() => {
                    applyPadding(p);
                    setPaddingOpen(false);
                  }}
                  className="flex items-center justify-between"
                >
                  <span>{p} px</span>
                  {sampleUniformPadding === p && <IconCheck size={14} />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setPaddingCustom(true);
                  setPaddingDraft(String(sampleUniformPadding ?? ''));
                }}
              >
                Custom…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

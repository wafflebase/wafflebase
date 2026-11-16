import { type PointerEvent as ReactPointerEvent } from "react";
import { formatValue, parseRef, Spreadsheet } from "@wafflebase/sheets";
import { type DraftLayout, type HandlePosition } from "./object-layer-utils";
import { SelectionOverlay } from "./selection-overlay";
import { ObjectLayerViewport } from "./object-layer-viewport";
import { useObjectKeyboardShortcuts, useObjectDragResize } from "./use-object-layer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SheetChart, SpreadsheetDocument } from "@/types/worksheet";
import { IconDotsVertical, IconPencil, IconTrash } from "@tabler/icons-react";
import {
  buildChartDataset,
  buildPieDataset,
  type ChartValueFormat,
} from "./chart-utils";
import { getChartEntry } from "./charts/chart-registry";

type ChartObjectLayerProps = {
  spreadsheet: Spreadsheet | undefined;
  root: SpreadsheetDocument;
  tabId: string;
  readOnly: boolean;
  selectedChartId: string | null;
  onSelectChart: (chartId: string | null) => void;
  onRequestEditChart: (chartId: string) => void;
  onDeleteChart: (chartId: string) => void;
  onUpdateChart: (chartId: string, patch: Partial<SheetChart>) => void;
  renderVersion: number;
};

const MIN_Y_AXIS_WIDTH = 40;
const MAX_Y_AXIS_WIDTH = 96;

const compactTickFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const plainTickFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

/**
 * Renders the ChartObjectLayer component.
 */
export function ChartObjectLayer({
  spreadsheet,
  root,
  tabId,
  readOnly,
  selectedChartId,
  onSelectChart,
  onRequestEditChart,
  onDeleteChart,
  onUpdateChart,
  renderVersion,
}: ChartObjectLayerProps) {
  const charts = Object.values(root.sheets[tabId]?.charts || {});

  useObjectKeyboardShortcuts({
    selectedId: selectedChartId,
    readOnly,
    items: charts,
    onDelete: onDeleteChart,
    onDeselect: () => onSelectChart(null),
    onUpdate: onUpdateChart,
  });

  const { setDragState, drafts } = useObjectDragResize({
    readOnly,
    spreadsheet,
    lockAspectRatio: false,
    items: charts,
    onUpdate: onUpdateChart,
  });

  if (!spreadsheet || charts.length === 0) {
    return null;
  }

  const zoom = spreadsheet.getZoom();

  return (
    <ObjectLayerViewport
      spreadsheet={spreadsheet}
      zIndex={4}
      renderVersion={renderVersion}
    >
      {charts.map((chart) => {
        const layout = drafts[chart.id] || {
          offsetX: chart.offsetX,
          offsetY: chart.offsetY,
          width: chart.width,
          height: chart.height,
        };
        return (
          <ChartObject
            key={chart.id}
            chart={chart}
            root={root}
            spreadsheet={spreadsheet}
            zoom={zoom}
            selected={selectedChartId === chart.id}
            readOnly={readOnly}
            layout={layout}
            onSelect={() => onSelectChart(chart.id)}
            onRequestEdit={() => onRequestEditChart(chart.id)}
            onDelete={() => onDeleteChart(chart.id)}
            onMoveStart={(event) => {
              onSelectChart(chart.id);
              setDragState({
                objectId: chart.id,
                mode: "move",
                startX: event.clientX,
                startY: event.clientY,
                startOffsetX: layout.offsetX,
                startOffsetY: layout.offsetY,
                startWidth: layout.width,
                startHeight: layout.height,
                aspectRatio: 1,
              });
            }}
            onResizeStart={(event, handle) => {
              onSelectChart(chart.id);
              setDragState({
                objectId: chart.id,
                mode: "resize",
                handle,
                startX: event.clientX,
                startY: event.clientY,
                startOffsetX: layout.offsetX,
                startOffsetY: layout.offsetY,
                startWidth: layout.width,
                startHeight: layout.height,
                aspectRatio: 1,
              });
            }}
          />
        );
      })}
    </ObjectLayerViewport>
  );
}

function ChartObject({
  chart,
  root,
  spreadsheet,
  zoom,
  selected,
  readOnly,
  layout,
  onSelect,
  onRequestEdit,
  onDelete,
  onMoveStart,
  onResizeStart,
}: {
  chart: SheetChart;
  root: SpreadsheetDocument;
  spreadsheet: Spreadsheet;
  zoom: number;
  selected: boolean;
  readOnly: boolean;
  layout: DraftLayout;
  onSelect: () => void;
  onRequestEdit: () => void;
  onDelete: () => void;
  onMoveStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeStart: (
    event: ReactPointerEvent<HTMLDivElement>,
    handle: HandlePosition,
  ) => void;
}) {
  let anchorRect;
  try {
    anchorRect = spreadsheet.getCellRectInScrollableViewport(parseRef(chart.anchor));
  } catch {
    return null;
  }
  const left = anchorRect.left + layout.offsetX * zoom;
  const top = anchorRect.top + layout.offsetY * zoom;

  const entry = getChartEntry(chart.type);
  const Renderer = entry.renderer;
  const showGridlines = chart.showGridlines ?? true;
  const legendPosition = chart.legendPosition ?? (entry.category === "radial" ? "right" : "bottom");

  // Build dataset based on category
  const isPie = entry.category === "radial";
  const dataset = isPie ? null : buildChartDataset(root, chart, chart.colorPalette);
  const pieDataset = isPie ? buildPieDataset(root, chart, chart.colorPalette) : null;

  // Scatter charts need numeric X-axis values for proper axis scaling
  if (entry.category === "scatter" && dataset) {
    for (const row of dataset.rows) {
      const xVal = row[dataset.xKey];
      if (typeof xVal === "string") {
        const num = Number(xVal.replace(/,/g, ""));
        if (Number.isFinite(num)) {
          row[dataset.xKey] = num;
        }
      }
    }
  }
  // Scatter plots numbers on both axes through one formatter, so only the
  // category charts take the source column's currency/percent format.
  const formatValueTick =
    entry.category === "scatter"
      ? formatYAxisTick
      : getValueTickFormatter(dataset?.valueFormat);
  const yAxisWidth = dataset ? getYAxisWidth(dataset, formatValueTick) : 0;
  const isEmpty = isPie
    ? !pieDataset || pieDataset.entries.length === 0
    : !dataset || dataset.rows.length === 0 || dataset.series.length === 0;

  return (
    <div
      className="pointer-events-auto absolute flex flex-col rounded-md border bg-background shadow-md"
      style={{
        left,
        top,
        width: layout.width * zoom,
        height: layout.height * zoom,
        cursor: readOnly ? "default" : "move",
      }}
      onPointerDown={(event) => {
        if (readOnly) {
          event.stopPropagation();
          onSelect();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onMoveStart(event);
      }}
    >
      <div className="flex shrink-0 items-center justify-between border-b px-2 py-1 text-xs font-medium">
        <div className="min-w-0 flex-1">
          <span className="truncate">{chart.title || "Chart"}</span>
        </div>
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ml-1 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                aria-label="Open chart menu"
              >
                <IconDotsVertical size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
            >
              <DropdownMenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  onRequestEdit();
                }}
              >
                <IconPencil size={14} />
                Edit chart
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              >
                <IconTrash size={14} />
                Delete chart
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="relative min-h-0 flex-1 p-2">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Not enough numeric data in {chart.sourceRange}
          </div>
        ) : Renderer ? (
          isPie ? (
            <Renderer dataset={pieDataset} legendPosition={legendPosition} />
          ) : (
            <Renderer
              dataset={dataset}
              yAxisWidth={yAxisWidth}
              showGridlines={showGridlines}
              legendPosition={legendPosition}
              formatYAxisTick={formatValueTick}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Unsupported chart type
          </div>
        )}
      </div>
      {selected && (
        <SelectionOverlay
          width={layout.width * zoom}
          height={layout.height * zoom}
          readOnly={readOnly}
          onResizeStart={onResizeStart}
        />
      )}
    </div>
  );
}

function formatYAxisTick(value: number | string): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  if (Math.abs(numeric) >= 10_000) {
    return compactTickFormatter.format(numeric);
  }

  return plainTickFormatter.format(numeric);
}

/**
 * The value-axis tick formatter for a dataset: a currency or percent source
 * column ticks in its own format (`$1,200.00`, `12.00%`), large currency
 * amounts compactly (`$12K`); anything else keeps the plain formatter.
 */
function getValueTickFormatter(
  valueFormat: ChartValueFormat | undefined,
): (value: number | string) => string {
  if (!valueFormat) return formatYAxisTick;
  // Gate on the format, not on `cu` alone: a stale `cu` can outlive a switch
  // to percent, and percent ticks must not render as `$10K`.
  const isCurrency =
    valueFormat.nf === "currency" || valueFormat.nf === "accounting";
  const compactCurrency =
    isCurrency && valueFormat.cu ? safeCompactCurrency(valueFormat.cu) : null;
  return (value) => {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    if (compactCurrency && Math.abs(numeric) >= 10_000) {
      return compactCurrency.format(numeric);
    }
    return formatValue(String(numeric), valueFormat.nf, valueFormat.dp, {
      currency: valueFormat.cu,
    });
  };
}

function safeCompactCurrency(currency: string): Intl.NumberFormat | null {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    });
  } catch {
    return null;
  }
}

function getYAxisWidth(
  dataset: {
    rows: Record<string, unknown>[];
    series: { key: string }[];
  },
  formatTick: (value: number | string) => string,
): number {
  let maxLen = 0;
  for (const row of dataset.rows) {
    for (const s of dataset.series) {
      const v = row[s.key];
      const str = typeof v === "number" ? formatTick(v) : String(v ?? "");
      if (str.length > maxLen) maxLen = str.length;
    }
  }
  return Math.max(MIN_Y_AXIS_WIDTH, Math.min(MAX_Y_AXIS_WIDTH, maxLen * 8 + 16));
}

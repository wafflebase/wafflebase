import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useState,
} from "react";
import { parseRef, Spreadsheet } from "@wafflebase/sheets";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SheetChart, SpreadsheetDocument } from "@/types/worksheet";
import { IconDotsVertical, IconPencil, IconTrash } from "@tabler/icons-react";
import { buildChartDataset, buildPieDataset } from "./chart-utils";
import { getChartEntry } from "./charts/chart-registry";

type ChartObjectLayerProps = {
  spreadsheet: Spreadsheet | undefined;
  root: SpreadsheetDocument;
  tabId: string;
  readOnly: boolean;
  selectedChartId: string | null;
  onSelectChart: (chartId: string) => void;
  onRequestEditChart: (chartId: string) => void;
  onDeleteChart: (chartId: string) => void;
  onUpdateChart: (chartId: string, patch: Partial<SheetChart>) => void;
  renderVersion: number;
};

type DraftLayout = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

type DragState = {
  chartId: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  startOffsetX: number;
  startOffsetY: number;
  startWidth: number;
  startHeight: number;
};

const MIN_CHART_WIDTH = 240;
const MIN_CHART_HEIGHT = 160;
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
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftLayout>>({});

  const charts = Object.values(root.sheets[tabId]?.charts || {});

  useEffect(() => {
    if (!dragState || readOnly) return;

    let latestX = dragState.startX;
    let latestY = dragState.startY;

    const toDraft = (clientX: number, clientY: number): DraftLayout => {
      // Drag deltas are in screen pixels; convert to logical pixels.
      const z = spreadsheet?.getZoom() ?? 1;
      const deltaX = (clientX - dragState.startX) / z;
      const deltaY = (clientY - dragState.startY) / z;

      if (dragState.mode === "move") {
        return {
          offsetX: dragState.startOffsetX + deltaX,
          offsetY: dragState.startOffsetY + deltaY,
          width: dragState.startWidth,
          height: dragState.startHeight,
        };
      }

      return {
        offsetX: dragState.startOffsetX,
        offsetY: dragState.startOffsetY,
        width: Math.max(MIN_CHART_WIDTH, dragState.startWidth + deltaX),
        height: Math.max(MIN_CHART_HEIGHT, dragState.startHeight + deltaY),
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      latestX = event.clientX;
      latestY = event.clientY;
      const nextDraft = toDraft(latestX, latestY);
      setDrafts((prev) => ({
        ...prev,
        [dragState.chartId]: nextDraft,
      }));
    };

    const onPointerUp = () => {
      const nextDraft = toDraft(latestX, latestY);
      onUpdateChart(dragState.chartId, nextDraft);
      setDrafts((prev) => {
        const remaining = { ...prev };
        delete remaining[dragState.chartId];
        return remaining;
      });
      setDragState(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragState, onUpdateChart, readOnly, spreadsheet]);

  if (!spreadsheet || charts.length === 0) {
    return null;
  }

  const zoom = spreadsheet.getZoom();
  const viewport = spreadsheet.getGridViewportRect();
  const scrollableViewport = spreadsheet.getScrollableGridViewportRect();
  const clipLeft = Math.max(0, scrollableViewport.left - viewport.left);
  const clipTop = Math.max(0, scrollableViewport.top - viewport.top);
  const clipWidth = Math.max(0, scrollableViewport.width);
  const clipHeight = Math.max(0, scrollableViewport.height);

  if (clipWidth === 0 || clipHeight === 0) {
    return null;
  }

  return (
    <div
      className="absolute pointer-events-none overflow-hidden"
      data-render-version={renderVersion}
      style={{
        left: viewport.left,
        top: viewport.top,
        width: viewport.width,
        height: viewport.height,
        zIndex: 4,
      }}
    >
      <div
        className="absolute pointer-events-none overflow-hidden"
        style={{
          left: clipLeft,
          top: clipTop,
          width: clipWidth,
          height: clipHeight,
        }}
      >
        <div
          className="relative h-full w-full pointer-events-none"
          style={{
            left: -clipLeft,
            top: -clipTop,
            width: viewport.width,
            height: viewport.height,
          }}
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
                    chartId: chart.id,
                    mode: "move",
                    startX: event.clientX,
                    startY: event.clientY,
                    startOffsetX: layout.offsetX,
                    startOffsetY: layout.offsetY,
                    startWidth: layout.width,
                    startHeight: layout.height,
                  });
                }}
                onResizeStart={(event) => {
                  onSelectChart(chart.id);
                  setDragState({
                    chartId: chart.id,
                    mode: "resize",
                    startX: event.clientX,
                    startY: event.clientY,
                    startOffsetX: layout.offsetX,
                    startOffsetY: layout.offsetY,
                    startWidth: layout.width,
                    startHeight: layout.height,
                  });
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
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
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
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
  const yAxisWidth = dataset ? getYAxisWidth(dataset) : 0;
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
        borderColor: selected ? "var(--color-primary)" : undefined,
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <div className="flex shrink-0 items-center justify-between border-b px-2 py-1 text-xs font-medium">
        <div
          className={`min-w-0 flex-1 ${readOnly ? "" : "cursor-move"}`}
          onPointerDown={(event) => {
            if (readOnly) return;
            event.preventDefault();
            event.stopPropagation();
            onMoveStart(event);
          }}
        >
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
              formatYAxisTick={formatYAxisTick}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Unsupported chart type
          </div>
        )}
        {!readOnly && selected && (
          <div
            className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize rounded-tl border-l border-t bg-background"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onResizeStart(event);
            }}
          />
        )}
      </div>
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

function getYAxisWidth(dataset: ReturnType<typeof buildChartDataset>): number {
  let maxLabelLength = 1;

  for (const row of dataset.rows) {
    for (const series of dataset.series) {
      const value = row[series.key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        continue;
      }

      maxLabelLength = Math.max(maxLabelLength, formatYAxisTick(value).length);
    }
  }

  return Math.min(
    MAX_Y_AXIS_WIDTH,
    Math.max(MIN_Y_AXIS_WIDTH, Math.round(maxLabelLength * 7.2 + 10)),
  );
}

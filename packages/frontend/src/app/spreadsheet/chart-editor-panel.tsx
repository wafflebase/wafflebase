import { KeyboardEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { IconChartBar, IconChartLine, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChartType, SheetChart, SpreadsheetDocument } from "@/types/worksheet";
import {
  formatA1Range,
  getDefaultChartColumns,
  parseA1Range,
  resolveChartColumns,
} from "./chart-utils";

type ChartEditorPanelProps = {
  root: SpreadsheetDocument;
  chart: SheetChart | undefined;
  open: boolean;
  onClose: () => void;
  onUpdateChart: (chartId: string, patch: Partial<SheetChart>) => void;
  getSelectionRange: () => string | null;
};

export function ChartEditorPanel({
  root,
  chart,
  open,
  onClose,
  onUpdateChart,
  getSelectionRange,
}: ChartEditorPanelProps) {
  const [rangeInput, setRangeInput] = useState("");

  useEffect(() => {
    setRangeInput(chart?.sourceRange || "");
  }, [chart?.id, chart?.sourceRange]);

  const columnSelection = chart
    ? resolveChartColumns(root, chart)
    : { columns: [], xAxisColumn: null, seriesColumns: [] };

  if (!open || !chart) {
    return null;
  }

  const sourceTabName = root.tabs[chart.sourceTabId]?.name || chart.sourceTabId;
  const xAxisColumn = columnSelection.xAxisColumn;
  const seriesCandidates = columnSelection.columns.filter(
    (column) => column.column !== xAxisColumn,
  );
  const selectedSeries = new Set(columnSelection.seriesColumns);

  const applyRange = (nextRange: string) => {
    const parsed = parseA1Range(nextRange);
    if (!parsed) {
      toast.error("Enter a valid A1 range like A1:D20.");
      return;
    }

    const rowCount = parsed[1].r - parsed[0].r + 1;
    const colCount = parsed[1].c - parsed[0].c + 1;
    if (rowCount < 2 || colCount < 2) {
      toast.error("Data range must include at least 2 rows and 2 columns.");
      return;
    }

    const normalizedRange = formatA1Range(parsed);
    const defaults = getDefaultChartColumns(parsed);

    const patch: Partial<SheetChart> = {
      sourceRange: normalizedRange,
      seriesColumns: defaults.seriesColumns,
    };
    if (defaults.xAxisColumn) {
      patch.xAxisColumn = defaults.xAxisColumn;
    }

    onUpdateChart(chart.id, patch);
    setRangeInput(normalizedRange);
  };

  const handleRangeKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applyRange(rangeInput);
  };

  const handleUseSelectionRange = () => {
    const selectionRange = getSelectionRange();
    if (!selectionRange) {
      toast.error("Select a cell range first.");
      return;
    }

    setRangeInput(selectionRange);
    applyRange(selectionRange);
  };

  const handleXAxisChange = (nextXAxisColumn: string) => {
    const availableSeriesColumns = columnSelection.columns
      .map((column) => column.column)
      .filter((column) => column !== nextXAxisColumn);
    let nextSeriesColumns = columnSelection.seriesColumns.filter((column) =>
      availableSeriesColumns.includes(column),
    );
    if (nextSeriesColumns.length === 0) {
      nextSeriesColumns = availableSeriesColumns.slice(0, 1);
    }

    onUpdateChart(chart.id, {
      xAxisColumn: nextXAxisColumn,
      seriesColumns: nextSeriesColumns,
    });
  };

  const handleSeriesToggle = (column: string, enabled: boolean) => {
    const nextSeries = new Set(columnSelection.seriesColumns);
    if (enabled) {
      nextSeries.add(column);
    } else {
      nextSeries.delete(column);
    }

    onUpdateChart(chart.id, {
      seriesColumns: Array.from(nextSeries),
    });
  };

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-80 flex-col overflow-hidden border-l bg-background shadow-lg">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Chart editor</p>
          <p className="truncate text-xs text-muted-foreground">Source: {sourceTabName}</p>
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClose}
          aria-label="Close chart editor"
        >
          <IconX size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 pb-6">
        <section className="space-y-2">
          <Label htmlFor="chart-title">Chart title</Label>
          <Input
            id="chart-title"
            value={chart.title || ""}
            onChange={(event) =>
              onUpdateChart(chart.id, {
                title: event.target.value,
              })
            }
            placeholder="Chart"
          />
        </section>

        <Separator />

        <section className="space-y-2">
          <Label htmlFor="chart-type">Chart type</Label>
          <Select
            value={chart.type}
            onValueChange={(value) => {
              onUpdateChart(chart.id, { type: value as ChartType });
            }}
          >
            <SelectTrigger id="chart-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bar">
                <span className="flex items-center gap-2">
                  <IconChartBar size={14} />
                  Bar chart
                </span>
              </SelectItem>
              <SelectItem value="line">
                <span className="flex items-center gap-2">
                  <IconChartLine size={14} />
                  Line chart
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </section>

        <Separator />

        <section className="space-y-2">
          <Label htmlFor="chart-range">Data range</Label>
          <div className="flex items-center gap-2">
            <Input
              id="chart-range"
              value={rangeInput}
              onChange={(event) => setRangeInput(event.target.value)}
              onKeyDown={handleRangeKeyDown}
              placeholder="A1:D20"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyRange(rangeInput)}
            >
              Apply
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-0"
            onClick={handleUseSelectionRange}
          >
            Use selected range
          </Button>
        </section>

        <Separator />

        <section className="space-y-2">
          <Label htmlFor="chart-x-axis">X-axis</Label>
          {columnSelection.columns.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Set a valid range to configure X-axis and series.
            </p>
          ) : (
            <Select value={xAxisColumn || ""} onValueChange={handleXAxisChange}>
              <SelectTrigger id="chart-x-axis" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {columnSelection.columns.map((column) => (
                  <SelectItem key={column.column} value={column.column}>
                    {column.column} - {column.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </section>

        <section className="space-y-2">
          <Label>Series</Label>
          {seriesCandidates.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No series columns available for this range.
            </p>
          ) : (
            <div className="space-y-2">
              {seriesCandidates.map((column) => (
                <label
                  key={column.column}
                  className="flex cursor-pointer items-center justify-between rounded-sm border px-2 py-1.5 hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{column.label}</p>
                    <p className="text-xs text-muted-foreground">{column.column}</p>
                  </div>
                  <Checkbox
                    checked={selectedSeries.has(column.column)}
                    onCheckedChange={(checked) =>
                      handleSeriesToggle(column.column, checked === true)
                    }
                  />
                </label>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

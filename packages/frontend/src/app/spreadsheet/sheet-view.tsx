import {
  initialize,
  Spreadsheet,
  Grid,
  Cell,
  Sref,
  parseRef,
  toSref,
} from "@wafflebase/sheet";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Loader } from "@/components/loader";
import { FormattingToolbar } from "@/components/formatting-toolbar";
import { useTheme } from "@/components/theme-provider";
import { useDocument } from "@yorkie-js/react";
import { SheetChart, SpreadsheetDocument } from "@/types/worksheet";
import { YorkieStore } from "./yorkie-store";
import { UserPresence } from "@/types/users";
import { useMobileSheetGestures } from "@/hooks/use-mobile-sheet-gestures";
import { toast } from "sonner";
import { getDefaultChartColumns } from "./chart-utils";

const ChartObjectLayer = lazy(() =>
  import("./chart-object-layer").then((module) => ({
    default: module.ChartObjectLayer,
  })),
);
const ChartEditorPanel = lazy(() =>
  import("./chart-editor-panel").then((module) => ({
    default: module.ChartEditorPanel,
  })),
);
const ConditionalFormatPanel = lazy(() =>
  import("./conditional-format-panel").then((module) => ({
    default: module.ConditionalFormatPanel,
  })),
);

export function SheetView({
  tabId,
  readOnly = false,
}: {
  tabId: string;
  readOnly?: boolean;
}) {
  const { resolvedTheme: theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [didMount, setDidMount] = useState(false);
  const [sheetRenderVersion, setSheetRenderVersion] = useState(0);
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const [chartEditorOpen, setChartEditorOpen] = useState(false);
  const [conditionalFormatOpen, setConditionalFormatOpen] = useState(false);
  const sheetRef = useRef<Spreadsheet | undefined>(undefined);
  const hasChartsRef = useRef(false);
  const { doc, loading, error } = useDocument<
    SpreadsheetDocument,
    UserPresence
  >();
  useMobileSheetGestures({ containerRef, sheetRef });

  const root = doc?.getRoot();
  const hasCharts = !!root && Object.keys(root.sheets[tabId]?.charts || {}).length > 0;
  const selectedChart =
    root && selectedChartId ? root.sheets[tabId]?.charts?.[selectedChartId] : undefined;

  useEffect(() => {
    hasChartsRef.current = hasCharts;
  }, [hasCharts]);

  const handleInsertChart = useCallback(() => {
    if (readOnly) return;
    const sheet = sheetRef.current;
    if (!doc || !sheet) return;

    if (sheet.getSelectionType() !== "cell") {
      toast.error("Select a cell range to insert a chart.");
      return;
    }

    const range = sheet.getSelectionRangeOrActiveCell();
    if (!range) {
      toast.error("Select a cell range to insert a chart.");
      return;
    }

    const rowCount = range[1].r - range[0].r + 1;
    const colCount = range[1].c - range[0].c + 1;
    if (rowCount < 2 || colCount < 2) {
      toast.error("Select at least 2 rows and 2 columns.");
      return;
    }

    const chartId = `chart-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const sourceRange = `${toSref(range[0])}:${toSref(range[1])}`;
    const anchor = toSref(range[0]);
    const defaults = getDefaultChartColumns([range[0], range[1]] as const);

    doc.update((root) => {
      const ws = root.sheets[tabId];
      if (!ws.charts) {
        ws.charts = {};
      }

      ws.charts[chartId] = {
        id: chartId,
        type: "bar",
        title: "Chart",
        sourceTabId: tabId,
        sourceRange,
        xAxisColumn: defaults.xAxisColumn || undefined,
        seriesColumns: defaults.seriesColumns,
        anchor,
        offsetX: 8,
        offsetY: 8,
        width: 420,
        height: 260,
      } as SheetChart;
    });

    setSelectedChartId(chartId);
    setChartEditorOpen(true);
    setConditionalFormatOpen(false);
  }, [doc, readOnly, tabId]);

  const handleUpdateChart = useCallback(
    (chartId: string, patch: Partial<SheetChart>) => {
      if (readOnly || !doc) return;

      doc.update((root) => {
        const chart = root.sheets[tabId]?.charts?.[chartId];
        if (!chart) return;

        if (patch.anchor !== undefined) chart.anchor = patch.anchor;
        if (patch.offsetX !== undefined) chart.offsetX = patch.offsetX;
        if (patch.offsetY !== undefined) chart.offsetY = patch.offsetY;
        if (patch.width !== undefined) chart.width = patch.width;
        if (patch.height !== undefined) chart.height = patch.height;
        if (patch.title !== undefined) chart.title = patch.title;
        if (patch.sourceRange !== undefined) chart.sourceRange = patch.sourceRange;
        if (patch.type !== undefined) chart.type = patch.type;
        if (patch.sourceTabId !== undefined) chart.sourceTabId = patch.sourceTabId;
        if (patch.xAxisColumn !== undefined) chart.xAxisColumn = patch.xAxisColumn;
        if (patch.seriesColumns !== undefined) {
          chart.seriesColumns = [...patch.seriesColumns];
        }
      });
    },
    [doc, readOnly, tabId],
  );

  const handleDeleteChart = useCallback(
    (chartId: string) => {
      if (readOnly || !doc) return;

      doc.update((root) => {
        const ws = root.sheets[tabId];
        if (!ws?.charts?.[chartId]) return;
        delete ws.charts[chartId];
      });

      if (selectedChartId === chartId) {
        setSelectedChartId(null);
        setChartEditorOpen(false);
      }
    },
    [doc, readOnly, selectedChartId, tabId],
  );

  const handleEditChart = useCallback((chartId: string) => {
    setSelectedChartId(chartId);
    setChartEditorOpen(true);
    setConditionalFormatOpen(false);
  }, []);

  const handleOpenConditionalFormat = useCallback(() => {
    setConditionalFormatOpen(true);
    setChartEditorOpen(false);
  }, []);

  const getSelectionRange = useCallback(() => {
    const sheet = sheetRef.current;
    if (!sheet) return null;
    if (sheet.getSelectionType() !== "cell") return null;

    const range = sheet.getSelectionRangeOrActiveCell();
    if (!range) return null;
    return `${toSref(range[0])}:${toSref(range[1])}`;
  }, []);

  const handleGridPointerDown = useCallback(() => {
    if (selectedChartId !== null) {
      setSelectedChartId(null);
    }
    if (chartEditorOpen) {
      setChartEditorOpen(false);
    }
    if (conditionalFormatOpen) {
      setConditionalFormatOpen(false);
    }
  }, [chartEditorOpen, conditionalFormatOpen, selectedChartId]);

  useEffect(() => {
    setSelectedChartId(null);
    setChartEditorOpen(false);
    setConditionalFormatOpen(false);
  }, [tabId]);

  // NOTE(hackerwins): To prevent initialization of the spreadsheet
  // twice in development.
  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!didMount || !container || !doc) {
      return;
    }

    let sheet: Awaited<ReturnType<typeof initialize>> | undefined;
    const unsubs: Array<() => void> = [];
    let cancelled = false;
    let recalcInFlight = false;
    let recalcPending = false;
    let selectionFrame: number | null = null;
    let overlayFrame: number | null = null;
    let recalcFrame: number | null = null;

    initialize(container, {
      theme,
      store: new YorkieStore(doc, tabId),
      readOnly,
    }).then((s) => {
      if (cancelled) {
        s.cleanup();
        return;
      }

      sheet = s;
      sheetRef.current = s;
      setSheetRenderVersion((v) => v + 1);

      // Track sheet render cycles (scroll/selection/edits) so floating chart
      // objects stay aligned with the canvas viewport.
      unsubs.push(
        s.onSelectionChange(() => {
          if (!hasChartsRef.current || selectionFrame !== null) {
            return;
          }
          selectionFrame = requestAnimationFrame(() => {
            selectionFrame = null;
            setSheetRenderVersion((v) => v + 1);
          });
        }),
      );

      const runCrossSheetRecalc = () => {
        if (cancelled || !sheet) return;
        if (recalcInFlight) {
          recalcPending = true;
          return;
        }

        recalcInFlight = true;
        sheet
          .reloadDimensions()
          .then(() => {
            if (cancelled || !sheet) return;
            return sheet.recalculateCrossSheetFormulas();
          })
          .finally(() => {
            recalcInFlight = false;
            if (recalcPending) {
              recalcPending = false;
              queueMicrotask(runCrossSheetRecalc);
            }
          });
      };

      const scheduleCrossSheetRecalc = () => {
        if (cancelled || recalcFrame !== null) return;
        recalcFrame = requestAnimationFrame(() => {
          recalcFrame = null;
          runCrossSheetRecalc();
        });
      };

      const scheduleOverlayRender = () => {
        if (overlayFrame !== null) return;
        overlayFrame = requestAnimationFrame(() => {
          overlayFrame = null;
          if (!cancelled && sheet) {
            sheet.renderOverlay();
          }
        });
      };

      // Wire up cross-sheet formula resolver
      s.setGridResolver(
        (sheetName: string, refs: Set<Sref>): Grid | undefined => {
          const root = doc.getRoot();
          // Find tab by name (case-insensitive)
          const targetTab = Object.values(root.tabs).find(
            (tab) => tab.name.toUpperCase() === sheetName,
          );
          if (!targetTab) return undefined;

          const ws = root.sheets[targetTab.id];
          if (!ws) return undefined;

          const coverToAnchor = new Map<Sref, Sref>();
          if (ws.merges) {
            for (const [anchorSref, span] of Object.entries(ws.merges)) {
              const anchorRef = parseRef(anchorSref);
              for (let r = anchorRef.r; r < anchorRef.r + span.rs; r++) {
                for (let c = anchorRef.c; c < anchorRef.c + span.cs; c++) {
                  const covered = toSref({ r, c });
                  if (covered === anchorSref) continue;
                  coverToAnchor.set(covered, anchorSref);
                }
              }
            }
          }

          const grid: Grid = new Map();
          for (const localRef of refs) {
            const ref = parseRef(localRef);
            const sref = toSref(ref);
            const anchorSref = coverToAnchor.get(sref) || sref;
            const cellData = ws.sheet[anchorSref];
            if (cellData) {
              grid.set(localRef, cellData as Cell);
            }
          }
          return grid;
        },
      );

      // Recalculate cross-sheet formulas on initial load (tab switch)
      // so that any changes made in other sheets are reflected immediately.
      runCrossSheetRecalc();

      // TODO(hackerwins): We need to optimize the rendering performance.
      unsubs.push(
        doc.subscribe((e) => {
          if (e.type === "remote-change") {
            scheduleCrossSheetRecalc();
          }
        }),
      );
      unsubs.push(doc.subscribe("presence", scheduleOverlayRender));
    });

    return () => {
      cancelled = true;
      if (sheet) {
        sheet.cleanup();
      }
      sheetRef.current = undefined;
      if (selectionFrame !== null) {
        cancelAnimationFrame(selectionFrame);
      }
      if (overlayFrame !== null) {
        cancelAnimationFrame(overlayFrame);
      }
      if (recalcFrame !== null) {
        cancelAnimationFrame(recalcFrame);
      }

      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, [didMount, containerRef, doc, tabId, readOnly, theme]);

  useEffect(() => {
    if (!selectedChartId) return;
    if (!root?.sheets[tabId]?.charts?.[selectedChartId]) {
      setSelectedChartId(null);
      setChartEditorOpen(false);
    }
  }, [root, selectedChartId, tabId]);

  if (loading) {
    return <Loader />;
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-red-500">{error.message}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      {!readOnly && (
        <FormattingToolbar
          spreadsheet={sheetRef.current}
          onInsertChart={handleInsertChart}
          onOpenConditionalFormat={handleOpenConditionalFormat}
        />
      )}
      <div className="relative flex-1 w-full">
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{ touchAction: "manipulation" }}
          onPointerDown={handleGridPointerDown}
        />
        {root && hasCharts && (
          <Suspense fallback={null}>
            <ChartObjectLayer
              spreadsheet={sheetRef.current}
              root={root}
              tabId={tabId}
              readOnly={readOnly}
              selectedChartId={selectedChartId}
              onSelectChart={setSelectedChartId}
              onRequestEditChart={handleEditChart}
              onDeleteChart={handleDeleteChart}
              onUpdateChart={handleUpdateChart}
              renderVersion={sheetRenderVersion}
            />
          </Suspense>
        )}
        {root && !readOnly && chartEditorOpen && (
          <Suspense fallback={null}>
            <ChartEditorPanel
              root={root}
              chart={selectedChart}
              open={chartEditorOpen}
              onClose={() => setChartEditorOpen(false)}
              onUpdateChart={handleUpdateChart}
              getSelectionRange={getSelectionRange}
            />
          </Suspense>
        )}
        {!readOnly && conditionalFormatOpen && (
          <Suspense fallback={null}>
            <ConditionalFormatPanel
              spreadsheet={sheetRef.current}
              open={conditionalFormatOpen}
              onClose={() => setConditionalFormatOpen(false)}
              getSelectionRange={getSelectionRange}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export default SheetView;

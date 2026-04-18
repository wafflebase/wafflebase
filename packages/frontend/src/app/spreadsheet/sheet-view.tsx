import {
  initialize,
  Spreadsheet,
  Grid,
  Cell,
  CellStyle,
  Ref,
  Sref,
  getWorksheetCell,
  parseRef,
  toSref,
} from "@wafflebase/sheets";
import {
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Loader } from "@/components/loader";
import { FormattingToolbar } from "@/components/formatting-toolbar";
import { useTheme } from "@/components/theme-provider";
import { useDocument } from "@yorkie-js/react";
import type { SheetImage } from "@wafflebase/sheets";
import { SheetChart, SpreadsheetDocument } from "@/types/worksheet";
import { uploadImageFile } from "./image-upload";
import { YorkieStore } from "./yorkie-store";
import { needsRecalc } from "./remote-change-utils";
import { UserPresence } from "@/types/users";
import { useMobileSheetGestures } from "@/hooks/use-mobile-sheet-gestures";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileEditPanel } from "@/components/mobile-edit-panel";
import { SheetContextMenu } from "@/components/sheet-context-menu";
import { FindBar } from "@/components/find-bar";
import { toast } from "sonner";
import { getDefaultChartColumns } from "./chart-utils";

function isDefaultLikeStyle(style: CellStyle | undefined): boolean {
  if (!style) {
    return true;
  }

  const isFalseOrUnset = (value: boolean | undefined) => value === undefined || value === false;
  const isDefaultTextAlign = style.al === undefined || style.al === "left";
  const isDefaultVerticalAlign = style.va === undefined || style.va === "top";
  const isDefaultNumberFormat = style.nf === undefined || style.nf === "plain";
  const isDefaultDecimalPlaces = style.dp === undefined || style.dp === 2;
  const isDefaultTextColor = style.tc === undefined || style.tc === "";
  const isDefaultBackgroundColor = style.bg === undefined || style.bg === "";
  const isDefaultCurrency = style.cu === undefined || style.cu === "";

  return (
    isFalseOrUnset(style.b) &&
    isFalseOrUnset(style.i) &&
    isFalseOrUnset(style.u) &&
    isFalseOrUnset(style.st) &&
    isFalseOrUnset(style.bt) &&
    isFalseOrUnset(style.br) &&
    isFalseOrUnset(style.bb) &&
    isFalseOrUnset(style.bl) &&
    isDefaultTextColor &&
    isDefaultBackgroundColor &&
    isDefaultTextAlign &&
    isDefaultVerticalAlign &&
    isDefaultNumberFormat &&
    isDefaultDecimalPlaces &&
    isDefaultCurrency
  );
}

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
const PivotEditorPanel = lazy(() =>
  import("./pivot/pivot-editor-panel").then((module) => ({
    default: module.PivotEditorPanel,
  })),
);
const ImageObjectLayer = lazy(() =>
  import("./image-object-layer").then((module) => ({
    default: module.ImageObjectLayer,
  })),
);

/**
 * Renders the SheetView component.
 */
export function SheetView({
  tabId,
  readOnly = false,
  peerJumpTarget = null,
  addPivotTab,
  workspaceId,
}: {
  tabId: string;
  readOnly?: boolean;
  peerJumpTarget?: {
    activeCell: NonNullable<UserPresence["activeCell"]>;
    targetTabId?: UserPresence["activeTabId"];
    requestId: number;
  } | null;
  addPivotTab?: (sourceTabId: string, sourceRange: string) => void;
  workspaceId?: string;
}) {
  const { resolvedTheme: theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [didMount, setDidMount] = useState(false);
  const [sheetRenderVersion, setSheetRenderVersion] = useState(0);
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [chartEditorOpen, setChartEditorOpen] = useState(false);
  const [conditionalFormatOpen, setConditionalFormatOpen] = useState(false);
  const [paintFormatActive, setPaintFormatActive] = useState(false);
  const [paintFormatSourceRef, setPaintFormatSourceRef] = useState<Ref | null>(
    null,
  );
  const [paintFormatSourceIndicatorVisible, setPaintFormatSourceIndicatorVisible] =
    useState(false);
  const [findBarOpen, setFindBarOpen] = useState(false);
  const isMobile = useIsMobile();
  const [mobileEditState, setMobileEditState] = useState<{
    cellRef: string;
    value: string;
  } | null>(null);
  const mobileEditValueRef = useRef<string>("");
  const mobileEditOpenedAtRef = useRef<number>(0);
  const isMobileRef = useRef(isMobile);
  useEffect(() => {
    isMobileRef.current = isMobile;
  }, [isMobile]);
  const lastHandledPeerJumpRequestIdRef = useRef(0);
  const sheetRef = useRef<Spreadsheet | undefined>(undefined);
  const hasChartsRef = useRef(false);
  const hasImagesRef = useRef(false);
  const paintFormatActiveRef = useRef(false);
  const paintFormatPointerDownRef = useRef(false);
  const paintFormatApplyPendingRef = useRef(false);
  const paintFormatApplyingRef = useRef(false);
  const paintFormatUseDefaultStyleRef = useRef(false);
  const paintFormatSourceIndicatorVisibleRef = useRef(false);
  const paintFormatStyleRef = useRef<Partial<CellStyle> | undefined>(undefined);
  const { doc, loading, error } = useDocument<
    SpreadsheetDocument,
    UserPresence
  >();
  useMobileSheetGestures({ containerRef, sheetRef });

  const [pivotEditorOpen, setPivotEditorOpen] = useState(false);
  const root = doc?.getRoot();
  const hasCharts = !!root && Object.keys(root.sheets[tabId]?.charts || {}).length > 0;
  const hasImages = !!root && Object.keys(root.sheets[tabId]?.images || {}).length > 0;
  const selectedChart =
    root && selectedChartId ? root.sheets[tabId]?.charts?.[selectedChartId] : undefined;

  // Detect whether the active tab is a pivot sheet via TabMeta.kind
  // (avoids reading deeply nested pivotTable from Yorkie CRDT proxy)
  const isPivotTab = root?.tabs[tabId]?.kind === "pivot";

  useEffect(() => {
    // Auto-open pivot editor when switching to a pivot tab
    if (isPivotTab) {
      setPivotEditorOpen(true);
    } else {
      setPivotEditorOpen(false);
    }
  }, [isPivotTab, tabId]);

  useEffect(() => {
    hasChartsRef.current = hasCharts;
  }, [hasCharts]);

  useEffect(() => {
    hasImagesRef.current = hasImages;
  }, [hasImages]);

  const clearPaintFormatState = useCallback(() => {
    paintFormatActiveRef.current = false;
    paintFormatPointerDownRef.current = false;
    paintFormatApplyPendingRef.current = false;
    paintFormatApplyingRef.current = false;
    paintFormatUseDefaultStyleRef.current = false;
    paintFormatSourceIndicatorVisibleRef.current = false;
    paintFormatStyleRef.current = undefined;
    setPaintFormatActive(false);
    setPaintFormatSourceRef(null);
    setPaintFormatSourceIndicatorVisible(false);
  }, []);

  useEffect(() => {
    paintFormatActiveRef.current = paintFormatActive;
  }, [paintFormatActive]);

  useEffect(() => {
    paintFormatSourceIndicatorVisibleRef.current = paintFormatSourceIndicatorVisible;
  }, [paintFormatSourceIndicatorVisible]);

  useEffect(() => {
    if (!paintFormatActive) return;

    const handlePointerUp = () => {
      if (!paintFormatPointerDownRef.current) return;
      paintFormatPointerDownRef.current = false;
      paintFormatApplyPendingRef.current = true;
      paintFormatSourceIndicatorVisibleRef.current = false;
      setPaintFormatSourceIndicatorVisible(false);
    };

    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [paintFormatActive]);

  const handleTogglePaintFormat = useCallback(async () => {
    const sheet = sheetRef.current;
    if (readOnly || !sheet) return;

    if (paintFormatActiveRef.current) {
      clearPaintFormatState();
      return;
    }

    const sourceStyle = await sheet.getActiveStyle();
    const useDefaultStyle = isDefaultLikeStyle(sourceStyle);
    const sourceRef = sheet.getActiveCell();
    if (!sourceRef) {
      return;
    }

    paintFormatStyleRef.current = useDefaultStyle
      ? undefined
      : { ...sourceStyle };
    paintFormatPointerDownRef.current = false;
    paintFormatApplyPendingRef.current = false;
    paintFormatApplyingRef.current = false;
    paintFormatUseDefaultStyleRef.current = useDefaultStyle;
    paintFormatSourceIndicatorVisibleRef.current = false;
    paintFormatActiveRef.current = true;
    setPaintFormatActive(true);
    setPaintFormatSourceRef({ ...sourceRef });
    setPaintFormatSourceIndicatorVisible(false);
    setSelectedChartId(null);
    setChartEditorOpen(false);
    setConditionalFormatOpen(false);
  }, [clearPaintFormatState, readOnly]);

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
        if (patch.legendPosition !== undefined) {
          chart.legendPosition = patch.legendPosition;
        }
        if (patch.showGridlines !== undefined) {
          chart.showGridlines = patch.showGridlines;
        }
        if (patch.colorPalette !== undefined) {
          chart.colorPalette = patch.colorPalette;
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

  const handleInsertImage = useCallback(
    async (file: File, dropPoint?: { clientX: number; clientY: number }) => {
      if (readOnly || !doc || !workspaceId) return;
      try {
        const result = await uploadImageFile(file, workspaceId);
        const sheet = sheetRef.current;
        let anchor: string;
        let offsetX = 8;
        let offsetY = 8;

        if (dropPoint && sheet) {
          const ref = sheet.cellRefFromPoint(dropPoint.clientX, dropPoint.clientY);
          anchor = ref ? toSref(ref) : 'A1';
          if (ref) {
            const rect = sheet.cellBoundingRect(ref);
            if (rect) {
              offsetX = dropPoint.clientX - rect.left;
              offsetY = dropPoint.clientY - rect.top;
            }
          }
        } else {
          const activeCell = sheet?.getActiveCell();
          anchor = activeCell ? toSref(activeCell) : 'A1';
        }
        const imageId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        doc.update((root) => {
          const ws = root.sheets[tabId];
          if (!ws.images) {
            ws.images = {};
          }
          ws.images[imageId] = {
            id: imageId,
            src: result.url,
            anchor,
            offsetX,
            offsetY,
            width: Math.min(result.width, 400),
            height: Math.min(result.width, 400) * (result.height / result.width),
            originalWidth: result.width,
            originalHeight: result.height,
          } as SheetImage;
        });

        setSelectedImageId(imageId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Image upload failed');
      }
    },
    [doc, readOnly, tabId, workspaceId],
  );

  const handleUpdateImage = useCallback(
    (imageId: string, patch: Partial<SheetImage>) => {
      if (readOnly || !doc) return;
      doc.update((root) => {
        const image = root.sheets[tabId]?.images?.[imageId];
        if (!image) return;
        if (patch.anchor !== undefined) image.anchor = patch.anchor;
        if (patch.offsetX !== undefined) image.offsetX = patch.offsetX;
        if (patch.offsetY !== undefined) image.offsetY = patch.offsetY;
        if (patch.width !== undefined) image.width = patch.width;
        if (patch.height !== undefined) image.height = patch.height;
      });
    },
    [doc, readOnly, tabId],
  );

  const handleDeleteImage = useCallback(
    (imageId: string) => {
      if (readOnly || !doc) return;
      doc.update((root) => {
        const ws = root.sheets[tabId];
        if (!ws?.images?.[imageId]) return;
        delete ws.images[imageId];
      });
      if (selectedImageId === imageId) {
        setSelectedImageId(null);
      }
    },
    [doc, readOnly, selectedImageId, tabId],
  );

  const handleDragOver = useCallback((e: ReactDragEvent) => {
    if (readOnly) return;
    const hasImage = Array.from(e.dataTransfer.items).some((item) =>
      item.type.startsWith('image/'),
    );
    if (hasImage) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, [readOnly]);

  const handleDrop = useCallback(
    (e: ReactDragEvent) => {
      if (readOnly) return;
      e.preventDefault();
      const file = Array.from(e.dataTransfer.files).find((f) =>
        f.type.startsWith('image/'),
      );
      if (!file) return;
      void handleInsertImage(file, { clientX: e.clientX, clientY: e.clientY });
    },
    [readOnly, handleInsertImage],
  );

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (readOnly) return;
      const imageFile = Array.from(e.clipboardData?.items || [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .find((f): f is File => f !== null);

      if (imageFile) {
        e.preventDefault();
        void handleInsertImage(imageFile);
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [readOnly, handleInsertImage]);

  const handleOpenConditionalFormat = useCallback(() => {
    setConditionalFormatOpen(true);
    setChartEditorOpen(false);
  }, []);

  const handleInsertPivotTable = useCallback(() => {
    if (readOnly || !addPivotTab) return;
    const sheet = sheetRef.current;
    if (!sheet) return;

    if (sheet.getSelectionType() !== "cell") {
      toast.error("Select a cell range to create a pivot table.");
      return;
    }

    const range = sheet.getSelectionRangeOrActiveCell();
    if (!range) {
      toast.error("Select a cell range to create a pivot table.");
      return;
    }

    const rowCount = range[1].r - range[0].r + 1;
    const colCount = range[1].c - range[0].c + 1;
    if (rowCount < 2 || colCount < 1) {
      toast.error("Select at least 2 rows and 1 column.");
      return;
    }

    const sourceRange = `${toSref(range[0])}:${toSref(range[1])}`;
    addPivotTab(tabId, sourceRange);
  }, [addPivotTab, readOnly, tabId]);

  const getSelectionRange = useCallback(() => {
    const sheet = sheetRef.current;
    if (!sheet) return null;
    if (sheet.getSelectionType() !== "cell") return null;

    const ranges = sheet.getSelectionRanges();
    if (ranges.length === 0) return null;
    return ranges
      .map((r) => `${toSref(r[0])}:${toSref(r[1])}`)
      .join(", ");
  }, []);

  const handleGridPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        paintFormatActiveRef.current &&
        event.pointerType === "mouse" &&
        paintFormatSourceRef
      ) {
        paintFormatSourceIndicatorVisibleRef.current = true;
        setPaintFormatSourceIndicatorVisible(true);
      }
      if (paintFormatActiveRef.current) {
        if (event.pointerType !== "mouse") {
          paintFormatSourceIndicatorVisibleRef.current = false;
          setPaintFormatSourceIndicatorVisible(false);
        }
        paintFormatPointerDownRef.current = true;
        paintFormatApplyPendingRef.current = false;
      }
      if (selectedChartId !== null) {
        setSelectedChartId(null);
      }
      if (selectedImageId !== null) {
        setSelectedImageId(null);
      }
      if (chartEditorOpen) {
        setChartEditorOpen(false);
      }
      if (conditionalFormatOpen) {
        setConditionalFormatOpen(false);
      }
    },
    [chartEditorOpen, conditionalFormatOpen, paintFormatSourceRef, selectedChartId, selectedImageId],
  );

  const handleMobileEditCommit = useCallback(
    async (value: string) => {
      const sheet = sheetRef.current;
      if (sheet) {
        await sheet.commitExternalEdit(value);
      }
      setMobileEditState(null);
    },
    [],
  );

  const handleMobileEditCancel = useCallback(() => {
    setMobileEditState(null);
  }, []);

  const handleMobileEditValueChange = useCallback((value: string) => {
    mobileEditValueRef.current = value;
  }, []);

  const handleContextMenuCopy = useCallback(async () => {
    await sheetRef.current?.copy();
  }, []);

  const handleContextMenuCut = useCallback(async () => {
    await sheetRef.current?.cut();
  }, []);

  const handleContextMenuPaste = useCallback(async () => {
    await sheetRef.current?.paste();
  }, []);

  const handleContextMenuDelete = useCallback(async () => {
    await sheetRef.current?.removeData();
  }, []);

  const handleInsertBefore = useCallback(async () => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const sel = sheet.getSelectedIndices();
    if (!sel) return;
    const count = sel.to - sel.from + 1;
    if (sel.axis === "row") {
      await sheet.insertRows(sel.from, count);
    } else {
      await sheet.insertColumns(sel.from, count);
    }
  }, []);

  const handleInsertAfter = useCallback(async () => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const sel = sheet.getSelectedIndices();
    if (!sel) return;
    const count = sel.to - sel.from + 1;
    if (sel.axis === "row") {
      await sheet.insertRows(sel.to + 1, count);
    } else {
      await sheet.insertColumns(sel.to + 1, count);
    }
  }, []);

  const handleDeleteRowCol = useCallback(async () => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const sel = sheet.getSelectedIndices();
    if (!sel) return;
    const count = sel.to - sel.from + 1;
    if (sel.axis === "row") {
      await sheet.deleteRows(sel.from, count);
    } else {
      await sheet.deleteColumns(sel.from, count);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setFindBarOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleFindBarClose = useCallback(() => {
    setFindBarOpen(false);
  }, []);

  useEffect(() => {
    setSelectedChartId(null);
    setSelectedImageId(null);
    setChartEditorOpen(false);
    setConditionalFormatOpen(false);
    setFindBarOpen(false);
    clearPaintFormatState();
  }, [clearPaintFormatState, tabId]);

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
      hideFormulaBar: isMobileRef.current,
      hideAutofillHandle: isMobileRef.current,
      showMobileHandles: isMobileRef.current,
    }).then((s) => {
      if (cancelled) {
        s.cleanup();
        return;
      }

      sheet = s;
      sheetRef.current = s;
      setSheetRenderVersion((v) => v + 1);

      if (isMobileRef.current && !readOnly) {
        s.setMobileEditCallback((cellRef, value) => {
          mobileEditValueRef.current = value;
          mobileEditOpenedAtRef.current = Date.now();
          setMobileEditState({ cellRef, value });
        });
      }

      // Track sheet render cycles (scroll/selection/edits) so floating chart
      // objects stay aligned with the canvas viewport.
      unsubs.push(
        s.onSelectionChange(() => {
          if (
            (hasChartsRef.current || hasImagesRef.current || paintFormatSourceIndicatorVisibleRef.current || isMobileRef.current) &&
            selectionFrame === null
          ) {
            selectionFrame = requestAnimationFrame(() => {
              selectionFrame = null;
              setSheetRenderVersion((v) => v + 1);
            });
          }

          if (
            !paintFormatActiveRef.current ||
            !paintFormatApplyPendingRef.current ||
            paintFormatApplyingRef.current
          ) {
            return;
          }

          paintFormatApplyPendingRef.current = false;
          if (s.getSelectionType() !== "cell") {
            return;
          }

          paintFormatApplyingRef.current = true;
          const styleToApply = paintFormatStyleRef.current;
          const applyPromise = paintFormatUseDefaultStyleRef.current
            ? s.applyDefaultStyle()
            : styleToApply
              ? s.applyStyle(styleToApply)
              : s.applyDefaultStyle();
          void applyPromise.finally(() => {
            clearPaintFormatState();
          });
        }),
      );

      unsubs.push(
        s.onSelectionChange(() => {
          setMobileEditState((prev) => {
            if (!prev) return null;
            // Guard against synthesized mouse events that iOS browsers
            // fire after touchend despite preventDefault().  These cause
            // a selectStart → selectionChange that would immediately
            // dismiss the mobile edit panel after a double-tap opens it.
            if (Date.now() - mobileEditOpenedAtRef.current < 500) {
              return prev;
            }
            const currentValue = mobileEditValueRef.current;
            if (currentValue !== prev.value) {
              void sheetRef.current?.commitExternalEdit(currentValue);
            }
            return null;
          });
        }),
      );

      const runRemoteSync = (needsRecalc: boolean) => {
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
            if (needsRecalc) {
              return sheet.recalculateCrossSheetFormulas();
            }
            sheet.render();
          })
          .finally(() => {
            recalcInFlight = false;
            if (recalcPending) {
              recalcPending = false;
              queueMicrotask(() => runRemoteSync(needsRecalc));
            }
          });
      };

      const scheduleRemoteSync = (needsRecalc: boolean) => {
        if (cancelled || recalcFrame !== null) return;
        recalcFrame = requestAnimationFrame(() => {
          recalcFrame = null;
          runRemoteSync(needsRecalc);
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
          // Find a worksheet tab by name (case-insensitive).
          const targetTabId = root.tabOrder.find((candidateTabId: string) => {
            const tab = root.tabs[candidateTabId];
            return (
              tab?.type === "sheet" &&
              tab.name.toUpperCase() === sheetName
            );
          });
          if (!targetTabId) return undefined;

          const ws = root.sheets[targetTabId];
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
            const cellData = getWorksheetCell(ws, parseRef(anchorSref));
            if (cellData) {
              grid.set(localRef, cellData as Cell);
            }
          }
          return grid;
        },
      );

      // Wire up FormulaResolver for cross-sheet cycle detection
      const currentTabName = doc.getRoot().tabs[tabId]?.name ?? '';
      s.setFormulaResolver(
        (sheetName: string): Map<string, string> | undefined => {
          const root = doc.getRoot();
          const targetTabId = root.tabOrder.find((candidateTabId: string) => {
            const tab = root.tabs[candidateTabId];
            return (
              tab?.type === "sheet" &&
              tab.name.toUpperCase() === sheetName
            );
          });
          if (!targetTabId) return undefined;

          const ws = root.sheets[targetTabId];
          if (!ws?.cells) return undefined;

          const formulas = new Map<string, string>();
          for (const [rowStr, cols] of Object.entries(ws.cells)) {
            if (!cols || typeof cols !== 'object') continue;
            for (const [colStr, cellData] of Object.entries(
              cols as Record<string, unknown>,
            )) {
              const cell = cellData as { f?: string } | undefined;
              if (cell?.f) {
                const r = parseInt(rowStr, 10);
                const c = parseInt(colStr, 10);
                formulas.set(toSref({ r, c }), cell.f);
              }
            }
          }
          return formulas;
        },
        currentTabName,
      );

      // Recalculate cross-sheet formulas on initial load (tab switch)
      // so that any changes made in other sheets are reflected immediately.
      runRemoteSync(true);

      // Re-render on any remote change. Cell/merge/tab-name changes also
      // trigger cross-sheet formula recalculation; all other changes
      // (styles, dimensions, charts, filters, etc.) only reload state and
      // re-render without the expensive recalc pass.
      unsubs.push(
        doc.subscribe((e) => {
          if (e.type !== "remote-change") return;
          const ops = (
            e as { value?: { operations?: Array<{ path?: string }> } }
          ).value?.operations;
          scheduleRemoteSync(needsRecalc(ops));
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
  }, [clearPaintFormatState, didMount, containerRef, doc, tabId, readOnly, theme]);

  useEffect(() => {
    if (!selectedChartId) return;
    if (!root?.sheets[tabId]?.charts?.[selectedChartId]) {
      setSelectedChartId(null);
      setChartEditorOpen(false);
    }
  }, [root, selectedChartId, tabId]);

  useEffect(() => {
    if (!peerJumpTarget) return;
    if (peerJumpTarget.targetTabId && peerJumpTarget.targetTabId !== tabId) {
      return;
    }
    if (peerJumpTarget.requestId === lastHandledPeerJumpRequestIdRef.current) {
      return;
    }

    const sheet = sheetRef.current;
    if (!sheet) return;

    lastHandledPeerJumpRequestIdRef.current = peerJumpTarget.requestId;
    setSelectedChartId(null);
    setChartEditorOpen(false);
    setConditionalFormatOpen(false);

    try {
      void sheet.focusCell(parseRef(peerJumpTarget.activeCell));
    } catch {
      // Ignore malformed presence values from remote peers.
    }
  }, [peerJumpTarget, sheetRenderVersion, tabId]);

  const paintFormatSourceIndicator = (() => {
    if (!paintFormatSourceIndicatorVisible || !paintFormatSourceRef) {
      return null;
    }
    const sheet = sheetRef.current;
    if (!sheet) return null;

    try {
      const viewport = sheet.getGridViewportRect();
      const sourceRect = sheet.getCellRect(paintFormatSourceRef);
      return (
        <div
          className="absolute pointer-events-none rounded-[2px]"
          style={{
            left: viewport.left + sourceRect.left,
            top: viewport.top + sourceRect.top,
            width: sourceRect.width,
            height: sourceRect.height,
            boxShadow: "inset 0 0 0 2px var(--color-primary)",
            zIndex: 12,
          }}
        />
      );
    } catch {
      return null;
    }
  })();

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
          isPivotTab={isPivotTab}
          onInsertChart={handleInsertChart}
          onInsertImage={handleInsertImage}
          onOpenConditionalFormat={handleOpenConditionalFormat}
          onTogglePaintFormat={() => {
            void handleTogglePaintFormat();
          }}
          paintFormatActive={paintFormatActive}
        />
      )}
      <div className="relative flex-1 w-full">
        <SheetContextMenu
          spreadsheet={sheetRef.current}
          readOnly={readOnly}
          onCopy={handleContextMenuCopy}
          onCut={handleContextMenuCut}
          onPaste={handleContextMenuPaste}
          onDeleteCellData={handleContextMenuDelete}
          onInsertBefore={handleInsertBefore}
          onInsertAfter={handleInsertAfter}
          onDeleteRowCol={handleDeleteRowCol}
          onInsertPivotTable={addPivotTab ? handleInsertPivotTable : undefined}
          selectedImageId={selectedImageId}
          onDeleteImage={() => {
            if (selectedImageId) {
              handleDeleteImage(selectedImageId);
            }
          }}
        >
          <div className="relative h-full w-full">
            <div
              ref={containerRef}
              className="h-full w-full select-none"
              data-sheet-container
              style={{ touchAction: "manipulation", WebkitTouchCallout: "none" }}
              onPointerDown={handleGridPointerDown}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            />
            {root && hasImages && (
              <Suspense fallback={null}>
                <ImageObjectLayer
                  spreadsheet={sheetRef.current}
                  root={root}
                  tabId={tabId}
                  readOnly={readOnly}
                  selectedImageId={selectedImageId}
                  onSelectImage={setSelectedImageId}
                  onUpdateImage={handleUpdateImage}
                  onDeleteImage={handleDeleteImage}
                  renderVersion={sheetRenderVersion}
                />
              </Suspense>
            )}
          </div>
        </SheetContextMenu>
        {findBarOpen && (
          <FindBar
            spreadsheet={sheetRef.current}
            onClose={handleFindBarClose}
          />
        )}
        {paintFormatSourceIndicator}
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
        {!readOnly && isPivotTab && !pivotEditorOpen && (
          <button
            type="button"
            className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-muted"
            onClick={() => setPivotEditorOpen(true)}
          >
            Edit pivot table
          </button>
        )}
        {!readOnly && doc && isPivotTab && pivotEditorOpen && (
          <Suspense fallback={null}>
            <PivotEditorPanel
              doc={doc}
              tabId={tabId}
              onClose={() => setPivotEditorOpen(false)}
              onRefresh={() => {
                const sheet = sheetRef.current;
                if (sheet) {
                  sheet.invalidateStore();
                  sheet.reloadDimensions().then(() => {
                    sheet.render();
                    setSheetRenderVersion((v) => v + 1);
                  });
                }
              }}
            />
          </Suspense>
        )}
        {isMobile && mobileEditState && (
          <MobileEditPanel
            cellRef={mobileEditState.cellRef}
            initialValue={mobileEditState.value}
            onCommit={handleMobileEditCommit}
            onCancel={handleMobileEditCancel}
            onValueChange={handleMobileEditValueChange}
          />
        )}
      </div>
    </div>
  );
}

export default SheetView;

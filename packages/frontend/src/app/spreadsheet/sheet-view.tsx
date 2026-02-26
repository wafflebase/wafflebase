import {
  initialize,
  Spreadsheet,
  Grid,
  Cell,
  CellStyle,
  Ref,
  Sref,
  parseRef,
  toSref,
} from "@wafflebase/sheet";
import {
  type PointerEvent as ReactPointerEvent,
  type ChangeEvent as ReactChangeEvent,
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
import { uploadImageAsset } from "@/api/image-assets";
import { SheetChart, SheetImage, SpreadsheetDocument } from "@/types/worksheet";
import { YorkieStore } from "./yorkie-store";
import { UserPresence } from "@/types/users";
import { useMobileSheetGestures } from "@/hooks/use-mobile-sheet-gestures";
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

const DEFAULT_IMAGE_WIDTH = 360;
const DEFAULT_IMAGE_HEIGHT = 240;
const MIN_IMAGE_WIDTH = 160;
const MIN_IMAGE_HEIGHT = 120;
const MAX_IMAGE_WIDTH = 640;
const MAX_IMAGE_HEIGHT = 420;

function normalizeImageTitle(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return "Image";
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0) return trimmed;
  return trimmed.slice(0, dotIndex) || "Image";
}

function fitImageDimensions(size: { width: number; height: number } | null): {
  width: number;
  height: number;
} {
  if (!size || size.width <= 0 || size.height <= 0) {
    return { width: DEFAULT_IMAGE_WIDTH, height: DEFAULT_IMAGE_HEIGHT };
  }

  const scale = Math.min(
    MAX_IMAGE_WIDTH / size.width,
    MAX_IMAGE_HEIGHT / size.height,
    1,
  );
  const scaledWidth = Math.max(MIN_IMAGE_WIDTH, Math.round(size.width * scale));
  const scaledHeight = Math.max(MIN_IMAGE_HEIGHT, Math.round(size.height * scale));
  return {
    width: scaledWidth,
    height: scaledHeight,
  };
}

async function readImageDimensions(file: File): Promise<{
  width: number;
  height: number;
} | null> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const size = await new Promise<{ width: number; height: number } | null>(
      (resolve) => {
        const image = new Image();
        image.onload = () => {
          resolve({
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
        };
        image.onerror = () => resolve(null);
        image.src = objectUrl;
      },
    );

    return size;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const ChartObjectLayer = lazy(() =>
  import("./chart-object-layer").then((module) => ({
    default: module.ChartObjectLayer,
  })),
);
const ImageObjectLayer = lazy(() =>
  import("./image-object-layer").then((module) => ({
    default: module.ImageObjectLayer,
  })),
);
const ChartEditorPanel = lazy(() =>
  import("./chart-editor-panel").then((module) => ({
    default: module.ChartEditorPanel,
  })),
);
const ImageEditorPanel = lazy(() =>
  import("./image-editor-panel").then((module) => ({
    default: module.ImageEditorPanel,
  })),
);
const ConditionalFormatPanel = lazy(() =>
  import("./conditional-format-panel").then((module) => ({
    default: module.ConditionalFormatPanel,
  })),
);

/**
 * Renders the SheetView component.
 */
export function SheetView({
  tabId,
  readOnly = false,
  peerJumpTarget = null,
}: {
  tabId: string;
  readOnly?: boolean;
  peerJumpTarget?: {
    activeCell: NonNullable<UserPresence["activeCell"]>;
    targetTabId?: UserPresence["activeTabId"];
    requestId: number;
  } | null;
}) {
  const { resolvedTheme: theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [didMount, setDidMount] = useState(false);
  const [sheetRenderVersion, setSheetRenderVersion] = useState(0);
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [chartEditorOpen, setChartEditorOpen] = useState(false);
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const [conditionalFormatOpen, setConditionalFormatOpen] = useState(false);
  const [paintFormatActive, setPaintFormatActive] = useState(false);
  const [paintFormatSourceRef, setPaintFormatSourceRef] = useState<Ref | null>(
    null,
  );
  const [paintFormatSourceIndicatorVisible, setPaintFormatSourceIndicatorVisible] =
    useState(false);
  const lastHandledPeerJumpRequestIdRef = useRef(0);
  const sheetRef = useRef<Spreadsheet | undefined>(undefined);
  const imageUploadInputRef = useRef<HTMLInputElement>(null);
  const hasFloatingObjectsRef = useRef(false);
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

  const root = doc?.getRoot();
  const hasCharts = !!root && Object.keys(root.sheets[tabId]?.charts || {}).length > 0;
  const hasImages = !!root && Object.keys(root.sheets[tabId]?.images || {}).length > 0;
  const hasFloatingObjects = hasCharts || hasImages;
  const selectedChart =
    root && selectedChartId ? root.sheets[tabId]?.charts?.[selectedChartId] : undefined;
  const selectedImage =
    root && selectedImageId ? root.sheets[tabId]?.images?.[selectedImageId] : undefined;

  useEffect(() => {
    hasFloatingObjectsRef.current = hasFloatingObjects;
  }, [hasFloatingObjects]);

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
    setSelectedImageId(null);
    setChartEditorOpen(false);
    setImageEditorOpen(false);
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
    setSelectedImageId(null);
    setImageEditorOpen(false);
    setConditionalFormatOpen(false);
  }, [doc, readOnly, tabId]);

  const handleInsertImage = useCallback(() => {
    if (readOnly) return;
    imageUploadInputRef.current?.click();
  }, [readOnly]);

  const uploadImage = useCallback(
    async (file: File, targetImageId?: string): Promise<void> => {
      if (readOnly || !doc) return;

      if (!file.type.startsWith("image/")) {
        toast.error("Select a valid image file.");
        return;
      }

      const sheet = sheetRef.current;
      if (!sheet) return;

      let anchorRef: Ref | null = null;
      if (!targetImageId) {
        const range =
          sheet.getSelectionType() === "cell"
            ? sheet.getSelectionRangeOrActiveCell()
            : null;
        anchorRef = range ? range[0] : sheet.getActiveCell();
        if (!anchorRef) {
          toast.error("Select a cell to anchor the image.");
          return;
        }
      }

      const uploaded = await uploadImageAsset(file);

      if (targetImageId) {
        doc.update((root) => {
          const image = root.sheets[tabId]?.images?.[targetImageId];
          if (!image) return;
          image.key = uploaded.key;
          image.contentType = uploaded.contentType;
        });
        return;
      }

      const naturalSize = await readImageDimensions(file);
      const fitted = fitImageDimensions(naturalSize);
      const imageId = `image-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      doc.update((root) => {
        const ws = root.sheets[tabId];
        if (!ws.images) {
          ws.images = {};
        }

        ws.images[imageId] = {
          id: imageId,
          title: normalizeImageTitle(file.name),
          alt: normalizeImageTitle(file.name),
          key: uploaded.key,
          contentType: uploaded.contentType,
          anchor: toSref(anchorRef!),
          offsetX: 8,
          offsetY: 8,
          width: fitted.width,
          height: fitted.height,
          fit: "cover",
        } as SheetImage;
      });

      setSelectedImageId(imageId);
      setImageEditorOpen(true);
      setSelectedChartId(null);
      setChartEditorOpen(false);
      setConditionalFormatOpen(false);
    },
    [doc, readOnly, tabId],
  );

  const handleImageFileChange = useCallback(
    (event: ReactChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      void (async () => {
        try {
          await uploadImage(file);
          toast.success("Image inserted.");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Failed to upload image.");
        }
      })();
    },
    [uploadImage],
  );

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
    setSelectedImageId(null);
    setChartEditorOpen(true);
    setImageEditorOpen(false);
    setConditionalFormatOpen(false);
  }, []);

  const handleSelectChart = useCallback((chartId: string) => {
    setSelectedChartId(chartId);
    setSelectedImageId(null);
    setImageEditorOpen(false);
  }, []);

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
        if (patch.title !== undefined) image.title = patch.title;
        if (patch.alt !== undefined) image.alt = patch.alt;
        if (patch.key !== undefined) image.key = patch.key;
        if (patch.contentType !== undefined) image.contentType = patch.contentType;
        if (patch.fit !== undefined) image.fit = patch.fit;
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
        setImageEditorOpen(false);
      }
    },
    [doc, readOnly, selectedImageId, tabId],
  );

  const handleEditImage = useCallback((imageId: string) => {
    setSelectedImageId(imageId);
    setSelectedChartId(null);
    setImageEditorOpen(true);
    setChartEditorOpen(false);
    setConditionalFormatOpen(false);
  }, []);

  const handleSelectImage = useCallback((imageId: string) => {
    setSelectedImageId(imageId);
    setSelectedChartId(null);
    setChartEditorOpen(false);
  }, []);

  const handleReplaceImage = useCallback(
    async (imageId: string, file: File) => {
      await uploadImage(file, imageId);
    },
    [uploadImage],
  );

  const handleOpenConditionalFormat = useCallback(() => {
    setConditionalFormatOpen(true);
    setSelectedChartId(null);
    setSelectedImageId(null);
    setChartEditorOpen(false);
    setImageEditorOpen(false);
  }, []);

  const getSelectionRange = useCallback(() => {
    const sheet = sheetRef.current;
    if (!sheet) return null;
    if (sheet.getSelectionType() !== "cell") return null;

    const range = sheet.getSelectionRangeOrActiveCell();
    if (!range) return null;
    return `${toSref(range[0])}:${toSref(range[1])}`;
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
      if (imageEditorOpen) {
        setImageEditorOpen(false);
      }
      if (conditionalFormatOpen) {
        setConditionalFormatOpen(false);
      }
    },
    [
      chartEditorOpen,
      conditionalFormatOpen,
      imageEditorOpen,
      paintFormatSourceRef,
      selectedChartId,
      selectedImageId,
    ],
  );

  useEffect(() => {
    setSelectedChartId(null);
    setSelectedImageId(null);
    setChartEditorOpen(false);
    setImageEditorOpen(false);
    setConditionalFormatOpen(false);
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
    }).then((s) => {
      if (cancelled) {
        s.cleanup();
        return;
      }

      sheet = s;
      sheetRef.current = s;
      setSheetRenderVersion((v) => v + 1);

      // Track sheet render cycles (scroll/selection/edits) so floating objects
      // stay aligned with the canvas viewport.
      unsubs.push(
        s.onSelectionChange(() => {
          if (
            (hasFloatingObjectsRef.current ||
              paintFormatSourceIndicatorVisibleRef.current) &&
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
  }, [clearPaintFormatState, didMount, containerRef, doc, tabId, readOnly, theme]);

  useEffect(() => {
    if (!selectedChartId) return;
    if (!root?.sheets[tabId]?.charts?.[selectedChartId]) {
      setSelectedChartId(null);
      setChartEditorOpen(false);
    }
  }, [root, selectedChartId, tabId]);

  useEffect(() => {
    if (!selectedImageId) return;
    if (!root?.sheets[tabId]?.images?.[selectedImageId]) {
      setSelectedImageId(null);
      setImageEditorOpen(false);
    }
  }, [root, selectedImageId, tabId]);

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
    setSelectedImageId(null);
    setChartEditorOpen(false);
    setImageEditorOpen(false);
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
        {!readOnly && (
          <input
            ref={imageUploadInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageFileChange}
          />
        )}
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{ touchAction: "manipulation" }}
          onPointerDown={handleGridPointerDown}
        />
        {paintFormatSourceIndicator}
        {root && hasCharts && (
          <Suspense fallback={null}>
            <ChartObjectLayer
              spreadsheet={sheetRef.current}
              root={root}
              tabId={tabId}
              readOnly={readOnly}
              selectedChartId={selectedChartId}
              onSelectChart={handleSelectChart}
              onRequestEditChart={handleEditChart}
              onDeleteChart={handleDeleteChart}
              onUpdateChart={handleUpdateChart}
              renderVersion={sheetRenderVersion}
            />
          </Suspense>
        )}
        {root && hasImages && (
          <Suspense fallback={null}>
            <ImageObjectLayer
              spreadsheet={sheetRef.current}
              root={root}
              tabId={tabId}
              readOnly={readOnly}
              selectedImageId={selectedImageId}
              onSelectImage={handleSelectImage}
              onRequestEditImage={handleEditImage}
              onDeleteImage={handleDeleteImage}
              onUpdateImage={handleUpdateImage}
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
        {root && !readOnly && imageEditorOpen && (
          <Suspense fallback={null}>
            <ImageEditorPanel
              image={selectedImage}
              open={imageEditorOpen}
              onClose={() => setImageEditorOpen(false)}
              onUpdateImage={handleUpdateImage}
              onReplaceImage={handleReplaceImage}
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

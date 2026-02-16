import {
  initialize,
  Spreadsheet,
  Grid,
  Cell,
  Sref,
  parseRef,
  toSref,
} from "@wafflebase/sheet";
import { useEffect, useRef, useState } from "react";
import { Loader } from "@/components/loader";
import { FormattingToolbar } from "@/components/formatting-toolbar";
import { useTheme } from "@/components/theme-provider";
import { useDocument } from "@yorkie-js/react";
import { SpreadsheetDocument } from "@/types/worksheet";
import { YorkieStore } from "./yorkie-store";
import { UserPresence } from "@/types/users";

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
  const sheetRef = useRef<Spreadsheet | undefined>(undefined);
  const { doc, loading, error } = useDocument<
    SpreadsheetDocument,
    UserPresence
  >();

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
    let unsubs: Array<Function> = [];
    let cancelled = false;
    let recalcInFlight = false;
    let recalcPending = false;

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

          const grid: Grid = new Map();
          for (const localRef of refs) {
            const ref = parseRef(localRef);
            const sref = toSref(ref);
            const cellData = ws.sheet[sref];
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
            runCrossSheetRecalc();
          }
        }),
      );
      unsubs.push(doc.subscribe("presence", () => sheet!.renderOverlay()));
    });

    return () => {
      cancelled = true;
      if (sheet) {
        sheet.cleanup();
      }
      sheetRef.current = undefined;

      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, [didMount, containerRef, doc, tabId, readOnly]);

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
      {!readOnly && <FormattingToolbar spreadsheet={sheetRef.current} />}
      <div ref={containerRef} className="flex-1 w-full" />
    </div>
  );
}

export default SheetView;

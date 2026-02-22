import { initialize, ReadOnlyStore, Spreadsheet } from "@wafflebase/sheet";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDocument } from "@yorkie-js/react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { executeDataSourceQuery } from "@/api/datasources";
import { isAuthExpiredError } from "@/api/auth";
import { Loader } from "@/components/loader";
import { IconPlayerPlay } from "@tabler/icons-react";
import type { SpreadsheetDocument } from "@/types/worksheet";
import type { UserPresence } from "@/types/users";
import type { QueryResult } from "@/types/datasource";
import { useMobileSheetGestures } from "@/hooks/use-mobile-sheet-gestures";

/**
 * Renders the DataSourceView component.
 */
export function DataSourceView({
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
  const storeRef = useRef<ReadOnlyStore>(new ReadOnlyStore());
  const { doc, loading, error } =
    useDocument<SpreadsheetDocument, UserPresence>();

  const [query, setQuery] = useState("");
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  useMobileSheetGestures({ containerRef, sheetRef });

  // Prevent double initialization in dev
  useEffect(() => {
    setDidMount(true);
  }, []);

  // Load saved query from Yorkie document on mount
  useEffect(() => {
    if (!doc) return;
    const root = doc.getRoot();
    const tab = root.tabs[tabId];
    if (tab?.query) {
      setQuery(tab.query);
    }
  }, [doc, tabId]);

  // Initialize spreadsheet canvas
  useEffect(() => {
    const container = containerRef.current;
    if (!didMount || !container) return;

    let sheet: Spreadsheet | undefined;
    let cancelled = false;

    initialize(container, {
      theme,
      store: storeRef.current,
      readOnly: true,
    }).then((s) => {
      if (cancelled) {
        s.cleanup();
        return;
      }
      sheet = s;
      sheetRef.current = s;
    });

    return () => {
      cancelled = true;
      if (sheet) {
        sheet.cleanup();
      }
      sheetRef.current = undefined;
    };
  }, [didMount, theme]);

  const handleExecute = useCallback(async () => {
    if (!doc || !query.trim() || readOnly) return;

    const root = doc.getRoot();
    const tab = root.tabs[tabId];
    if (!tab?.datasourceId) {
      setQueryError("No datasource connected to this tab");
      return;
    }

    // Save query to Yorkie
    doc.update((r) => {
      if (r.tabs[tabId]) {
        r.tabs[tabId].query = query;
      }
    });

    setExecuting(true);
    setQueryError(null);
    try {
      const res = await executeDataSourceQuery(tab.datasourceId, query);
      setResult(res);

      // Load results into readonly store and re-render
      storeRef.current.loadQueryResults(res.columns, res.rows);
      if (sheetRef.current) {
        await sheetRef.current.reloadDimensions();
        sheetRef.current.render();
      }
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      setQueryError((err as Error).message);
    } finally {
      setExecuting(false);
    }
  }, [doc, tabId, query, readOnly]);

  // Ctrl/Cmd+Enter shortcut
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (readOnly) return;
        e.preventDefault();
        handleExecute();
      }
    },
    [handleExecute, readOnly],
  );

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
      {/* SQL Editor */}
      <div className="border-b p-2 shrink-0">
        <textarea
          className="w-full h-24 p-2 font-mono text-sm border rounded resize-y bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="SELECT * FROM users LIMIT 100"
          value={query}
          onChange={(e) => {
            if (!readOnly) {
              setQuery(e.target.value);
            }
          }}
          onKeyDown={handleKeyDown}
          readOnly={readOnly}
        />
      </div>

      {/* Action Bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b shrink-0">
        <Button
          size="sm"
          onClick={handleExecute}
          disabled={readOnly || executing || !query.trim()}
        >
          <IconPlayerPlay className="size-4" />
          {executing ? "Executing..." : "Execute"}
        </Button>
        {result && (
          <span className="text-xs text-muted-foreground">
            {result.rowCount} row{result.rowCount !== 1 ? "s" : ""}
            {result.truncated ? " (truncated)" : ""} in {result.executionTime}ms
          </span>
        )}
        {queryError && (
          <span className="text-xs text-destructive truncate">{queryError}</span>
        )}
      </div>

      {/* Grid */}
      <div
        ref={containerRef}
        className="flex-1 w-full"
        style={{ touchAction: "manipulation" }}
      />
    </div>
  );
}

import {
  initialize,
  ReadOnlyStore,
  type Spreadsheet,
} from '@wafflebase/sheets';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDocument } from '@yorkie-js/react';
import { isAuthExpiredError } from '@/api/auth';
import { fetchLakehouseHistory, readLakehouseSource } from '@/api/lakehouse';
import { Loader } from '@/components/loader';
import { useTheme } from '@/components/theme-provider';
import { useMobileSheetGestures } from '@/hooks/use-mobile-sheet-gestures';
import type { SpreadsheetDocument } from '@/types/worksheet';
import type { UserPresence } from '@/types/users';
import {
  isLakehouseHistoryRef,
  lakehouseHistoryRefKey,
  type LakehouseHistoryEntry,
  type LakehouseHistoryRef,
  type LakehouseReadResult,
} from '@/types/lakehouse';
import { TimeTravelSlider } from './time-travel-slider';

type LakehouseViewProps = {
  tabId: string;
  readOnly?: boolean;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function createTabStore(tabId: string): ReadOnlyStore {
  // The tab id is the cache boundary; ReadOnlyStore itself does not need it.
  void tabId;
  return new ReadOnlyStore();
}

/**
 * Renders an ephemeral lakehouse query result in the existing read-only sheet
 * spine. Tab metadata is the source of truth: local and remote `asOf` changes
 * both flow through the same effect and therefore issue exactly one read.
 */
export function LakehouseView({ tabId, readOnly = false }: LakehouseViewProps) {
  const { resolvedTheme: theme } = useTheme();
  const { doc, root, loading, error } = useDocument<
    SpreadsheetDocument,
    UserPresence
  >();
  const containerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<Spreadsheet | undefined>(undefined);
  const sheetGenerationRef = useRef(0);
  const readSequenceRef = useRef(0);
  const historySequenceRef = useRef(0);
  const [didMount, setDidMount] = useState(false);
  const [result, setResult] = useState<LakehouseReadResult | null>(null);
  const [history, setHistory] = useState<LakehouseHistoryEntry[]>([]);
  const [reading, setReading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyReadyKey, setHistoryReadyKey] = useState<string>();
  const [readError, setReadError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);

  // A tab switch must never inherit the previous tab's ephemeral result grid.
  const store = useMemo(() => createTabStore(tabId), [tabId]);
  useMobileSheetGestures({ containerRef, sheetRef });

  const tab = root?.tabs[tabId];
  const sourceId = tab?.lakehouseSourceId;
  const sourceKey = sourceId ? `${tabId}:${sourceId}` : undefined;
  const rawAsOf = tab?.asOf;
  const activeAsOf = isLakehouseHistoryRef(rawAsOf) ? rawAsOf : undefined;
  const activeAsOfKind = activeAsOf?.kind;
  const activeVersion =
    activeAsOf?.kind === 'version' ? activeAsOf.version : undefined;
  const activeSnapshotId =
    activeAsOf?.kind === 'snapshot' ? activeAsOf.snapshotId : undefined;
  const asOfKey = lakehouseHistoryRefKey(activeAsOf);

  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    if (!doc) return;
    doc.update((_, presence) => {
      presence.set({
        activeTabId: tabId,
        selection: undefined,
        activeCell: undefined,
      });
    });
  }, [doc, tabId]);

  useEffect(() => {
    // While the document is loading (or failed) the loader renders instead of
    // the grid container, so the effect must re-run once that state clears.
    const container = containerRef.current;
    if (!didMount || loading || error || !container) return;

    const generation = ++sheetGenerationRef.current;
    let cancelled = false;
    let sheet: Spreadsheet | undefined;
    setCanvasError(null);

    void initialize(container, {
      theme,
      store,
      readOnly: true,
    })
      .then(async (nextSheet) => {
        if (cancelled || sheetGenerationRef.current !== generation) {
          nextSheet.cleanup();
          return;
        }
        sheet = nextSheet;
        sheetRef.current = nextSheet;
        await nextSheet.reloadDimensions();
        if (
          cancelled ||
          sheetGenerationRef.current !== generation ||
          sheetRef.current !== nextSheet
        ) {
          return;
        }
        nextSheet.render();
        setCanvasError(null);
      })
      .catch((initializationError: unknown) => {
        if (cancelled || sheetGenerationRef.current !== generation) return;
        if (sheetRef.current === sheet) sheetRef.current = undefined;
        sheet?.cleanup();
        sheet = undefined;
        setCanvasError(
          errorMessage(
            initializationError,
            'Failed to initialize lakehouse grid',
          ),
        );
      });

    return () => {
      cancelled = true;
      if (sheetGenerationRef.current === generation) {
        sheetGenerationRef.current += 1;
      }
      if (sheetRef.current === sheet) sheetRef.current = undefined;
      sheet?.cleanup();
    };
  }, [didMount, error, loading, store, theme]);

  useEffect(() => {
    const sequence = ++historySequenceRef.current;
    const controller = new AbortController();
    setHistory([]);
    setHistoryError(null);

    if (!sourceId || historyReadyKey !== sourceKey) {
      setHistoryLoading(Boolean(sourceId));
      return () => controller.abort();
    }

    setHistoryLoading(true);
    void fetchLakehouseHistory(sourceId, controller.signal)
      .then((nextHistory) => {
        if (
          !controller.signal.aborted &&
          historySequenceRef.current === sequence
        ) {
          setHistory(nextHistory);
        }
      })
      .catch((historyFetchError: unknown) => {
        if (
          controller.signal.aborted ||
          historySequenceRef.current !== sequence ||
          isAbortError(historyFetchError) ||
          isAuthExpiredError(historyFetchError)
        ) {
          return;
        }
        setHistoryError(
          errorMessage(historyFetchError, 'Failed to load commit history'),
        );
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          historySequenceRef.current === sequence
        ) {
          setHistoryLoading(false);
        }
      });

    return () => controller.abort();
  }, [historyReadyKey, sourceId, sourceKey]);

  useEffect(() => {
    const sequence = ++readSequenceRef.current;
    const controller = new AbortController();
    setResult(null);
    setReadError(null);
    store.loadQueryResults([], []);
    const currentSheet = sheetRef.current;
    if (currentSheet) {
      const sheetGeneration = sheetGenerationRef.current;
      void currentSheet
        .reloadDimensions()
        .then(() => {
          if (
            controller.signal.aborted ||
            readSequenceRef.current !== sequence ||
            sheetGenerationRef.current !== sheetGeneration ||
            sheetRef.current !== currentSheet
          ) {
            return;
          }
          currentSheet.render();
          setCanvasError(null);
        })
        .catch((reloadError: unknown) => {
          if (
            !controller.signal.aborted &&
            readSequenceRef.current === sequence &&
            sheetGenerationRef.current === sheetGeneration &&
            sheetRef.current === currentSheet
          ) {
            setCanvasError(
              errorMessage(reloadError, 'Failed to clear lakehouse grid'),
            );
          }
        });
    }

    if (!sourceId) {
      setReading(false);
      setHistoryReadyKey(undefined);
      setReadError('No lakehouse source connected to this tab');
      return () => controller.abort();
    }

    const readAsOf: LakehouseHistoryRef | undefined =
      activeAsOfKind === 'version' && activeVersion !== undefined
        ? { kind: 'version', version: activeVersion }
        : activeAsOfKind === 'snapshot' && activeSnapshotId !== undefined
          ? { kind: 'snapshot', snapshotId: activeSnapshotId }
          : undefined;
    setReading(true);
    void readLakehouseSource(sourceId, readAsOf, controller.signal)
      .then(async (nextResult) => {
        if (controller.signal.aborted || readSequenceRef.current !== sequence) {
          return;
        }

        store.loadQueryResults(nextResult.columns, nextResult.rows);
        setResult(nextResult);
        const nextSheet = sheetRef.current;
        if (nextSheet) {
          const sheetGeneration = sheetGenerationRef.current;
          try {
            await nextSheet.reloadDimensions();
          } catch (reloadError) {
            if (
              controller.signal.aborted ||
              readSequenceRef.current !== sequence ||
              sheetGenerationRef.current !== sheetGeneration ||
              sheetRef.current !== nextSheet
            ) {
              return;
            }
            throw reloadError;
          }
          if (
            !controller.signal.aborted &&
            readSequenceRef.current === sequence &&
            sheetGenerationRef.current === sheetGeneration &&
            sheetRef.current === nextSheet
          ) {
            nextSheet.render();
            setCanvasError(null);
          }
        }
      })
      .catch((readFailure: unknown) => {
        if (
          controller.signal.aborted ||
          readSequenceRef.current !== sequence ||
          isAbortError(readFailure) ||
          isAuthExpiredError(readFailure)
        ) {
          return;
        }
        setReadError(
          errorMessage(readFailure, 'Failed to read lakehouse table'),
        );
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          readSequenceRef.current === sequence
        ) {
          setReading(false);
          setHistoryReadyKey(sourceKey);
        }
      });

    return () => controller.abort();
  }, [
    activeAsOfKind,
    activeSnapshotId,
    activeVersion,
    asOfKey,
    sourceId,
    sourceKey,
    store,
    tabId,
  ]);

  const handleTimeTravelCommit = useCallback(
    (nextAsOf: LakehouseHistoryRef | undefined) => {
      if (!doc || readOnly) return;

      doc.update((documentRoot) => {
        const currentTab = documentRoot.tabs[tabId];
        if (!currentTab || currentTab.type !== 'lakehouse') return;

        if (!nextAsOf) {
          if (currentTab.asOf === undefined) return;
          delete currentTab.asOf;
          return;
        }

        if (
          isLakehouseHistoryRef(currentTab.asOf) &&
          lakehouseHistoryRefKey(currentTab.asOf) ===
            lakehouseHistoryRefKey(nextAsOf)
        ) {
          return;
        }
        currentTab.asOf = nextAsOf;
      });
    },
    [doc, readOnly, tabId],
  );

  if (loading) return <Loader />;
  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        {error.message}
      </div>
    );
  }

  const visibleError = readError ?? historyError ?? canvasError;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center gap-4 border-b px-3 py-2">
        <TimeTravelSlider
          history={history}
          value={activeAsOf}
          loading={historyLoading}
          disabled={readOnly || historyLoading || !sourceId}
          latestLabel={
            activeAsOfKind === 'snapshot' ||
            history.some(({ ref }) => ref.kind === 'snapshot')
              ? 'Latest in configured metadata'
              : 'Latest'
          }
          onCommit={handleTimeTravelCommit}
        />
        <div className="flex min-w-32 shrink-0 flex-col items-end text-xs text-muted-foreground">
          {reading ? (
            <span>Loading rows…</span>
          ) : result ? (
            <span>
              {result.rowCount} row{result.rowCount === 1 ? '' : 's'}
              {result.truncated ? ' (truncated)' : ''} in {result.executionTime}
              ms
            </span>
          ) : (
            <span>No rows loaded</span>
          )}
        </div>
      </div>

      {visibleError ? (
        <div
          role="alert"
          className="shrink-0 border-b bg-destructive/5 px-3 py-1.5 text-xs text-destructive"
        >
          {visibleError}
        </div>
      ) : null}

      <div
        ref={containerRef}
        className="min-h-0 w-full flex-1"
        style={{ touchAction: 'manipulation' }}
      />
    </div>
  );
}

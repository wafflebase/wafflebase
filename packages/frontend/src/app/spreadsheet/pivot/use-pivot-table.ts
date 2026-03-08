import { useCallback, useEffect, useRef, useState } from "react";
import type { Document as YorkieDoc } from "yorkie-js-sdk";
import type {
  PivotTableDefinition,
  PivotField,
  PivotValueField,
  PivotFilterField,
  AggregateFunction,
  Grid,
  Cell,
  Sref,
} from "@wafflebase/sheet";
import {
  calculatePivot,
  materialize,
  parseSourceData,
  parseRange,
  toSref,
} from "@wafflebase/sheet";
import type { SpreadsheetDocument } from "@/types/worksheet";

type UsePivotTableProps = {
  doc: YorkieDoc<SpreadsheetDocument> | null;
  tabId: string;
};


export function usePivotTable({ doc, tabId }: UsePivotTableProps) {
  const [definition, setDefinition] = useState<PivotTableDefinition | null>(
    null,
  );

  // Load definition from Yorkie document.
  // Yorkie CRDT arrays may deserialize as plain objects with numeric keys,
  // so we normalize all field arrays with Array.from().
  useEffect(() => {
    if (!doc) {
      setDefinition(null);
      return;
    }
    const root = doc.getRoot();
    const ws = root.sheets?.[tabId];
    if (ws?.pivotTable) {
      // Read properties directly from Yorkie CRDT proxy.
      // JSON.parse(JSON.stringify(proxy)) fails because Yorkie's toJSON()
      // returns a JSON string, causing double-encoding.
      const pt = ws.pivotTable;
      const readField = (f: PivotField) => ({
        sourceColumn: f.sourceColumn,
        label: f.label,
        sort: f.sort,
      });
      setDefinition({
        id: pt.id,
        sourceTabId: pt.sourceTabId,
        sourceRange: pt.sourceRange,
        rowFields: Array.from(pt.rowFields ?? []).map(readField),
        columnFields: Array.from(pt.columnFields ?? []).map(readField),
        valueFields: Array.from(pt.valueFields ?? []).map((f: PivotValueField) => ({
          ...readField(f),
          aggregation: f.aggregation,
        })),
        filterFields: Array.from(pt.filterFields ?? []).map((f: PivotFilterField) => ({
          ...readField(f),
          hiddenValues: Array.from(f.hiddenValues ?? []),
        })),
        showTotals: pt.showTotals
          ? { rows: pt.showTotals.rows, columns: pt.showTotals.columns }
          : { rows: true, columns: true },
      } as PivotTableDefinition);
    } else {
      setDefinition(null);
    }
  }, [doc, tabId]);

  // Sync definition changes to Yorkie document
  const definitionRef = useRef(definition);
  useEffect(() => {
    // Skip the initial load (when definitionRef.current transitions from null)
    const isInitialLoad = definitionRef.current === null && definition !== null;
    definitionRef.current = definition;
    if (isInitialLoad || !doc || !definition) return;
    doc.update((root) => {
      const ws = root.sheets[tabId];
      if (ws) ws.pivotTable = definition;
    });
  }, [doc, tabId, definition]);

  // Build source grid on-demand by reading cells from the Yorkie document.
  // Called inside refresh() and getSourceHeaders() to always read current data,
  // since Yorkie document references don't change on content updates.
  const buildSourceGrid = useCallback((): Grid | null => {
    if (!doc || !definition) return null;
    const root = doc.getRoot();
    const sourceWs = root.sheets[definition.sourceTabId];
    if (!sourceWs?.sheet) return null;

    try {
      const range = parseRange(definition.sourceRange);
      const [from, to] = range;
      const grid: Grid = new Map();
      for (let r = from.r; r <= to.r; r++) {
        for (let c = from.c; c <= to.c; c++) {
          const sref = toSref({ r, c }) as Sref;
          const cell = sourceWs.sheet[sref];
          if (cell) {
            // Read properties directly to detach from Yorkie CRDT proxy.
            // JSON.parse(JSON.stringify(proxy)) fails due to double-encoding.
            const plain: Cell = {};
            if (cell.v !== undefined) plain.v = cell.v;
            if (cell.f !== undefined) plain.f = cell.f;
            if (cell.s !== undefined) plain.s = { ...cell.s };
            grid.set(sref, plain);
          }
        }
      }
      return grid;
    } catch {
      return null;
    }
  }, [doc, definition]);

  const updateDefinition = useCallback(
    (updater: (def: PivotTableDefinition) => PivotTableDefinition) => {
      setDefinition((prev) => (prev ? updater(prev) : prev));
    },
    [],
  );

  const addRowField = useCallback(
    (field: PivotField) => {
      updateDefinition((def) => ({
        ...def,
        rowFields: [...def.rowFields, field],
      }));
    },
    [updateDefinition],
  );

  const addColumnField = useCallback(
    (field: PivotField) => {
      updateDefinition((def) => ({
        ...def,
        columnFields: [...def.columnFields, field],
      }));
    },
    [updateDefinition],
  );

  const addValueField = useCallback(
    (field: PivotValueField) => {
      updateDefinition((def) => ({
        ...def,
        valueFields: [...def.valueFields, field],
      }));
    },
    [updateDefinition],
  );

  const addFilterField = useCallback(
    (field: PivotFilterField) => {
      updateDefinition((def) => ({
        ...def,
        filterFields: [...def.filterFields, field],
      }));
    },
    [updateDefinition],
  );

  const removeField = useCallback(
    (
      section:
        | "rowFields"
        | "columnFields"
        | "valueFields"
        | "filterFields",
      index: number,
    ) => {
      updateDefinition((def) => ({
        ...def,
        [section]: (def[section] as unknown[]).filter(
          (_: unknown, i: number) => i !== index,
        ),
      }));
    },
    [updateDefinition],
  );

  const setAggregation = useCallback(
    (index: number, aggregation: AggregateFunction) => {
      updateDefinition((def) => ({
        ...def,
        valueFields: def.valueFields.map((f, i) =>
          i === index ? { ...f, aggregation } : f,
        ),
      }));
    },
    [updateDefinition],
  );

  const toggleSort = useCallback(
    (section: "rowFields" | "columnFields", index: number) => {
      updateDefinition((def) => ({
        ...def,
        [section]: (def[section] as PivotField[]).map((f, i) =>
          i === index
            ? { ...f, sort: f.sort === "desc" ? "asc" : "desc" }
            : f,
        ),
      }));
    },
    [updateDefinition],
  );

  const setShowTotals = useCallback(
    (key: "rows" | "columns", value: boolean) => {
      updateDefinition((def) => ({
        ...def,
        showTotals: { ...def.showTotals, [key]: value },
      }));
    },
    [updateDefinition],
  );

  const refresh = useCallback(() => {
    if (!doc || !definition) return;

    const sourceGrid = buildSourceGrid();
    if (!sourceGrid) return;

    const pivotResult = calculatePivot(sourceGrid, definition);
    const grid = materialize(pivotResult);

    // Write materialized cells to the pivot sheet
    doc.update((root) => {
      const ws = root.sheets[tabId];
      if (!ws) return;

      // Clear existing cells. Use toJSON() to snapshot keys from the Yorkie
      // CRDT proxy, which avoids "ownKeys duplicate" errors.
      let keys: string[];
      try {
        keys = Object.keys(ws.sheet);
      } catch {
        const maybeToJSON = (ws.sheet as { toJSON?: () => string }).toJSON;
        keys = typeof maybeToJSON === 'function'
          ? Object.keys(JSON.parse(maybeToJSON.call(ws.sheet)))
          : [];
      }
      for (const key of keys) {
        delete ws.sheet[key];
      }

      // Write new cells
      for (const [sref, cell] of grid) {
        ws.sheet[sref] = cell;
      }
    });
  }, [doc, tabId, definition, buildSourceGrid]);

  // Get available source columns (headers from source data).
  const getSourceHeaders = useCallback((): string[] => {
    if (!definition) return [];
    const sourceGrid = buildSourceGrid();
    if (!sourceGrid) return [];
    try {
      const range = parseRange(definition.sourceRange);
      const { headers } = parseSourceData(sourceGrid, range);
      return headers.map((h, i) => h || `Column ${i + 1}`);
    } catch {
      return [];
    }
  }, [definition, buildSourceGrid]);

  return {
    definition,
    addRowField,
    addColumnField,
    addValueField,
    addFilterField,
    removeField,
    setAggregation,
    toggleSort,
    setShowTotals,
    refresh,
    getSourceHeaders,
  };
}

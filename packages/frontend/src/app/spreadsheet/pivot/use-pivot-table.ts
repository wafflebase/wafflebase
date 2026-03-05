import { useCallback, useEffect, useRef, useState } from "react";
import type { Document as YorkieDoc } from "yorkie-js-sdk";
import type {
  PivotTableDefinition,
  PivotField,
  PivotValueField,
  PivotFilterField,
  AggregateFunction,
  Grid,
} from "@wafflebase/sheet";
import {
  calculatePivot,
  materialize,
  parseSourceData,
  parseRange,
} from "@wafflebase/sheet";
import type { SpreadsheetDocument } from "@/types/worksheet";

type UsePivotTableProps = {
  doc: YorkieDoc<SpreadsheetDocument> | null;
  tabId: string;
  sourceGrid: Grid | null;
};


export function usePivotTable({ doc, tabId, sourceGrid }: UsePivotTableProps) {
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
      const raw = JSON.parse(JSON.stringify(ws.pivotTable));
      setDefinition({
        ...raw,
        rowFields: Array.from(raw.rowFields ?? []),
        columnFields: Array.from(raw.columnFields ?? []),
        valueFields: Array.from(raw.valueFields ?? []),
        filterFields: Array.from(raw.filterFields ?? []),
        showTotals: raw.showTotals ?? { rows: true, columns: true },
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
    if (!doc || !definition || !sourceGrid) return;

    const pivotResult = calculatePivot(sourceGrid, definition);
    const grid = materialize(pivotResult);

    // Write materialized cells to the pivot sheet
    doc.update((root) => {
      const ws = root.sheets[tabId];
      if (!ws) return;

      // Clear existing cells
      for (const key of Object.keys(ws.sheet)) {
        delete ws.sheet[key];
      }

      // Write new cells
      for (const [sref, cell] of grid) {
        ws.sheet[sref] = cell;
      }
    });
  }, [doc, tabId, definition, sourceGrid]);

  // Get available source columns (headers from source data).
  // Uses the already-built sourceGrid (plain Map) to avoid Yorkie proxy issues.
  const getSourceHeaders = useCallback((): string[] => {
    if (!definition || !sourceGrid) return [];
    try {
      const range = parseRange(definition.sourceRange);
      const { headers } = parseSourceData(sourceGrid, range);
      return headers.map((h, i) => h || `Column ${i + 1}`);
    } catch {
      return [];
    }
  }, [definition, sourceGrid]);

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

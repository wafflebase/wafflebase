import { useCallback, useEffect, useState } from "react";
import type { Document as YorkieDoc } from "yorkie-js-sdk";
import type {
  PivotTableDefinition,
  PivotField,
  PivotValueField,
  PivotFilterField,
  AggregateFunction,
  Grid,
} from "@wafflebase/sheet";
import { calculatePivot, materialize } from "@wafflebase/sheet";
import type { SpreadsheetDocument } from "@/types/worksheet";

type UsePivotTableProps = {
  doc: YorkieDoc<SpreadsheetDocument> | null;
  tabId: string;
  sourceGrid: Grid | null;
};

function colLetterToNumber(letters: string): number {
  let result = 0;
  for (let i = 0; i < letters.length; i++) {
    result = result * 26 + letters.charCodeAt(i) - 64;
  }
  return result;
}

function numberToColLetter(num: number): string {
  let result = "";
  let n = num;
  while (n > 0) {
    const mod = (n - 1) % 26;
    result = String.fromCharCode(65 + mod) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

export function usePivotTable({ doc, tabId, sourceGrid }: UsePivotTableProps) {
  const [definition, setDefinition] = useState<PivotTableDefinition | null>(
    null,
  );

  // Load definition from Yorkie document.
  // Yorkie CRDT arrays may deserialize as plain objects with numeric keys,
  // so we normalize all field arrays with Array.from().
  useEffect(() => {
    if (!doc) return;
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
    }
  }, [doc, tabId]);

  const updateDefinition = useCallback(
    (updater: (def: PivotTableDefinition) => PivotTableDefinition) => {
      if (!doc) return;
      setDefinition((prev) => {
        if (!prev) return prev;
        const updated = updater(prev);
        doc.update((root) => {
          const ws = root.sheets[tabId];
          if (ws) {
            ws.pivotTable = updated;
          }
        });
        return updated;
      });
    },
    [doc, tabId],
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

  // Get available source columns (headers from source data)
  const getSourceHeaders = useCallback((): string[] => {
    if (!doc || !definition) return [];
    const root = doc.getRoot();
    const sourceWs = root.sheets?.[definition.sourceTabId];
    if (!sourceWs?.sheet) return [];

    // Parse source range to find first row
    const match = definition.sourceRange.match(
      /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/,
    );
    if (!match) return [];

    const startCol = colLetterToNumber(match[1]);
    const startRow = parseInt(match[2], 10);
    const endCol = colLetterToNumber(match[3]);

    const headers: string[] = [];
    for (let c = startCol; c <= endCol; c++) {
      const sref = numberToColLetter(c) + startRow;
      const cell = sourceWs.sheet[sref];
      headers.push(cell?.v ?? `Column ${c}`);
    }
    return headers;
  }, [doc, definition]);

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

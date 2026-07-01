import { parseRange } from '../core/coordinates';
import type {
  Grid,
  GroupNode,
  PivotCell,
  PivotCellFormat,
  PivotResult,
  PivotTableDefinition,
  PivotValueField,
} from '../core/types';
import { parseSourceData } from './parse';
import { applyFilters, buildGroups } from './group';
import { aggregateValues } from './aggregate';

/**
 * Collect all leaf nodes from a group tree, preserving order.
 * Each leaf carries a label (path of group values joined by ' / ')
 * and the record indices it covers.
 */
function flattenLeaves(
  node: GroupNode,
  path: string[],
): { label: string; indices: number[] }[] {
  if (node.children.length === 0) {
    return [{ label: path.join(' / '), indices: node.records }];
  }

  const result: { label: string; indices: number[] }[] = [];
  for (const child of node.children) {
    for (const leaf of flattenLeaves(child, [...path, child.value])) {
      result.push(leaf);
    }
  }
  return result;
}

/**
 * Collect all record indices reachable from a group root.
 */
function allIndices(node: GroupNode): number[] {
  if (node.children.length === 0) {
    return node.records;
  }
  const result: number[] = [];
  for (const child of node.children) {
    for (const idx of allIndices(child)) {
      result.push(idx);
    }
  }
  return result;
}

/**
 * `calculatePivot` runs the full pivot-table pipeline:
 *
 * 1. Parse source range → headers + records
 * 2. Apply filters
 * 3. Build row and column groups
 * 4. Flatten group leaves
 * 5. Build header, data, and total rows
 * 6. Return PivotResult
 */
export function calculatePivot(
  sourceGrid: Grid,
  def: PivotTableDefinition,
): PivotResult {
  // 1. Parse source range and extract data.
  const range = parseRange(def.sourceRange);
  const { records, columnFormats } = parseSourceData(sourceGrid, range);

  // Label format is inherited only when an axis has a single grouping field;
  // composite "A / B" labels join multiple columns and have no single format.
  const rowFormat =
    def.rowFields.length === 1
      ? columnFormats[def.rowFields[0].sourceColumn]
      : undefined;
  const colFormat =
    def.columnFields.length === 1
      ? columnFormats[def.columnFields[0].sourceColumn]
      : undefined;

  // Value cells inherit their source column's format, except counts, which are
  // plain integers regardless of the source format.
  const valueFormat = (vf: PivotValueField): PivotCellFormat | undefined => {
    if (vf.aggregation === 'COUNT' || vf.aggregation === 'COUNTA') {
      return undefined;
    }
    return columnFormats[vf.sourceColumn];
  };

  // 2. Apply filters.
  const filtered = applyFilters(records, def.filterFields);

  // 3. Build row and column groups.
  const rowRoot = buildGroups(filtered, def.rowFields);
  const colRoot = buildGroups(filtered, def.columnFields);

  // 4. Flatten leaves.
  const rowLeaves = flattenLeaves(rowRoot, []);
  const colLeaves = flattenLeaves(colRoot, []);

  const hasColumns = def.columnFields.length > 0;
  const valueFields = def.valueFields;

  if (valueFields.length === 0) {
    return { cells: [], rowCount: 0, colCount: 0 };
  }

  const cells: PivotCell[][] = [];

  // 5. Build header row.
  if (hasColumns) {
    // With column fields: header row shows column leaf labels.
    // If multiple value fields, each column expands to N sub-headers.
    if (valueFields.length > 1) {
      const headerRow: PivotCell[] = [{ value: '', type: 'empty' }];
      for (const colLeaf of colLeaves) {
        for (const vf of valueFields) {
          headerRow.push({
            value: `${colLeaf.label} - ${vf.aggregation} of ${vf.label}`,
            type: 'colHeader',
          });
        }
      }
      if (def.showTotals.columns) {
        for (const vf of valueFields) {
          headerRow.push({
            value: `Grand Total - ${vf.aggregation} of ${vf.label}`,
            type: 'colHeader',
          });
        }
      }
      cells.push(headerRow);
    } else {
      // Single value field with columns: column header shows group value.
      const headerRow: PivotCell[] = [{ value: '', type: 'empty' }];
      for (const colLeaf of colLeaves) {
        headerRow.push({
          value: colLeaf.label,
          type: 'colHeader',
          format: colFormat,
        });
      }
      if (def.showTotals.columns) {
        headerRow.push({ value: 'Grand Total', type: 'colHeader' });
      }
      cells.push(headerRow);
    }
  } else {
    // Without column fields: header row shows "AGG of Label" for each value field.
    const headerRow: PivotCell[] = [{ value: '', type: 'empty' }];
    for (const vf of valueFields) {
      headerRow.push({
        value: `${vf.aggregation} of ${vf.label}`,
        type: 'colHeader',
      });
    }
    cells.push(headerRow);
  }

  // 6. Build data rows.
  for (const rowLeaf of rowLeaves) {
    const dataRow: PivotCell[] = [
      { value: rowLeaf.label, type: 'rowHeader', format: rowFormat },
    ];

    if (hasColumns) {
      for (const colLeaf of colLeaves) {
        // Find intersection: record indices that belong to both row and column.
        const rowSet = new Set(rowLeaf.indices);
        const intersection = colLeaf.indices.filter((i) => rowSet.has(i));

        if (valueFields.length > 1) {
          for (const vf of valueFields) {
            dataRow.push({
              value: aggregateValues(filtered, intersection, vf),
              type: 'value',
              format: valueFormat(vf),
            });
          }
        } else {
          dataRow.push({
            value: aggregateValues(filtered, intersection, valueFields[0]),
            type: 'value',
            format: valueFormat(valueFields[0]),
          });
        }
      }

      // Row total (Grand Total column).
      if (def.showTotals.columns) {
        if (valueFields.length > 1) {
          for (const vf of valueFields) {
            dataRow.push({
              value: aggregateValues(filtered, rowLeaf.indices, vf),
              type: 'total',
              format: valueFormat(vf),
            });
          }
        } else {
          dataRow.push({
            value: aggregateValues(filtered, rowLeaf.indices, valueFields[0]),
            type: 'total',
            format: valueFormat(valueFields[0]),
          });
        }
      }
    } else {
      // No column fields: aggregate each value field over row indices.
      for (const vf of valueFields) {
        dataRow.push({
          value: aggregateValues(filtered, rowLeaf.indices, vf),
          type: 'value',
          format: valueFormat(vf),
        });
      }
    }

    cells.push(dataRow);
  }

  // 7. Build grand total row.
  if (def.showTotals.rows) {
    const allRowIndices = allIndices(rowRoot);
    const totalRow: PivotCell[] = [
      { value: 'Grand Total', type: 'total' },
    ];

    if (hasColumns) {
      for (const colLeaf of colLeaves) {
        if (valueFields.length > 1) {
          for (const vf of valueFields) {
            totalRow.push({
              value: aggregateValues(filtered, colLeaf.indices, vf),
              type: 'total',
              format: valueFormat(vf),
            });
          }
        } else {
          totalRow.push({
            value: aggregateValues(
              filtered,
              colLeaf.indices,
              valueFields[0],
            ),
            type: 'total',
            format: valueFormat(valueFields[0]),
          });
        }
      }

      // Grand total of grand totals (bottom-right corner).
      if (def.showTotals.columns) {
        if (valueFields.length > 1) {
          for (const vf of valueFields) {
            totalRow.push({
              value: aggregateValues(filtered, allRowIndices, vf),
              type: 'total',
              format: valueFormat(vf),
            });
          }
        } else {
          totalRow.push({
            value: aggregateValues(
              filtered,
              allRowIndices,
              valueFields[0],
            ),
            type: 'total',
            format: valueFormat(valueFields[0]),
          });
        }
      }
    } else {
      for (const vf of valueFields) {
        totalRow.push({
          value: aggregateValues(filtered, allRowIndices, vf),
          type: 'total',
          format: valueFormat(vf),
        });
      }
    }

    cells.push(totalRow);
  }

  return {
    cells,
    rowCount: cells.length,
    colCount: cells.length > 0 ? cells[0].length : 0,
  };
}

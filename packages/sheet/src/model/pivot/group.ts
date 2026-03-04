import type {
  GroupNode,
  PivotField,
  PivotFilterField,
  PivotRecord,
} from '../types';

/**
 * `applyFilters` removes records where any filter field's column value
 * appears in that filter's `hiddenValues`. Multiple filters use AND logic.
 * An empty filters array returns all records unchanged.
 */
export function applyFilters(
  records: PivotRecord[],
  filters: PivotFilterField[],
): PivotRecord[] {
  if (filters.length === 0) return records;

  return records.filter((record) =>
    filters.every(
      (f) => !f.hiddenValues.includes(record[f.sourceColumn]),
    ),
  );
}

/**
 * `buildGroups` groups records by unique values of each field's sourceColumn,
 * producing a tree of `GroupNode`s.
 *
 * - Field order determines the hierarchy depth.
 * - Leaf nodes carry `records` with original record indices.
 * - Group values are sorted with `localeCompare({ numeric: true })`,
 *   ascending by default or descending when `sort === 'desc'`.
 * - If fields is empty, the root node contains all record indices directly.
 */
export function buildGroups(
  records: PivotRecord[],
  fields: PivotField[],
): GroupNode {
  const allIndices = records.map((_, i) => i);

  if (fields.length === 0) {
    return { value: '', children: [], records: allIndices };
  }

  return {
    value: '',
    children: buildLevel(records, fields, 0, allIndices),
    records: [],
  };
}

function buildLevel(
  records: PivotRecord[],
  fields: PivotField[],
  depth: number,
  indices: number[],
): GroupNode[] {
  const field = fields[depth];
  const col = field.sourceColumn;

  // Group indices by column value.
  const groups = new Map<string, number[]>();
  for (const idx of indices) {
    const val = records[idx][col];
    let bucket = groups.get(val);
    if (!bucket) {
      bucket = [];
      groups.set(val, bucket);
    }
    bucket.push(idx);
  }

  // Sort group keys.
  const sortDir = field.sort ?? 'asc';
  const keys = [...groups.keys()].sort((a, b) => {
    const cmp = a.localeCompare(b, undefined, { numeric: true });
    return sortDir === 'desc' ? -cmp : cmp;
  });

  const isLeaf = depth === fields.length - 1;

  return keys.map((key) => {
    const bucket = groups.get(key)!;
    if (isLeaf) {
      return { value: key, children: [], records: bucket };
    }
    return {
      value: key,
      children: buildLevel(records, fields, depth + 1, bucket),
      records: [],
    };
  });
}

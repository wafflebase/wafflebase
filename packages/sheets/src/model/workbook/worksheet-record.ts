import type { Cell } from '../core/types';

export type WorksheetGridShape = {
  cells?: Record<string, Cell>;
  rowOrder?: string[];
  colOrder?: string[];
  nextRowId?: number;
  nextColId?: number;
};

const WorksheetCellKeySeparator = '|';

function isDuplicateOwnKeysError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message.includes('ownKeys') &&
    error.message.includes('duplicate')
  );
}

function snapshotRecord<T>(obj: Record<string, T>): Record<string, T> {
  const maybeToJSON = (obj as { toJSON?: () => string | Record<string, T> }).toJSON;
  if (typeof maybeToJSON === 'function') {
    const value = maybeToJSON.call(obj);
    if (typeof value === 'string') {
      return JSON.parse(value) as Record<string, T>;
    }
    return value;
  }
  return { ...obj };
}

export function safeWorksheetRecordKeys<T>(obj?: Record<string, T>): string[] {
  if (!obj) {
    return [];
  }
  try {
    return Object.keys(obj);
  } catch (error) {
    if (isDuplicateOwnKeysError(error)) {
      return Object.keys(snapshotRecord(obj));
    }
    throw error;
  }
}

export function safeWorksheetRecordEntries<T>(
  obj?: Record<string, T>,
): Array<[string, T]> {
  if (!obj) {
    return [];
  }
  try {
    return Object.entries(obj);
  } catch (error) {
    if (isDuplicateOwnKeysError(error)) {
      return Object.entries(snapshotRecord(obj));
    }
    throw error;
  }
}

export function safeWorksheetRecordValues<T>(obj?: Record<string, T>): T[] {
  if (!obj) {
    return [];
  }
  try {
    return Object.values(obj);
  } catch (error) {
    if (isDuplicateOwnKeysError(error)) {
      return Object.values(snapshotRecord(obj));
    }
    throw error;
  }
}

const AXIS_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const AXIS_ID_LENGTH = 4;
/** 36^4 = 1,679,616 distinct ids per prefix. */
const AXIS_ID_SPACE = AXIS_ID_CHARS.length ** AXIS_ID_LENGTH;

/**
 * Attempts before {@link createWorksheetAxisId} gives up.
 *
 * The retry loop terminates only while a free id exists. An axis holding all
 * 1,679,616 ids makes every draw a collision, and an unbounded loop then spins
 * forever holding the thread — in the backend, inside a `doc.update` on an
 * attached Yorkie document, so nothing can interrupt it. A loud throw beats a
 * hang that cannot be diagnosed.
 *
 * Real callers stay far below exhaustion: the grid is 1,000,000 rows, so even
 * a fully materialized axis collides with probability ~0.6 per draw and 64
 * consecutive collisions has probability ~4e-15.
 */
const AXIS_ID_MAX_ATTEMPTS = 64;

/**
 * Generates a random axis ID with the given prefix (e.g. `r3k9`).
 *
 * IDs are random so concurrently-editing clients are unlikely to mint the
 * same ID (see #127). Within a single client the random space (36⁴ ≈ 1.68M)
 * is small enough that batches of rows/cols hit the birthday paradox, so pass
 * `existing` — the IDs already in use — to retry until the result is unique.
 * Cells are keyed by `rowId+colId`, so a duplicate axis ID corrupts data.
 *
 * Throws once {@link AXIS_ID_MAX_ATTEMPTS} draws all collide, which in
 * practice means the caller has exhausted the ID space.
 */
export function createWorksheetAxisId(
  prefix: 'r' | 'c',
  existing?: ReadonlySet<string>,
): string {
  for (let attempt = 0; attempt < AXIS_ID_MAX_ATTEMPTS; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(AXIS_ID_LENGTH));
    let id = prefix;
    for (let i = 0; i < AXIS_ID_LENGTH; i++) {
      id += AXIS_ID_CHARS[bytes[i] % 36];
    }
    if (!existing || !existing.has(id)) {
      return id;
    }
  }
  throw new Error(
    `could not mint a unique "${prefix}" axis ID in ${AXIS_ID_MAX_ATTEMPTS} ` +
      `attempts; the axis holds ${existing?.size ?? 0} of ${AXIS_ID_SPACE} IDs`,
  );
}

export function createWorksheetCellKey(rowId: string, colId: string): string {
  return `${rowId}${WorksheetCellKeySeparator}${colId}`;
}

export function parseWorksheetCellKey(
  key: string,
): { rowId: string; colId: string } {
  const pivot = key.indexOf(WorksheetCellKeySeparator);
  if (pivot === -1) {
    return { rowId: '', colId: '' };
  }
  return {
    rowId: key.slice(0, pivot),
    colId: key.slice(pivot + 1),
  };
}

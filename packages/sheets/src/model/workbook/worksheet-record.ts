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

export function createWorksheetAxisId(prefix: 'r' | 'c'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(AXIS_ID_LENGTH));
  let id = prefix;
  for (let i = 0; i < AXIS_ID_LENGTH; i++) {
    id += AXIS_ID_CHARS[bytes[i] % 36];
  }
  return id;
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

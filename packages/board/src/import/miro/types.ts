import type { ElementInit } from '@wafflebase/slides';

/** Loose mirrors of the backend's Miro payload — the mapper reads no more. */
export interface MiroItemLike {
  id: string;
  type: string;
  position?: { x?: number; y?: number };
  geometry?: { width?: number; height?: number; rotation?: number };
  data?: Record<string, unknown>;
  style?: Record<string, unknown>;
}

export interface MiroConnectorLike {
  id: string;
  shape?: string;
  startItem?: { id?: string };
  endItem?: { id?: string };
  style?: Record<string, unknown>;
}

export interface MiroImportInput {
  items: MiroItemLike[];
  connectors: MiroConnectorLike[];
}

/**
 * `inits` are ready for `store.addElement`. Each carries a non-model `__id`
 * so connectors can reference the element the store will create; the applier
 * strips it before writing.
 */
export interface MiroMapResult {
  inits: (ElementInit & { __id?: string })[];
  /** Count of skipped entries keyed by Miro item type. */
  skipped: Record<string, number>;
}

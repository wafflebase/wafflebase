/** Position of a Miro item. `x`/`y` address the item's CENTER. */
export interface MiroPosition {
  x: number;
  y: number;
  origin?: string;
  relativeTo?: string;
}

/** Size + rotation. `rotation` is in DEGREES. */
export interface MiroGeometry {
  width?: number;
  height?: number;
  rotation?: number;
}

/**
 * The subset of a Miro board item we read. Deliberately narrow and loose —
 * unknown `type` values and unknown `data`/`style` keys are ignored by the
 * mapper rather than throwing, so Miro API drift degrades instead of breaking.
 */
export interface MiroItem {
  id: string;
  type: string;
  position?: MiroPosition;
  geometry?: MiroGeometry;
  data?: Record<string, unknown>;
  style?: Record<string, unknown>;
  parent?: { id?: string };
}

/**
 * One end of a connector. `id` is the connected item's id when attached;
 * `snapTo` (`'auto' | 'top' | 'right' | 'bottom' | 'left'`) and `position`
 * (a relative offset on the item's bounding box) say WHERE on that item the
 * connector lands — the board mapper reads both to choose the connection site,
 * so they must survive the proxy hop verbatim.
 */
export interface MiroConnectorEnd {
  id?: string;
  snapTo?: string;
  position?: { x?: string; y?: string };
}

/** A Miro connector (from the separate /connectors endpoint). */
export interface MiroConnector {
  id: string;
  shape?: string;
  startItem?: MiroConnectorEnd;
  endItem?: MiroConnectorEnd;
  style?: Record<string, unknown>;
  isSupported?: boolean;
}

/** A single skip/degradation the import wants to surface to the user. */
export interface MiroImportNote {
  /** Machine-readable reason, e.g. 'unsupported-type' | 'image-failed' | 'truncated'. */
  reason: string;
  /** The Miro item type this concerns, when applicable. */
  itemType?: string;
  /** How many items this note covers. */
  count: number;
}

/** What the backend proxy returns to the frontend. Contains NO token. */
export interface MiroImportResult {
  items: MiroItem[];
  connectors: MiroConnector[];
  notes: MiroImportNote[];
}

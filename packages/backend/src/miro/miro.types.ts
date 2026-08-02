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

/**
 * The phases of an import, in the order they run. They are the unit the
 * frontend reports on, so they are named rather than numbered: a board with no
 * images still passes through `images`, and the dialog says so.
 */
export type MiroImportStage = 'items' | 'connectors' | 'images';

/**
 * One "we are still alive, here is how far we got" line.
 *
 * `done` is MONOTONIC within a stage — it is a running total of finished work,
 * never a delta — so a UI can render it directly without accumulating.
 * `total` is present only when the size of the phase is known up front, which
 * is true for `images` (the item feed is already in hand) and false for the
 * cursor-paginated feeds.
 */
export interface MiroProgressEvent {
  type: 'progress';
  stage: MiroImportStage;
  done: number;
  total?: number;
}

/** The terminal success line. Exactly one is emitted, and it is always last. */
export interface MiroResultEvent extends MiroImportResult {
  type: 'result';
}

/**
 * The terminal failure line.
 *
 * Once the first byte is on the wire the status code is committed to 200, so a
 * failure after that point cannot be an HTTP status — it has to be in-band.
 * The message is the same user-facing text the pre-stream path would have put
 * in the error body, and it is scrubbed of the token like every other value
 * that leaves this module.
 */
export interface MiroErrorEvent {
  type: 'error';
  message: string;
}

/** One NDJSON line of the import stream. */
export type MiroImportEvent =
  | MiroProgressEvent
  | MiroResultEvent
  | MiroErrorEvent;

/** Sink for progress lines, handed to the service by the controller. */
export type MiroProgressSink = (event: MiroProgressEvent) => void;

/**
 * The state carried across the pre-stream / in-stream boundary.
 *
 * `prepareImport` does the work that can still fail with a MEANINGFUL HTTP
 * status (board-id parsing, and the first authenticated Miro call — which is
 * what surfaces 401/403/404). Its output is this session, and everything after
 * it runs with the response already committed to 200.
 *
 * The first items page is carried along rather than re-fetched: re-issuing it
 * would double the cost of the most rate-limited call in the flow and could
 * legitimately return a different answer.
 */
export interface MiroImportSession {
  boardId: string;
  firstItemsPage: MiroPage<MiroItem>;
}

/** One page of a Miro cursor-paginated feed. */
export interface MiroPage<T> {
  data?: T[];
  cursor?: string;
}

import type { ElementBase, ShapeStroke } from './element';

export type Endpoint =
  | { kind: 'free'; x: number; y: number }
  | { kind: 'attached'; elementId: string; siteIndex: number };

export type ConnectorRouting = 'straight' | 'elbow' | 'curved';

export type ArrowheadKind =
  | 'triangle' | 'triangle-open'
  | 'diamond'  | 'diamond-open'
  | 'circle'   | 'circle-open'
  | 'square'   | 'square-open';

export type ArrowheadStyle = {
  kind: ArrowheadKind;
  size: 'sm' | 'md' | 'lg';
};

/**
 * Line-end arrowhead pair — `start` decorates the first anchor, `end` the
 * last. Shared by {@link ConnectorElement} and freeform `ShapeElement`s so
 * the renderer and PPTX round-trip treat both identically.
 */
export type ArrowheadPair = { start?: ArrowheadStyle; end?: ArrowheadStyle };

export type ConnectorElement = ElementBase & {
  type: 'connector';
  routing: ConnectorRouting;
  start: Endpoint;
  end: Endpoint;
  arrowheads: ArrowheadPair;
  stroke?: ShapeStroke;
  /** Present only when the user manually dragged the elbow handle. */
  elbowBend?: number;
  /**
   * Curve-bend multiplier on `routeCurved`'s control-point distance.
   * Default (when undefined) is 1, matching the auto-routed look.
   * Persists in [0.1, 3] only when the user manually dragged the
   * curved-connector yellow-diamond handle.
   */
  curveBend?: number;
};

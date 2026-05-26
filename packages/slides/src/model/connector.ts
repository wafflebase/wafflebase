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

export type ConnectorElement = ElementBase & {
  type: 'connector';
  routing: ConnectorRouting;
  start: Endpoint;
  end: Endpoint;
  arrowheads: { start?: ArrowheadStyle; end?: ArrowheadStyle };
  stroke?: ShapeStroke;
  /** Present only when the user manually dragged the elbow handle. */
  elbowBend?: number;
};

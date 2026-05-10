import type { PathBuilder } from '../builder';
import { appendDocumentSubpath } from './document';

/**
 * `flowChartMultidocument` — three overlapping document silhouettes,
 * offset by `(w/16, h/16)` per layer, drawn back-to-front so the
 * stroke renders the top-right "shoulders" of the back layers and
 * the full silhouette of the front layer. Default fill rule
 * (nonzero) renders the union.
 */
export const buildFlowChartMultidocument: PathBuilder = ({ w, h }) => {
  const offX = w / 16;
  const offY = h / 16;
  const docW = w - 2 * offX;
  const docH = h - 2 * offY;
  const path = new Path2D();
  appendDocumentSubpath(path, 2 * offX, 0, docW, docH);
  appendDocumentSubpath(path, offX, offY, docW, docH);
  appendDocumentSubpath(path, 0, 2 * offY, docW, docH);
  return path;
};

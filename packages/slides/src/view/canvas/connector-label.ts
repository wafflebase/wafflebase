import { CanvasTextMeasurer, paintLayout, type TextMeasurer } from '@wafflebase/docs';
import type { ConnectorElement } from '../../model/connector';
import type { Element } from '../../model/element';
import { resolveColor, type Theme } from '../../model/theme';
import {
  LABEL_PADDING,
  placeConnectorLabel,
  type ConnectorLabelLayout,
} from './connector-label-layout';
import { makeColorResolver } from './text-renderer';

/**
 * Browser side of connector labels: placement with a Canvas measurer,
 * and painting. The geometry itself lives in the Node-safe
 * `connector-label-layout.ts`, which the PPTX exporter uses directly.
 */

export {
  LABEL_FONT_SIZE,
  LABEL_MAX_WIDTH,
  LABEL_PADDING,
  isLabelEmpty,
  pathMidpoint,
  type ConnectorLabelLayout,
} from './connector-label-layout';

const defaultMeasurer = new CanvasTextMeasurer();

/**
 * Place `connector`'s label (see `placeConnectorLabel`) with the shared
 * Canvas measurer unless one is given. Null without a visible label.
 */
export function layoutConnectorLabel(
  connector: ConnectorElement,
  elements: ReadonlyMap<string, Element>,
  opts: { measurer?: TextMeasurer; fontScale?: number } = {},
): ConnectorLabelLayout | null {
  return placeConnectorLabel(
    connector,
    elements,
    opts.measurer ?? defaultMeasurer,
    opts.fontScale ?? 1,
  );
}

/** The colour behind a label: the theme background, so the line stops at the box. */
export function labelKnockoutColor(theme: Theme): string {
  return resolveColor({ kind: 'role', role: 'background' }, theme);
}

/**
 * Paint `connector`'s label (knockout then text) in world coordinates.
 * The caller draws the connector line first. No-op without a label.
 */
export function drawConnectorLabel(
  ctx: CanvasRenderingContext2D,
  connector: ConnectorElement,
  elements: ReadonlyMap<string, Element>,
  theme: Theme,
  fontScale = 1,
): void {
  const placed = layoutConnectorLabel(connector, elements, { fontScale });
  if (!placed) return;
  const { frame, layout } = placed;
  ctx.save();
  try {
    ctx.fillStyle = labelKnockoutColor(theme);
    ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
    paintLayout(ctx, layout, frame.x + LABEL_PADDING.x, frame.y + LABEL_PADDING.y, {
      colorResolver: makeColorResolver(theme),
    });
  } finally {
    ctx.restore();
  }
}

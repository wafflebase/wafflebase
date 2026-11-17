import type { ConnectorElement } from '../../model/connector.js';
import type { Element, TextElement } from '../../model/element.js';
import {
  LABEL_PADDING,
  placeConnectorLabel,
} from '../../view/canvas/connector-label-layout.js';
import { estimateMeasurer } from '../../lint/estimate-measurer.js';

/**
 * PPTX has no connector label: `<p:cxnSp>` carries no `<p:txBody>`. A
 * labelled connector therefore exports as the connector followed by a
 * plain text box at the label's position, filled with the theme
 * background (the knockout). PowerPoint shows the same picture; the label
 * is no longer tied to the line, and re-importing yields a separate text
 * box rather than a `label` (a lossy round trip, documented in
 * `slides-connectors.md`).
 *
 * Layout uses the Node-safe width estimate, so the box can be a little
 * wider than the canvas one; the text is centred in it either way.
 */
const measurer = estimateMeasurer();

export function connectorLabelTextBox(
  connector: ConnectorElement,
  elements: ReadonlyMap<string, Element>,
): TextElement | null {
  const placed = placeConnectorLabel(connector, elements, measurer);
  if (!placed) return null;
  return {
    id: `${connector.id}-label`,
    type: 'text',
    frame: placed.frame,
    data: {
      blocks: connector.label!.blocks,
      autofit: 'none',
      verticalAnchor: 'middle',
      inset: {
        left: LABEL_PADDING.x,
        right: LABEL_PADDING.x,
        top: LABEL_PADDING.y,
        bottom: LABEL_PADDING.y,
      },
      fill: { kind: 'role', role: 'background' },
    },
  } as TextElement;
}

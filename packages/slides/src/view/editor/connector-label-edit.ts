import type { Block } from '@wafflebase/docs';
import type { ConnectorElement } from '../../model/connector';
import { isBlocksEmpty, type Element, type Frame, type TextBody } from '../../model/element';
import { buildConnectorPath } from '../canvas/connector-frame';
import {
  LABEL_FONT_SIZE,
  LABEL_PADDING,
  layoutConnectorLabel,
  pathMidpoint,
} from '../canvas/connector-label';
import { makeDefaultSlidesTextBlock } from './default-text';

/**
 * In-place editing of a connector label. The editor reuses the ordinary
 * rich-text box (`mountSlidesTextBox`): only the frame it mounts on and
 * the seed blocks differ from a shape's text body.
 */

/** Narrowest edit box, so an empty or one-letter label has room to type. */
export const LABEL_EDIT_MIN_WIDTH = 160;

/** A fresh label paragraph: centred, at the label default size. */
export function makeDefaultLabelBlock(): Block {
  const block = makeDefaultSlidesTextBlock();
  return {
    ...block,
    style: { ...block.style, alignment: 'center' },
    inlines: block.inlines.map((inl) => ({
      ...inl,
      style: { ...inl.style, fontSize: LABEL_FONT_SIZE },
    })),
  } as Block;
}

/**
 * Where the label editor mounts (world coords, text area only: the
 * knockout padding is outside it) and what it starts with. Centred on the
 * path midpoint like the painted label, at least
 * {@link LABEL_EDIT_MIN_WIDTH} wide; the height grows while typing.
 */
export function connectorLabelEditTarget(
  connector: ConnectorElement,
  elements: ReadonlyMap<string, Element>,
  fontScale = 1,
): { editFrame: Frame; blocks: Block[] } {
  const placed = layoutConnectorLabel(connector, elements, { fontScale });
  const center = placed?.center ?? pathMidpoint(buildConnectorPath(connector, elements));
  const contentW = placed ? placed.frame.w - LABEL_PADDING.x * 2 : 0;
  const contentH = placed ? placed.frame.h - LABEL_PADDING.y * 2 : LABEL_FONT_SIZE * 1.6;
  // +2: slack so the live editor does not wrap a line the painter fit.
  const w = Math.max(LABEL_EDIT_MIN_WIDTH, contentW + 2);
  const h = Math.max(contentH, 1);
  return {
    editFrame: { x: center.x - w / 2, y: center.y - h / 2, w, h, rotation: 0 },
    blocks: placed ? connector.label!.blocks : [makeDefaultLabelBlock()],
  };
}

/** The label to store after an edit: `undefined` (remove) when empty. */
export function labelFromEditedBlocks(blocks: Block[]): TextBody | undefined {
  return isBlocksEmpty(blocks) ? undefined : { blocks };
}

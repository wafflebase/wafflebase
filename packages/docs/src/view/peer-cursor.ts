import type { DocPosition, DocRange } from '../model/types.js';
import type { PaginatedLayout } from './pagination.js';
import { findPageForPosition, getPageYOffset, getPageXOffset } from './pagination.js';
import type { DocumentLayout } from './layout.js';
import { buildFont } from './theme.js';

/**
 * Represents a remote peer's cursor for collaborative editing.
 */
export interface PeerCursor {
  clientID: string;
  position: DocPosition;
  color: string;
  username: string;
  labelVisible: boolean;
  selection?: DocRange;
}

/**
 * Pixel coordinates of a cursor position on the canvas.
 */
export interface PositionPixel {
  x: number;
  y: number;
  height: number;
}

/**
 * Shared coordinate calculation extracted from Cursor.getPixelPosition().
 * Resolves a document position to canvas pixel coordinates.
 *
 * @returns PositionPixel if the position can be resolved, undefined otherwise.
 */
export function resolvePositionPixel(
  position: DocPosition,
  lineAffinity: 'forward' | 'backward',
  paginatedLayout: PaginatedLayout,
  layout: DocumentLayout,
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
): PositionPixel | undefined {
  const found = findPageForPosition(
    paginatedLayout, position.blockId, position.offset, layout, lineAffinity,
  );
  if (!found) return undefined;

  const { pageIndex, pageLine } = found;
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const pageY = getPageYOffset(paginatedLayout, pageIndex);
  const lb = layout.blocks[pageLine.blockIndex];

  // Count chars before this line
  let charsBeforeLine = 0;
  for (let li = 0; li < pageLine.lineIndex; li++) {
    for (const r of lb.lines[li].runs) {
      charsBeforeLine += r.charEnd - r.charStart;
    }
  }
  const lineOffset = position.offset - charsBeforeLine;

  let charCount = 0;
  for (const run of pageLine.line.runs) {
    const runLength = run.charEnd - run.charStart;
    if (lineOffset >= charCount && lineOffset <= charCount + runLength) {
      const localOffset = lineOffset - charCount;
      const textBefore = run.text.slice(0, localOffset);
      ctx.font = buildFont(
        run.inline.style.fontSize, run.inline.style.fontFamily,
        run.inline.style.bold, run.inline.style.italic,
      );
      const x = pageX + pageLine.x + run.x + ctx.measureText(textBefore).width;
      return { x, y: pageY + pageLine.y, height: pageLine.line.height };
    }
    charCount += runLength;
  }

  // Fallback: end of line
  const lastRun = pageLine.line.runs[pageLine.line.runs.length - 1];
  if (lastRun) {
    return {
      x: pageX + pageLine.x + lastRun.x + lastRun.width,
      y: pageY + pageLine.y,
      height: pageLine.line.height,
    };
  }
  // Empty line — account for the block's marginLeft (e.g. list indent)
  const blockMarginLeft = lb.block.style.marginLeft ?? 0;
  return { x: pageX + pageLine.x + blockMarginLeft, y: pageY + pageLine.y, height: pageLine.line.height };
}

/**
 * Draw a 2px colored vertical caret for a peer cursor.
 */
export function drawPeerCaret(
  ctx: CanvasRenderingContext2D,
  pixel: PositionPixel,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(pixel.x, pixel.y, 2, pixel.height);
}

/**
 * Returns black or white text color based on background luminance.
 */
function getLabelTextColor(bgColor: string): string {
  const hex = bgColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.6 ? '#000000' : '#FFFFFF';
}

/**
 * Draw a username label tag near a peer cursor caret.
 *
 * The tag is a rounded rectangle filled with `color`, with text color
 * chosen automatically for contrast (white on dark, black on light).
 * When the tag would overflow the top of the page it flips below the caret.
 * When it would overflow the right edge of the canvas it shifts left.
 * Long usernames are truncated with an ellipsis (U+2026).
 *
 * @param ctx         - 2-D canvas context to draw into.
 * @param pixel       - Resolved pixel position of the caret.
 * @param username    - Display name for the peer.
 * @param color       - Hex/CSS color string for the tag background.
 * @param pageTopY    - Absolute Y of the top of the current page (used for flip logic).
 * @param canvasWidth - Total canvas width (used for right-edge clamping).
 */
export function drawPeerLabel(
  ctx: CanvasRenderingContext2D,
  pixel: PositionPixel,
  username: string,
  color: string,
  pageTopY: number,
  canvasWidth: number,
  stackIndex: number = 0,
): void {
  const fontSize = 11;
  const paddingX = 4;
  const paddingY = 2;
  const maxWidth = 120;
  const radius = 2;

  ctx.font = `${fontSize}px sans-serif`;
  let displayName = username;
  let textWidth = ctx.measureText(displayName).width;

  if (textWidth > maxWidth) {
    while (textWidth > maxWidth && displayName.length > 1) {
      displayName = displayName.slice(0, -1);
      textWidth = ctx.measureText(displayName + '\u2026').width;
    }
    displayName += '\u2026';
    textWidth = ctx.measureText(displayName).width;
  }

  const tagWidth = textWidth + paddingX * 2;
  const tagHeight = fontSize + paddingY * 2;

  let x = pixel.x;
  let y = pixel.y - tagHeight - stackIndex * (tagHeight + 1);

  // Flip label below caret if it would overflow the top of the page
  if (y < pageTopY) {
    y = pixel.y + pixel.height + stackIndex * (tagHeight + 1);
  }

  // Clamp x if label overflows canvas right edge
  if (x + tagWidth > canvasWidth) {
    x = canvasWidth - tagWidth;
  }

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + tagWidth - radius, y);
  ctx.arcTo(x + tagWidth, y, x + tagWidth, y + radius, radius);
  ctx.lineTo(x + tagWidth, y + tagHeight);
  ctx.lineTo(x, y + tagHeight);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = getLabelTextColor(color);
  ctx.textBaseline = 'top';
  ctx.fillText(displayName, x + paddingX, y + paddingY);
}

import { Ref, Range } from '../model/types';
import { DimensionIndex } from '../model/dimensions';
import { parseRef } from '../model/coordinates';
import { Theme, ThemeKey, getThemeColor, getPeerCursorColor } from './theme';
import {
  BoundingRect,
  toBoundingRect,
  expandBoundingRect,
  RowHeaderWidth,
  DefaultCellHeight,
} from './layout';

export class Overlay {
  private canvas: HTMLCanvasElement;
  private theme: Theme;

  constructor(theme: Theme = 'light') {
    this.theme = theme;

    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.zIndex = '1';
    this.canvas.style.pointerEvents = 'none';
  }

  public cleanup() {
    this.canvas.remove();
  }

  public getContainer(): HTMLElement {
    return this.canvas;
  }

  public render(
    port: BoundingRect,
    scroll: { left: number; top: number },
    activeCell: Ref,
    peerPresences: Array<{
      clientID: string;
      presence: { activeCell: string };
    }>,
    range?: Range,
    rowDim?: DimensionIndex,
    colDim?: DimensionIndex,
    resizeHover?: { axis: 'row' | 'column'; index: number } | null,
  ) {
    this.canvas.width = 0;
    this.canvas.height = 0;

    const ctx = this.canvas.getContext('2d')!;
    const ratio = window.devicePixelRatio || 1;

    this.canvas.width = port.width * ratio;
    this.canvas.height = port.height * ratio;
    this.canvas.style.width = port.width + 'px';
    this.canvas.style.height = port.height + 'px';
    ctx.scale(ratio, ratio);

    // Render Active Cell
    const rect = toBoundingRect(activeCell, scroll, rowDim, colDim);
    ctx.strokeStyle = this.getThemeColor('activeCellColor');
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);

    // Render Selection Range
    if (range) {
      const rect = expandBoundingRect(
        toBoundingRect(range[0], scroll, rowDim, colDim),
        toBoundingRect(range[1], scroll, rowDim, colDim),
      );
      ctx.fillStyle = this.getThemeColor('selectionBGColor');
      ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
      ctx.strokeStyle = this.getThemeColor('activeCellColor');
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    }

    for (const { clientID, presence } of peerPresences) {
      if (!presence.activeCell) continue;

      const peerActiveCell = parseRef(presence.activeCell);
      const rect = toBoundingRect(peerActiveCell, scroll, rowDim, colDim);

      // Only draw if the peer cursor is within the viewport
      if (
        rect.left >= -rect.width &&
        rect.left < port.width &&
        rect.top >= -rect.height &&
        rect.top < port.height
      ) {
        const peerColor = getPeerCursorColor(this.theme, clientID);
        ctx.strokeStyle = peerColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
      }
    }

    // Render resize hover highlight line
    if (resizeHover && colDim && rowDim) {
      ctx.strokeStyle = this.getThemeColor('resizeHandleColor');
      ctx.lineWidth = 2;

      if (resizeHover.axis === 'column') {
        const x =
          RowHeaderWidth +
          colDim.getOffset(resizeHover.index) +
          colDim.getSize(resizeHover.index) -
          scroll.left;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, port.height);
        ctx.stroke();
      } else {
        const y =
          DefaultCellHeight +
          rowDim.getOffset(resizeHover.index) +
          rowDim.getSize(resizeHover.index) -
          scroll.top;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(port.width, y);
        ctx.stroke();
      }
    }
  }

  private getThemeColor(key: ThemeKey): string {
    return getThemeColor(this.theme, key);
  }
}

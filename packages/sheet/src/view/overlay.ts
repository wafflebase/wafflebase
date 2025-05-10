import { Ref, Range } from '../model/types';
import { Theme, ThemeKey, getThemeColor } from './theme';
import { BoundingRect, toBoundingRect, expandBoundingRect } from './layout';

export class Overlay {
  private canvas: HTMLCanvasElement;
  private theme: Theme;

  constructor(theme: Theme = 'light') {
    this.theme = theme;

    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.zIndex = '1';
  }

  public cleanup() {
    this.canvas.remove();
  }

  public getContainer(): HTMLElement {
    return this.canvas;
  }

  public render(
    viewport: BoundingRect,
    scroll: { left: number; top: number },
    activeCell: Ref,
    range?: Range,
  ) {
    this.canvas.width = 0;
    this.canvas.height = 0;

    const ctx = this.canvas.getContext('2d')!;
    const ratio = window.devicePixelRatio || 1;

    this.canvas.width = viewport.width * ratio;
    this.canvas.height = viewport.height * ratio;
    this.canvas.style.width = viewport.width + 'px';
    this.canvas.style.height = viewport.height + 'px';
    ctx.scale(ratio, ratio);

    // Paint Active Cell
    const rect = toBoundingRect(activeCell, scroll);
    ctx.strokeStyle = this.getThemeColor('activeCellColor');
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);

    // Paint Selection Range
    if (range) {
      const rect = expandBoundingRect(
        toBoundingRect(range[0], scroll),
        toBoundingRect(range[1], scroll),
      );
      ctx.fillStyle = this.getThemeColor('selectionBGColor');
      ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
      ctx.strokeStyle = this.getThemeColor('activeCellColor');
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    }
  }

  private getThemeColor(key: ThemeKey): string {
    return getThemeColor(this.theme, key);
  }
}

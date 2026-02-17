import { Theme } from './theme';
import { FormulaBarHeight, FormulaBarMargin } from './formulabar';

/**
 * Maximum CSS pixel size for the dummy scroll container.
 * Browsers cap element sizes (Safari ~2^24, Chrome/Firefox ~2^25).
 * We use a safe value well below all browser limits.
 */
const MAX_SCROLL_SIZE = 10_000_000;

/**
 * GridContainer manages the main sheet container that holds the grid canvas and scroll area.
 * When the logical grid size exceeds MAX_SCROLL_SIZE, scroll positions are proportionally
 * remapped between the capped physical size and the actual logical size.
 */
export class GridContainer {
  private container!: HTMLDivElement;
  private scrollContainer!: HTMLDivElement;
  private dummyContainer!: HTMLDivElement;

  private actualWidth = 0;
  private actualHeight = 0;

  constructor(_theme: Theme = 'light') {
    this.createContainers();
  }

  private createContainers(): void {
    // Main sheet container
    this.container = document.createElement('div');
    this.container.style.position = 'relative';
    this.container.style.width = '100%';
    this.container.style.height = `calc(100% - ${FormulaBarHeight + FormulaBarMargin * 2}px)`;

    // Scroll container
    this.scrollContainer = document.createElement('div');
    this.scrollContainer.style.position = 'absolute';
    this.scrollContainer.style.overflow = 'auto';
    this.scrollContainer.style.width = '100%';
    this.scrollContainer.style.height = '100%';
    this.scrollContainer.style.zIndex = '1';

    // Dummy container for scroll area sizing
    this.dummyContainer = document.createElement('div');
    this.dummyContainer.style.margin = '0px';
    this.dummyContainer.style.padding = '0px';
    this.dummyContainer.style.pointerEvents = 'none';

    this.scrollContainer.appendChild(this.dummyContainer);
    this.container.appendChild(this.scrollContainer);
  }

  public getContainer(): HTMLDivElement {
    return this.container;
  }

  public getScrollContainer(): HTMLDivElement {
    return this.scrollContainer;
  }

  public getDummyContainer(): HTMLDivElement {
    return this.dummyContainer;
  }

  public updateDummySize(width: number, height: number): void {
    this.actualWidth = width;
    this.actualHeight = height;

    const cappedWidth = Math.min(width, MAX_SCROLL_SIZE);
    const cappedHeight = Math.min(height, MAX_SCROLL_SIZE);

    this.dummyContainer.style.width = cappedWidth + 'px';
    this.dummyContainer.style.height = cappedHeight + 'px';
  }

  public appendChild(element: HTMLElement): void {
    this.container.appendChild(element);
  }

  public getViewport() {
    return this.scrollContainer.getBoundingClientRect();
  }

  public getScrollPosition() {
    const physicalLeft = this.scrollContainer.scrollLeft;
    const physicalTop = this.scrollContainer.scrollTop;
    const viewport = this.scrollContainer.getBoundingClientRect();

    return {
      left: this.toLogical(physicalLeft, this.actualWidth, viewport.width),
      top: this.toLogical(physicalTop, this.actualHeight, viewport.height),
    };
  }

  public setScrollPosition(position: { left?: number; top?: number }) {
    const viewport = this.scrollContainer.getBoundingClientRect();

    if (position.left !== undefined) {
      this.scrollContainer.scrollLeft = this.toPhysical(
        position.left,
        this.actualWidth,
        viewport.width,
      );
    }
    if (position.top !== undefined) {
      this.scrollContainer.scrollTop = this.toPhysical(
        position.top,
        this.actualHeight,
        viewport.height,
      );
    }
  }

  public scrollBy(deltaX: number, deltaY: number): void {
    const viewport = this.scrollContainer.getBoundingClientRect();

    // Convert logical deltas to physical deltas using the ratio
    const physicalDeltaX = this.needsRemap(this.actualWidth, viewport.width)
      ? deltaX * this.physicalMax(this.actualWidth, viewport.width) /
        this.logicalMax(this.actualWidth, viewport.width)
      : deltaX;

    const physicalDeltaY = this.needsRemap(this.actualHeight, viewport.height)
      ? deltaY * this.physicalMax(this.actualHeight, viewport.height) /
        this.logicalMax(this.actualHeight, viewport.height)
      : deltaY;

    this.scrollContainer.scrollBy(physicalDeltaX, physicalDeltaY);
  }

  public addEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (this: HTMLDivElement, ev: HTMLElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.scrollContainer.addEventListener(type, handler, options);
  }

  public removeEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (this: HTMLDivElement, ev: HTMLElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.scrollContainer.removeEventListener(type, handler, options);
  }

  public cleanup(): void {
    this.container.remove();
  }

  private needsRemap(actualSize: number, viewportSize: number): boolean {
    return actualSize > MAX_SCROLL_SIZE && viewportSize < actualSize;
  }

  private cappedSize(actualSize: number): number {
    return Math.min(actualSize, MAX_SCROLL_SIZE);
  }

  private physicalMax(actualSize: number, viewportSize: number): number {
    return Math.max(0, this.cappedSize(actualSize) - viewportSize);
  }

  private logicalMax(actualSize: number, viewportSize: number): number {
    return Math.max(0, actualSize - viewportSize);
  }

  private clamp(value: number, min: number, max: number): number {
    if (max <= min) return min;
    return Math.min(max, Math.max(min, value));
  }

  private toLogical(
    physicalScroll: number,
    actualSize: number,
    viewportSize: number,
  ): number {
    const lMax = this.logicalMax(actualSize, viewportSize);
    if (!this.needsRemap(actualSize, viewportSize)) {
      return this.clamp(physicalScroll, 0, lMax);
    }

    const pMax = this.physicalMax(actualSize, viewportSize);
    if (pMax <= 0 || lMax <= 0) return 0;
    const clampedPhysical = this.clamp(physicalScroll, 0, pMax);
    return clampedPhysical * lMax / pMax;
  }

  private toPhysical(
    logicalScroll: number,
    actualSize: number,
    viewportSize: number,
  ): number {
    const lMax = this.logicalMax(actualSize, viewportSize);
    if (!this.needsRemap(actualSize, viewportSize)) {
      return this.clamp(logicalScroll, 0, lMax);
    }

    if (lMax <= 0) return 0;

    const pMax = this.physicalMax(actualSize, viewportSize);
    const clampedLogical = this.clamp(logicalScroll, 0, lMax);
    return clampedLogical * pMax / lMax;
  }
}

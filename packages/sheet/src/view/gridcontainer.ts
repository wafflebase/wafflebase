import { Theme } from './theme';
import { FormulaBarHeight, FormulaBarMargin } from './formulabar';

/**
 * GridContainer manages the main sheet container that holds the grid canvas and scroll area.
 */
export class GridContainer {
  private container!: HTMLDivElement;
  private scrollContainer!: HTMLDivElement;
  private dummyContainer!: HTMLDivElement;

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
    this.dummyContainer.style.width = width + 'px';
    this.dummyContainer.style.height = height + 'px';
  }

  public appendChild(element: HTMLElement): void {
    this.container.appendChild(element);
  }

  public getViewport() {
    return this.scrollContainer.getBoundingClientRect();
  }

  public getScrollPosition() {
    return {
      left: this.scrollContainer.scrollLeft,
      top: this.scrollContainer.scrollTop,
    };
  }

  public setScrollPosition(position: { left?: number; top?: number }) {
    if (position.left !== undefined) {
      this.scrollContainer.scrollLeft = position.left;
    }
    if (position.top !== undefined) {
      this.scrollContainer.scrollTop = position.top;
    }
  }

  public scrollBy(deltaX: number, deltaY: number): void {
    this.scrollContainer.scrollBy(deltaX, deltaY);
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
}

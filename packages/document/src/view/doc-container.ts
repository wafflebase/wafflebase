/**
 * Scroll management for the document editor.
 */
export class DocContainer {
  private onScrollCallback: (() => void) | null = null;

  constructor(private container: HTMLElement) {
    this.container.style.overflow = 'auto';
    this.container.addEventListener('scroll', this.handleScroll);
  }

  /**
   * Get current scroll offset.
   */
  getScrollY(): number {
    return this.container.scrollTop;
  }

  /**
   * Get the container dimensions.
   */
  getViewport(): { width: number; height: number } {
    return {
      width: this.container.clientWidth,
      height: this.container.clientHeight,
    };
  }

  /**
   * Scroll to ensure a Y position is visible.
   */
  scrollToY(y: number, height: number): void {
    const scrollTop = this.container.scrollTop;
    const viewportHeight = this.container.clientHeight;

    if (y < scrollTop) {
      this.container.scrollTop = y;
    } else if (y + height > scrollTop + viewportHeight) {
      this.container.scrollTop = y + height - viewportHeight;
    }
  }

  /**
   * Register a scroll callback.
   */
  onScrollChange(callback: () => void): void {
    this.onScrollCallback = callback;
  }

  private handleScroll = (): void => {
    this.onScrollCallback?.();
  };

  dispose(): void {
    this.container.removeEventListener('scroll', this.handleScroll);
  }
}

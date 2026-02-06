import { Theme, getThemeColor } from './theme';

export type MenuItem = {
  label: string;
  action: () => void;
};

/**
 * ContextMenu provides a simple HTML-based right-click menu.
 */
export class ContextMenu {
  private container: HTMLDivElement;
  private theme: Theme;

  constructor(theme: Theme = 'light') {
    this.theme = theme;
    this.container = document.createElement('div');
    this.container.style.position = 'fixed';
    this.container.style.display = 'none';
    this.container.style.zIndex = '1000';
    this.container.style.minWidth = '160px';
    this.container.style.borderRadius = '4px';
    this.container.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    this.container.style.padding = '4px 0';
    this.container.style.fontSize = '13px';
    this.container.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    this.applyTheme();

    this.handleDocumentClick = this.handleDocumentClick.bind(this);
  }

  getContainer(): HTMLDivElement {
    return this.container;
  }

  show(x: number, y: number, items: MenuItem[]): void {
    this.container.innerHTML = '';

    for (const item of items) {
      const el = document.createElement('div');
      el.textContent = item.label;
      el.style.padding = '6px 16px';
      el.style.cursor = 'pointer';
      el.style.color = getThemeColor(this.theme, 'cellTextColor');

      el.addEventListener('mouseenter', () => {
        el.style.backgroundColor = getThemeColor(
          this.theme,
          'selectionBGColor',
        );
      });
      el.addEventListener('mouseleave', () => {
        el.style.backgroundColor = 'transparent';
      });

      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        item.action();
      });

      this.container.appendChild(el);
    }

    this.container.style.left = `${x}px`;
    this.container.style.top = `${y}px`;
    this.container.style.display = 'block';

    document.addEventListener('mousedown', this.handleDocumentClick);
  }

  hide(): void {
    this.container.style.display = 'none';
    document.removeEventListener('mousedown', this.handleDocumentClick);
  }

  cleanup(): void {
    this.hide();
    this.container.remove();
  }

  private handleDocumentClick(e: MouseEvent): void {
    if (!this.container.contains(e.target as Node)) {
      this.hide();
    }
  }

  private applyTheme(): void {
    this.container.style.backgroundColor = getThemeColor(
      this.theme,
      'cellBGColor',
    );
    this.container.style.border = `1px solid ${getThemeColor(this.theme, 'cellBorderColor')}`;
  }
}

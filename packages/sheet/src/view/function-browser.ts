import {
  FunctionCatalog,
  FunctionCategory,
  FunctionInfo,
  SheetsFunctionCategoryOrder,
  formatSignature,
  listFunctionCategories,
} from '../formula/function-catalog';
import { Theme, getThemeColor } from './theme';

export class FunctionBrowser {
  private theme: Theme;
  private container: HTMLDivElement;
  private panel: HTMLDivElement;
  private searchInput: HTMLInputElement;
  private status: HTMLDivElement;
  private list: HTMLDivElement;
  private rows: Array<{ row: HTMLDivElement; name: HTMLDivElement }> = [];
  private matches: FunctionInfo[] = [...FunctionCatalog];
  private selectedIndex: number = 0;
  private listTextColor: string = '';
  private listSelectedBG: string = '';
  private listActiveColor: string = '';
  private onInsert?: (info: FunctionInfo) => void;
  private onClose?: () => void;
  private boundHandleBackdropMouseDown: (e: MouseEvent) => void;
  private boundHandleSearchInput: () => void;
  private boundHandleSearchKeydown: (e: KeyboardEvent) => void;
  private boundHandleListPointerDown: (e: PointerEvent) => void;
  private boundHandleListClick: (e: MouseEvent) => void;
  private boundHandleListMouseOver: (e: MouseEvent) => void;

  constructor(theme: Theme = 'light') {
    this.theme = theme;

    this.container = document.createElement('div');
    this.container.style.position = 'fixed';
    this.container.style.inset = '0';
    this.container.style.display = 'none';
    this.container.style.zIndex = '1100';
    this.container.style.backgroundColor = 'rgba(0, 0, 0, 0.18)';
    this.container.style.padding = '40px 16px 16px';
    this.container.style.boxSizing = 'border-box';

    this.panel = document.createElement('div');
    this.panel.style.margin = '0 auto';
    this.panel.style.maxWidth = '720px';
    this.panel.style.height = 'min(560px, calc(100vh - 72px))';
    this.panel.style.display = 'flex';
    this.panel.style.flexDirection = 'column';
    this.panel.style.backgroundColor = getThemeColor(this.theme, 'cellBGColor');
    this.panel.style.border = `1px solid ${getThemeColor(this.theme, 'cellBorderColor')}`;
    this.panel.style.borderRadius = '8px';
    this.panel.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.2)';
    this.panel.style.color = getThemeColor(this.theme, 'cellTextColor');
    this.panel.style.overflow = 'hidden';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.padding = '12px 14px';
    header.style.borderBottom = `1px solid ${getThemeColor(this.theme, 'cellBorderColor')}`;

    const title = document.createElement('div');
    title.textContent = 'Functions';
    title.style.font = '600 14px Arial';
    header.appendChild(title);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = 'Close';
    closeButton.style.border = `1px solid ${getThemeColor(this.theme, 'cellBorderColor')}`;
    closeButton.style.borderRadius = '4px';
    closeButton.style.backgroundColor = getThemeColor(this.theme, 'cellBGColor');
    closeButton.style.color = getThemeColor(this.theme, 'cellTextColor');
    closeButton.style.padding = '4px 8px';
    closeButton.style.font = '12px Arial';
    closeButton.style.cursor = 'pointer';
    closeButton.addEventListener('click', () => this.hide());
    header.appendChild(closeButton);

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.flexDirection = 'column';
    controls.style.gap = '6px';
    controls.style.padding = '12px 14px 10px';
    controls.style.borderBottom = `1px solid ${getThemeColor(this.theme, 'cellBorderColor')}`;

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.placeholder = 'Search by name or description';
    this.searchInput.style.width = '100%';
    this.searchInput.style.boxSizing = 'border-box';
    this.searchInput.style.padding = '7px 10px';
    this.searchInput.style.border = `1px solid ${getThemeColor(this.theme, 'cellBorderColor')}`;
    this.searchInput.style.borderRadius = '4px';
    this.searchInput.style.outline = 'none';
    this.searchInput.style.font = '13px Arial';
    this.searchInput.style.color = getThemeColor(this.theme, 'cellTextColor');
    this.searchInput.style.backgroundColor = getThemeColor(this.theme, 'cellBGColor');
    controls.appendChild(this.searchInput);

    this.status = document.createElement('div');
    this.status.style.font = '12px Arial';
    this.status.style.opacity = '0.75';
    controls.appendChild(this.status);

    this.list = document.createElement('div');
    this.list.style.flex = '1';
    this.list.style.overflow = 'auto';
    this.list.style.padding = '6px 0';

    this.panel.appendChild(header);
    this.panel.appendChild(controls);
    this.panel.appendChild(this.list);
    this.container.appendChild(this.panel);

    this.boundHandleBackdropMouseDown = (e: MouseEvent) => {
      if (e.target === this.container) {
        this.hide();
      }
    };
    this.boundHandleSearchInput = () => {
      this.selectedIndex = 0;
      this.filterAndRender();
    };
    this.boundHandleSearchKeydown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.matches.length > 0) {
          this.setSelectedIndex((this.selectedIndex + 1) % this.matches.length);
          this.scrollSelectedIntoView();
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.matches.length > 0) {
          this.setSelectedIndex(
            (this.selectedIndex - 1 + this.matches.length) % this.matches.length,
          );
          this.scrollSelectedIntoView();
        }
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        this.insertSelected();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
    };
    this.boundHandleListPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const index = this.getRowIndexFromTarget(e.target);
      if (index === null) return;
      // Keep editor selection context and support both mouse and touch.
      e.preventDefault();
      this.setSelectedIndex(index);
      this.insertSelected();
    };
    this.boundHandleListClick = (e: MouseEvent) => {
      if (e.button !== 0 || !this.isVisible()) return;
      const index = this.getRowIndexFromTarget(e.target);
      if (index === null) return;
      // Fallback for environments where pointer events are unavailable.
      e.preventDefault();
      this.setSelectedIndex(index);
      this.insertSelected();
    };
    this.boundHandleListMouseOver = (e: MouseEvent) => {
      const index = this.getRowIndexFromTarget(e.target);
      if (index === null || index === this.selectedIndex) return;
      this.setSelectedIndex(index);
    };

    this.container.addEventListener(
      'mousedown',
      this.boundHandleBackdropMouseDown,
    );
    this.searchInput.addEventListener('input', this.boundHandleSearchInput);
    this.searchInput.addEventListener('keydown', this.boundHandleSearchKeydown);
    this.list.addEventListener('pointerdown', this.boundHandleListPointerDown);
    this.list.addEventListener('click', this.boundHandleListClick);
    this.list.addEventListener('mouseover', this.boundHandleListMouseOver);
    this.filterAndRender();
  }

  public getContainer(): HTMLDivElement {
    return this.container;
  }

  public setOnInsert(handler: (info: FunctionInfo) => void): void {
    this.onInsert = handler;
  }

  public setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  public contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.container.contains(target);
  }

  public isVisible(): boolean {
    return this.container.style.display !== 'none';
  }

  public show(): void {
    this.searchInput.value = '';
    this.selectedIndex = 0;
    this.filterAndRender();
    this.container.style.display = 'block';
    requestAnimationFrame(() => this.searchInput.focus());
  }

  public hide(): void {
    if (!this.isVisible()) {
      return;
    }
    this.container.style.display = 'none';
    this.onClose?.();
  }

  public cleanup(): void {
    this.container.removeEventListener(
      'mousedown',
      this.boundHandleBackdropMouseDown,
    );
    this.searchInput.removeEventListener('input', this.boundHandleSearchInput);
    this.searchInput.removeEventListener(
      'keydown',
      this.boundHandleSearchKeydown,
    );
    this.list.removeEventListener('pointerdown', this.boundHandleListPointerDown);
    this.list.removeEventListener('click', this.boundHandleListClick);
    this.list.removeEventListener('mouseover', this.boundHandleListMouseOver);
    this.container.remove();
  }

  private filterAndRender(): void {
    const query = this.searchInput.value.trim().toUpperCase();
    const queryFiltered =
      query.length === 0
        ? FunctionCatalog
        : FunctionCatalog.filter((info) => {
            const name = info.name.toUpperCase();
            const description = info.description.toUpperCase();
            const signature = formatSignature(info).toUpperCase();
            return (
              name.includes(query) ||
              description.includes(query) ||
              signature.includes(query)
            );
          });

    const categoryOrder = new Map(
      SheetsFunctionCategoryOrder.map((category, index) => [category, index]),
    );
    this.matches = [...queryFiltered].sort((left, right) => {
      const leftCategory = categoryOrder.get(left.category) ?? Number.MAX_SAFE_INTEGER;
      const rightCategory =
        categoryOrder.get(right.category) ?? Number.MAX_SAFE_INTEGER;
      if (leftCategory !== rightCategory) {
        return leftCategory - rightCategory;
      }
      return left.name.localeCompare(right.name);
    });
    if (this.selectedIndex >= this.matches.length) {
      this.selectedIndex = Math.max(0, this.matches.length - 1);
    }
    this.renderList();
  }

  private renderList(): void {
    this.list.innerHTML = '';
    this.rows = [];
    const categories = listFunctionCategories(this.matches);
    this.status.textContent = `${this.matches.length} functions in ${categories.length} categories`;

    if (this.matches.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No matching functions';
      empty.style.padding = '16px 14px';
      empty.style.font = '13px Arial';
      empty.style.opacity = '0.8';
      this.list.appendChild(empty);
      return;
    }

    const borderColor = getThemeColor(this.theme, 'cellBorderColor');
    this.listTextColor = getThemeColor(this.theme, 'cellTextColor');
    this.listSelectedBG = getThemeColor(this.theme, 'selectionBGColor');
    this.listActiveColor = getThemeColor(this.theme, 'activeCellColor');

    let lastCategory: FunctionCategory | null = null;
    for (let i = 0; i < this.matches.length; i++) {
      const info = this.matches[i];
      if (info.category !== lastCategory) {
        const heading = document.createElement('div');
        heading.dataset.funcCategoryHeader = info.category;
        heading.textContent = info.category;
        heading.style.padding = '8px 14px 4px';
        heading.style.font = '600 11px Arial';
        heading.style.letterSpacing = '0.04em';
        heading.style.textTransform = 'uppercase';
        heading.style.opacity = '0.68';
        heading.style.borderBottom = `1px solid ${borderColor}`;
        heading.style.backgroundColor = getThemeColor(this.theme, 'headerBGColor');
        this.list.appendChild(heading);
        lastCategory = info.category;
      }

      const row = document.createElement('div');
      row.dataset.funcName = info.name;
      row.dataset.funcIndex = String(i);
      row.style.display = 'flex';
      row.style.gap = '10px';
      row.style.alignItems = 'flex-start';
      row.style.justifyContent = 'flex-start';
      row.style.padding = '10px 14px';
      row.style.cursor = 'pointer';
      row.style.borderBottom = `1px solid ${borderColor}`;
      row.style.backgroundColor = 'transparent';

      const details = document.createElement('div');
      details.style.minWidth = '0';
      details.style.flex = '1';

      const titleRow = document.createElement('div');
      titleRow.style.display = 'flex';
      titleRow.style.alignItems = 'center';
      titleRow.style.justifyContent = 'space-between';
      titleRow.style.gap = '8px';

      const name = document.createElement('div');
      name.textContent = info.name;
      name.style.font = '600 13px Arial';
      name.style.color = this.listTextColor;
      name.style.flex = '1';

      const category = document.createElement('div');
      category.textContent = info.category;
      category.style.font = '11px Arial';
      category.style.opacity = '0.66';
      category.style.whiteSpace = 'nowrap';

      const signature = document.createElement('div');
      signature.textContent = formatSignature(info);
      signature.style.font = '12px Arial';
      signature.style.opacity = '0.82';
      signature.style.marginTop = '2px';
      signature.style.wordBreak = 'break-word';

      const description = document.createElement('div');
      description.textContent = info.description;
      description.style.font = '12px Arial';
      description.style.opacity = '0.72';
      description.style.marginTop = '2px';
      description.style.wordBreak = 'break-word';

      titleRow.appendChild(name);
      titleRow.appendChild(category);
      details.appendChild(titleRow);
      details.appendChild(signature);
      details.appendChild(description);
      row.appendChild(details);
      this.list.appendChild(row);
      this.rows.push({ row, name });
    }

    this.updateRowSelection(this.selectedIndex);
  }

  private scrollSelectedIntoView(): void {
    const selected = this.rows[this.selectedIndex]?.row;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }

  private getRowIndexFromTarget(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) return null;
    const row = target.closest('[data-func-index]');
    if (!(row instanceof HTMLDivElement) || !this.list.contains(row)) return null;
    const index = Number(row.dataset.funcIndex);
    return Number.isInteger(index) ? index : null;
  }

  private setSelectedIndex(nextIndex: number): void {
    if (
      nextIndex === this.selectedIndex ||
      nextIndex < 0 ||
      nextIndex >= this.matches.length
    ) {
      return;
    }

    const prevIndex = this.selectedIndex;
    this.selectedIndex = nextIndex;
    this.updateRowSelection(prevIndex);
    this.updateRowSelection(nextIndex);
  }

  private updateRowSelection(index: number): void {
    const row = this.rows[index];
    if (!row) return;
    const selected = index === this.selectedIndex;
    row.row.style.backgroundColor = selected ? this.listSelectedBG : 'transparent';
    row.name.style.color = selected ? this.listActiveColor : this.listTextColor;
  }

  private insertSelected(): void {
    const selected = this.matches[this.selectedIndex];
    if (!selected) return;
    this.onInsert?.(selected);
    this.hide();
  }
}

import { Theme, getThemeColor } from './theme';
import {
  FunctionInfo,
  searchFunctions,
  findFunction,
  formatSignature,
} from '../formula/function-catalog';

/**
 * AutocompleteContext describes what the user is currently typing in a formula.
 */
export type AutocompleteContext =
  | { type: 'function-name'; prefix: string }
  | { type: 'argument'; funcName: string; argIndex: number }
  | { type: 'none' };

/**
 * `getAutocompleteContext` analyzes formula text and cursor position to determine
 * whether the user is typing a function name or inside a function's arguments.
 */
export function getAutocompleteContext(
  text: string,
  cursorPos: number,
): AutocompleteContext {
  if (!text.startsWith('=')) {
    return { type: 'none' };
  }

  // Work with the text up to cursor position
  const before = text.slice(1, cursorPos); // skip '='

  // Walk backward to find the current context
  let depth = 0;
  let commaCount = 0;

  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];

    if (ch === ')') {
      depth++;
    } else if (ch === '(') {
      if (depth > 0) {
        depth--;
      } else {
        // We found an unmatched '(' — extract the function name before it
        const nameMatch = before.slice(0, i).match(/([A-Za-z_]\w*)$/);
        if (nameMatch) {
          return {
            type: 'argument',
            funcName: nameMatch[1].toUpperCase(),
            argIndex: commaCount,
          };
        }
        return { type: 'none' };
      }
    } else if (ch === ',' && depth === 0) {
      commaCount++;
    }
  }

  // No unmatched '(' found — check if the user is typing a function name
  const nameMatch = before.match(/([A-Za-z_]\w*)$/);
  if (nameMatch) {
    return { type: 'function-name', prefix: nameMatch[1] };
  }

  return { type: 'none' };
}

/**
 * FormulaAutocomplete is a DOM-based autocomplete dropdown for formula entry.
 * It supports two display modes:
 * - List mode: filtered function names with descriptions
 * - Hint mode: function signature with the current argument highlighted
 */
export class FormulaAutocomplete {
  private container: HTMLDivElement;
  private theme: Theme;
  private selectedIndex: number = 0;
  private matches: FunctionInfo[] = [];
  private mode: 'list' | 'hint' | 'hidden' = 'hidden';
  private currentHint: { info: FunctionInfo; argIndex: number } | null = null;

  constructor(theme: Theme = 'light') {
    this.theme = theme;

    this.container = document.createElement('div');
    this.container.style.position = 'fixed';
    this.container.style.display = 'none';
    this.container.style.zIndex = '1000';
    this.container.style.minWidth = '220px';
    this.container.style.maxWidth = '360px';
    this.container.style.borderRadius = '4px';
    this.container.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    this.container.style.padding = '4px 0';
    this.container.style.fontSize = '13px';
    this.container.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    this.container.style.maxHeight = '300px';
    this.container.style.overflowY = 'auto';
    this.container.style.overflowX = 'hidden';
    this.applyTheme();
  }

  getContainer(): HTMLDivElement {
    return this.container;
  }

  /**
   * `showList` displays the function list dropdown filtered by prefix.
   */
  showList(prefix: string, anchor: { left: number; top: number }): void {
    this.matches = searchFunctions(prefix);
    if (this.matches.length === 0) {
      this.hide();
      return;
    }

    this.mode = 'list';
    this.selectedIndex = 0;
    this.renderList();
    this.positionAt(anchor);
    this.container.style.display = 'block';
  }

  /**
   * `showHint` displays the function signature hint with the current argument highlighted.
   */
  showHint(
    funcName: string,
    argIndex: number,
    anchor: { left: number; top: number },
  ): void {
    const info = findFunction(funcName);
    if (!info) {
      this.hide();
      return;
    }

    this.mode = 'hint';
    this.currentHint = { info, argIndex };
    this.renderHint();
    this.positionAt(anchor);
    this.container.style.display = 'block';
  }

  /**
   * `hide` hides the autocomplete dropdown.
   */
  hide(): void {
    this.mode = 'hidden';
    this.matches = [];
    this.currentHint = null;
    this.container.style.display = 'none';
    this.container.innerHTML = '';
  }

  /**
   * `reposition` moves the visible autocomplete popup without changing mode or
   * selection state.
   */
  reposition(anchor: { left: number; top: number }): void {
    if (this.mode === 'hidden') {
      return;
    }
    this.positionAt(anchor);
  }

  /**
   * `moveUp` moves the selection up in list mode.
   */
  moveUp(): void {
    if (this.mode !== 'list' || this.matches.length === 0) return;
    this.selectedIndex =
      (this.selectedIndex - 1 + this.matches.length) % this.matches.length;
    this.renderList();
    this.scrollToSelected();
  }

  /**
   * `moveDown` moves the selection down in list mode.
   */
  moveDown(): void {
    if (this.mode !== 'list' || this.matches.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.matches.length;
    this.renderList();
    this.scrollToSelected();
  }

  /**
   * `getSelectedFunction` returns the currently selected function info, or undefined.
   */
  getSelectedFunction(): FunctionInfo | undefined {
    if (this.mode !== 'list') return undefined;
    return this.matches[this.selectedIndex];
  }

  isListVisible(): boolean {
    return this.mode === 'list';
  }

  isHintVisible(): boolean {
    return this.mode === 'hint';
  }

  cleanup(): void {
    this.hide();
    this.container.remove();
  }

  private scrollToSelected(): void {
    const row = this.container.children[this.selectedIndex] as HTMLElement;
    if (row) {
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  private positionAt(anchor: { left: number; top: number }): void {
    this.container.style.left = `${anchor.left}px`;
    this.container.style.top = `${anchor.top}px`;
  }

  private renderList(): void {
    this.container.innerHTML = '';

    const bgColor = getThemeColor(this.theme, 'cellBGColor');
    const textColor = getThemeColor(this.theme, 'cellTextColor');
    const selectedBG = getThemeColor(this.theme, 'selectionBGColor');
    const activeCellColor = getThemeColor(this.theme, 'activeCellColor');

    for (let i = 0; i < this.matches.length; i++) {
      const info = this.matches[i];
      const row = document.createElement('div');
      row.style.padding = '4px 10px';
      row.style.cursor = 'pointer';
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.gap = '1px';
      row.style.backgroundColor = i === this.selectedIndex ? selectedBG : bgColor;

      const nameEl = document.createElement('div');
      nameEl.style.fontWeight = '600';
      nameEl.style.color = i === this.selectedIndex ? activeCellColor : textColor;
      nameEl.textContent = info.name;

      const descEl = document.createElement('div');
      descEl.style.fontSize = '11px';
      descEl.style.opacity = '0.7';
      descEl.style.color = textColor;
      descEl.textContent = info.description;

      row.appendChild(nameEl);
      row.appendChild(descEl);

      row.addEventListener('mouseenter', () => {
        this.selectedIndex = i;
        this.renderList();
      });

      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      this.container.appendChild(row);
    }
  }

  private renderHint(): void {
    this.container.innerHTML = '';
    if (!this.currentHint) return;

    const { info, argIndex } = this.currentHint;
    const textColor = getThemeColor(this.theme, 'cellTextColor');
    const activeCellColor = getThemeColor(this.theme, 'activeCellColor');

    const row = document.createElement('div');
    row.style.padding = '6px 10px';
    row.style.color = textColor;
    row.style.whiteSpace = 'nowrap';

    // Build: FUNC_NAME( arg1, [arg2], ... ) with the current arg highlighted
    const nameSpan = document.createElement('span');
    nameSpan.style.fontWeight = '600';
    nameSpan.textContent = info.name + '(';
    row.appendChild(nameSpan);

    for (let i = 0; i < info.args.length; i++) {
      if (i > 0) {
        row.appendChild(document.createTextNode(', '));
      }

      const arg = info.args[i];
      let label = arg.optional ? `[${arg.name}]` : arg.name;
      if (arg.repeating) {
        label += ', ...';
      }

      const argSpan = document.createElement('span');
      // Highlight the current argument, or clamp to the last repeating arg
      const isActive =
        i === argIndex ||
        (i === info.args.length - 1 && arg.repeating && argIndex >= i);
      if (isActive) {
        argSpan.style.fontWeight = '700';
        argSpan.style.color = activeCellColor;
      }
      argSpan.textContent = label;
      row.appendChild(argSpan);
    }

    row.appendChild(document.createTextNode(')'));

    // Add description below
    const descEl = document.createElement('div');
    descEl.style.fontSize = '11px';
    descEl.style.opacity = '0.7';
    descEl.style.color = textColor;
    descEl.style.padding = '2px 10px 4px';
    descEl.textContent = formatSignature(info) + ' — ' + info.description;

    this.container.appendChild(row);
    this.container.appendChild(descEl);
  }

  private applyTheme(): void {
    this.container.style.backgroundColor = getThemeColor(
      this.theme,
      'cellBGColor',
    );
    this.container.style.border = `1px solid ${getThemeColor(this.theme, 'cellBorderColor')}`;
  }
}

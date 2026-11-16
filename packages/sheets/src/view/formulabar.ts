import {
  toSref,
  toSrng,
  toColumnLabel,
  inRange,
  parseColumnLabel,
  toRange,
} from '../model/core/coordinates';
import type { Range, Ref } from '../model/core/types';
import { Sheet } from '../model/worksheet/sheet';
import { extractTokens } from '../formula/formula';
import { Theme, ThemeKey, getThemeColor, getFormulaRangeColor } from './theme';
import { setTextRange, toTextRange } from './utils/textrange';
import { escapeHTML } from './utils/html';

export const FormulaBarHeight = 23;
export const FormulaBarMargin = 10;

/**
 * Where a name-box entry asks to go. Whole columns and whole rows are their
 * own kinds because they select as columns/rows (header-highlighted), not as
 * a cell range that happens to span the grid.
 */
export type NameBoxTarget =
  | { kind: 'cell'; ref: Ref }
  | { kind: 'range'; range: Range }
  | { kind: 'columns'; from: number; to: number }
  | { kind: 'rows'; from: number; to: number };

const CellPattern = /^\$?([A-Z]+)\$?([0-9]+)$/;
const ColumnPattern = /^\$?([A-Z]+)$/;
const RowPattern = /^\$?([0-9]+)$/;

/**
 * `parseNameBoxInput` reads what was typed into the name box: `C3`, `B2:D4`,
 * `A:C` or `2:5`, case-insensitive and `$`-tolerant. Anything else — and any
 * reference past the grid — is `null`, which the caller treats as "revert",
 * never as a value to write.
 */
export function parseNameBoxInput(
  text: string,
  dimension: { rows: number; columns: number },
): NameBoxTarget | null {
  const input = text.trim().toUpperCase();
  if (!input) return null;

  const inGrid = (ref: Ref) =>
    ref.r >= 1 &&
    ref.r <= dimension.rows &&
    ref.c >= 1 &&
    ref.c <= dimension.columns;
  const toCell = (part: string): Ref | null => {
    const match = part.match(CellPattern);
    if (!match) return null;
    const ref = { r: parseInt(match[2], 10), c: parseColumnLabel(match[1]) };
    return inGrid(ref) ? ref : null;
  };

  const parts = input.split(':');
  if (parts.length === 1) {
    const ref = toCell(parts[0]);
    return ref ? { kind: 'cell', ref } : null;
  }
  if (parts.length !== 2) return null;
  const [a, b] = parts;

  const from = toCell(a);
  const to = toCell(b);
  if (from && to) {
    return { kind: 'range', range: toRange(from, to) };
  }

  const colA = a.match(ColumnPattern);
  const colB = b.match(ColumnPattern);
  if (colA && colB) {
    const x = parseColumnLabel(colA[1]);
    const y = parseColumnLabel(colB[1]);
    if (Math.max(x, y) > dimension.columns) return null;
    return { kind: 'columns', from: Math.min(x, y), to: Math.max(x, y) };
  }

  const rowA = a.match(RowPattern);
  const rowB = b.match(RowPattern);
  if (rowA && rowB) {
    const x = parseInt(rowA[1], 10);
    const y = parseInt(rowB[1], 10);
    if (Math.min(x, y) < 1 || Math.max(x, y) > dimension.rows) return null;
    return { kind: 'rows', from: Math.min(x, y), to: Math.max(x, y) };
  }

  return null;
}

export type NameBoxHandlers = {
  /** A reference was submitted; returns whether it was navigated to. */
  onSubmit: (text: string) => boolean;
  /** Escape: the grid should take the keyboard back. */
  onCancel: () => void;
  /** The name box took focus (an in-progress cell edit should commit). */
  onFocus?: () => void;
};

export class FormulaBar {
  private sheet?: Sheet;
  private theme: Theme;
  private readOnly: boolean;

  private container: HTMLDivElement;
  private nameBox: HTMLInputElement;
  private label: string = '';
  private nameBoxHandlers?: NameBoxHandlers;
  private boundHandleNameBoxKeydown: (e: KeyboardEvent) => void;
  private boundHandleNameBoxFocus: () => void;
  private boundHandleNameBoxBlur: () => void;
  private boundHandleNameBoxMouseDown: (e: MouseEvent) => void;
  private formulaInput: HTMLDivElement;
  private boundHandleInput: () => void;
  private boundHandleCompositionStart: () => void;
  private boundHandleCompositionEnd: () => void;
  private boundHandlePaste: (e: ClipboardEvent) => void;
  private composing: boolean = false;
  /**
   * Whether the formula input holds text the user typed or pasted into it
   * since it last showed the stored value. Mirroring the cell editor through
   * `setValue` does not count: that text already lives in the cell editor.
   */
  private edited: boolean = false;

  constructor(theme: Theme = 'light', readOnly: boolean = false) {
    this.theme = theme;
    this.readOnly = readOnly;

    this.container = document.createElement('div');
    this.container.style.height = `${FormulaBarHeight}px`;
    this.container.style.margin = `${FormulaBarMargin}px 0px`;
    this.container.style.display = 'flex';
    this.container.style.alignItems = 'center';
    this.container.style.borderTop = `1px solid ${getThemeColor(this.theme, 'cellBorderColor')}`;
    this.container.style.borderBottom = `1px solid ${getThemeColor(this.theme, 'cellBorderColor')}`;
    this.container.style.justifyContent = 'flex-start';

    // The name box (Google Sheets parity): shows the selection, and takes a
    // reference to jump to. An <input> rather than a <div> matters for more
    // than looks — keys typed into a non-focusable div reach the grid's
    // document-level keydown and were written into the active cell.
    this.nameBox = document.createElement('input');
    this.nameBox.type = 'text';
    this.nameBox.spellcheck = false;
    this.nameBox.autocomplete = 'off';
    this.nameBox.setAttribute('aria-label', 'Name box');
    this.nameBox.style.boxSizing = 'border-box';
    this.nameBox.style.width = '120px';
    this.nameBox.style.flex = '0 0 120px';
    this.nameBox.style.height = '100%';
    this.nameBox.style.padding = '0 4px';
    this.nameBox.style.margin = '0';
    this.nameBox.style.textAlign = 'center';
    this.nameBox.style.font = '12px Arial';
    this.nameBox.style.color = getThemeColor(this.theme, 'cellTextColor');
    this.nameBox.style.caretColor = getThemeColor(this.theme, 'cellTextColor');
    this.nameBox.style.backgroundColor = 'transparent';
    this.nameBox.style.border = 'none';
    this.nameBox.style.borderRight = `1px solid ${getThemeColor(this.theme, 'cellBorderColor')}`;
    this.nameBox.style.borderRadius = '0';
    this.nameBox.style.outline = 'none';
    this.container.appendChild(this.nameBox);

    this.formulaInput = document.createElement('div');
    this.formulaInput.contentEditable = this.readOnly ? 'false' : 'true';
    this.formulaInput.style.margin = '0 20px';
    this.formulaInput.style.width = '100%';
    this.formulaInput.style.height = '12px';
    this.formulaInput.style.border = 'none';
    this.formulaInput.style.font = '12px Arial';
    this.formulaInput.style.color = getThemeColor(this.theme, 'cellTextColor');
    this.formulaInput.style.outline = 'none';
    this.formulaInput.style.overflow = 'hidden';
    this.formulaInput.style.whiteSpace = 'nowrap';
    this.formulaInput.style.lineHeight = '12px';
    this.container.appendChild(this.formulaInput);

    this.boundHandleInput = this.handleInput.bind(this);
    this.boundHandleCompositionStart = this.handleCompositionStart.bind(this);
    this.boundHandleCompositionEnd = this.handleCompositionEnd.bind(this);
    this.boundHandlePaste = this.handlePaste.bind(this);
    this.boundHandleNameBoxKeydown = this.handleNameBoxKeydown.bind(this);
    this.boundHandleNameBoxFocus = this.handleNameBoxFocus.bind(this);
    this.boundHandleNameBoxBlur = this.handleNameBoxBlur.bind(this);
    this.boundHandleNameBoxMouseDown = this.handleNameBoxMouseDown.bind(this);
    this.nameBox.addEventListener('mousedown', this.boundHandleNameBoxMouseDown);
    this.nameBox.addEventListener('keydown', this.boundHandleNameBoxKeydown);
    this.nameBox.addEventListener('focus', this.boundHandleNameBoxFocus);
    this.nameBox.addEventListener('blur', this.boundHandleNameBoxBlur);
    this.formulaInput.addEventListener('input', this.boundHandleInput);
    this.formulaInput.addEventListener(
      'compositionstart',
      this.boundHandleCompositionStart,
    );
    this.formulaInput.addEventListener(
      'compositionend',
      this.boundHandleCompositionEnd,
    );
    this.formulaInput.addEventListener('paste', this.boundHandlePaste);
  }

  public getContainer(): HTMLElement {
    return this.container;
  }

  public initialize(sheet: Sheet) {
    this.sheet = sheet;
  }

  public cleanup() {
    this.formulaInput.removeEventListener('input', this.boundHandleInput);
    this.formulaInput.removeEventListener(
      'compositionstart',
      this.boundHandleCompositionStart,
    );
    this.formulaInput.removeEventListener(
      'compositionend',
      this.boundHandleCompositionEnd,
    );
    this.formulaInput.removeEventListener('paste', this.boundHandlePaste);
    this.nameBox.removeEventListener('keydown', this.boundHandleNameBoxKeydown);
    this.nameBox.removeEventListener('focus', this.boundHandleNameBoxFocus);
    this.nameBox.removeEventListener('blur', this.boundHandleNameBoxBlur);
    this.nameBox.removeEventListener(
      'mousedown',
      this.boundHandleNameBoxMouseDown,
    );
    this.nameBoxHandlers = undefined;
    this.sheet = undefined;
    this.container.remove();
  }

  public async render() {
    if (!this.sheet) return;

    const ref = this.sheet.getActiveCell();
    const selectionType = this.sheet.getSelectionType();
    const indices = this.sheet.getSelectedIndices();

    let label: string;
    if (selectionType === 'row' && indices) {
      label = `${indices.from}:${indices.to}`;
    } else if (selectionType === 'column' && indices) {
      const fromLabel = toColumnLabel(indices.from);
      const toLabel = toColumnLabel(indices.to);
      label = `${fromLabel}:${toLabel}`;
    } else {
      const ranges = this.sheet.getRanges();
      if (ranges.length > 0) {
        // Show only the range containing the active cell
        const activeRange = ranges.find((r) => inRange(ref, r))
          ?? ranges[ranges.length - 1];
        label = toSrng(activeRange);
      } else {
        label = toSref(ref);
      }
    }

    this.label = label;
    // Never overwrite a reference the user is part-way through typing.
    if (!this.isNameBoxFocused()) {
      this.nameBox.value = label;
    }
    this.formulaInput.innerText = await this.sheet.toInputString(ref);
    this.edited = false;
    this.renderInput();
  }

  public getFormulaInput(): HTMLDivElement {
    return this.formulaInput;
  }

  public getNameBox(): HTMLInputElement {
    return this.nameBox;
  }

  public setNameBoxHandlers(handlers: NameBoxHandlers): void {
    this.nameBoxHandlers = handlers;
  }

  /**
   * `isNameBoxTarget` tells the grid's document-level key handlers that an
   * event belongs to the name box, so it is never read as typing into a cell.
   */
  public isNameBoxTarget(target: EventTarget | null): boolean {
    return target === this.nameBox;
  }

  public isNameBoxFocused(): boolean {
    return document.activeElement === this.nameBox;
  }

  private handleNameBoxFocus(): void {
    this.nameBox.style.boxShadow = `inset 0 0 0 2px ${getThemeColor(this.theme, 'activeCellColor')}`;
    this.nameBox.select();
    this.nameBoxHandlers?.onFocus?.();
  }

  /**
   * The first click selects the whole reference, as Google's name box does;
   * letting the press through would collapse the focus handler's selection
   * to a caret on mouseup.
   */
  private handleNameBoxMouseDown(e: MouseEvent): void {
    if (this.isNameBoxFocused() || e.button !== 0) return;
    e.preventDefault();
    this.nameBox.focus();
  }

  private handleNameBoxBlur(): void {
    this.nameBox.style.boxShadow = 'none';
    this.nameBox.value = this.label;
  }

  private handleNameBoxKeydown(e: KeyboardEvent): void {
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const navigated = this.nameBoxHandlers?.onSubmit(this.nameBox.value);
      if (!navigated) {
        // Not a reference: put the selection back and let the user retry.
        // Nothing is written anywhere.
        this.nameBox.value = this.label;
        this.nameBox.select();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.nameBox.value = this.label;
      this.nameBoxHandlers?.onCancel();
    }
  }

  public getValue(): string {
    return this.formulaInput.innerText.replace(/\u00a0/g, ' ');
  }

  public setValue(value: string) {
    this.formulaInput.innerText = value;
    this.renderInput();
  }

  public focus() {
    this.formulaInput.focus();
  }

  public blur() {
    this.formulaInput.blur();
  }

  public isFocused(): boolean {
    return document.activeElement === this.formulaInput;
  }

  public isComposing(): boolean {
    return this.composing;
  }

  /**
   * `isEdited` reports an uncommitted edit in the formula input — one that
   * no keyup may have copied to the cell editor (a context-menu paste), and
   * that a focus move which skips `finishEditing` (the name box) would lose.
   */
  public isEdited(): boolean {
    return this.edited;
  }

  private handleInput(): void {
    this.edited = true;
    if (this.composing) {
      return;
    }
    this.renderInput();
  }

  private handleCompositionStart(): void {
    this.composing = true;
  }

  private handlePaste(e: ClipboardEvent): void {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
  }

  private handleCompositionEnd(): void {
    this.composing = false;
    this.renderInput();
  }

  private renderInput(): void {
    if (this.composing) {
      return;
    }

    const text = this.formulaInput.innerText;
    if (!text.startsWith('=')) {
      return;
    }

    const tokens = extractTokens(text);
    const contents: Array<string> = [];
    let refIndex = 0;
    for (const token of tokens) {
      if (token.type === 'REFERENCE') {
        contents.push(
          `<span style="color: ${getFormulaRangeColor(this.theme, refIndex)}">${escapeHTML(token.text)}</span>`,
        );
        refIndex++;
        continue;
      }
      if (token.type === 'NUM') {
        contents.push(
          `<span style="color: ${this.getThemeColor('tokens.NUM')}">${escapeHTML(token.text)}</span>`,
        );
        continue;
      }

      contents.push(escapeHTML(token.text));
    }

    const textRange = toTextRange(this.formulaInput);
    this.formulaInput.innerHTML = '=' + contents.join('');
    if (textRange) {
      setTextRange(this.formulaInput, textRange);
    }
  }

  private getThemeColor(key: ThemeKey): string {
    return getThemeColor(this.theme, key);
  }
}

import { toSref, toSrng, toColumnLabel } from '../model/coordinates';
import { Sheet } from '../model/sheet';
import { extractTokens } from '../formula/formula';
import { Theme, ThemeKey, getThemeColor, getFormulaRangeColor } from './theme';
import { setTextRange, toTextRange } from './utils/textrange';
import { escapeHTML } from './utils/html';

export const FormulaBarHeight = 23;
export const FormulaBarMargin = 10;

export class FormulaBar {
  private sheet?: Sheet;
  private theme: Theme;
  private readOnly: boolean;

  private container: HTMLDivElement;
  private cellLabel: HTMLDivElement;
  private formulaInput: HTMLDivElement;
  private boundHandleInput: () => void;
  private boundHandleCompositionStart: () => void;
  private boundHandleCompositionEnd: () => void;
  private composing: boolean = false;

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

    this.cellLabel = document.createElement('div');
    this.cellLabel.style.width = '120px';
    this.cellLabel.style.textAlign = 'center';
    this.cellLabel.style.font = '12px Arial';
    this.cellLabel.style.borderRight = `1px solid ${getThemeColor(this.theme, 'cellBorderColor')}`;
    this.container.appendChild(this.cellLabel);

    this.formulaInput = document.createElement('div');
    this.formulaInput.contentEditable = this.readOnly ? 'false' : 'true';
    this.formulaInput.style.margin = '0 20px';
    this.formulaInput.style.width = '100%';
    this.formulaInput.style.height = '12px';
    this.formulaInput.style.border = 'none';
    this.formulaInput.style.font = '12px Arial';
    this.formulaInput.style.outline = 'none';
    this.formulaInput.style.overflow = 'hidden';
    this.formulaInput.style.whiteSpace = 'nowrap';
    this.formulaInput.style.lineHeight = '12px';
    this.container.appendChild(this.formulaInput);

    this.boundHandleInput = this.handleInput.bind(this);
    this.boundHandleCompositionStart = this.handleCompositionStart.bind(this);
    this.boundHandleCompositionEnd = this.handleCompositionEnd.bind(this);
    this.formulaInput.addEventListener('input', this.boundHandleInput);
    this.formulaInput.addEventListener(
      'compositionstart',
      this.boundHandleCompositionStart,
    );
    this.formulaInput.addEventListener(
      'compositionend',
      this.boundHandleCompositionEnd,
    );
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
      const range = this.sheet.getRange();
      label = range ? toSrng(range) : toSref(ref);
    }

    this.cellLabel.textContent = label;
    this.formulaInput.innerText = await this.sheet.toInputString(ref);
    this.renderInput();
  }

  public getFormulaInput(): HTMLDivElement {
    return this.formulaInput;
  }

  public getValue(): string {
    return this.formulaInput.innerText;
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

  private handleInput(): void {
    if (this.composing) {
      return;
    }
    this.renderInput();
  }

  private handleCompositionStart(): void {
    this.composing = true;
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
          `<span style="color: ${getFormulaRangeColor(this.theme, refIndex)}">${token.text}</span>`,
        );
        refIndex++;
        continue;
      }
      if (token.type === 'NUM') {
        contents.push(
          `<span style="color: ${this.getThemeColor('tokens.NUM')}">${token.text}</span>`,
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

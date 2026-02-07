import { toSref } from '../model/coordinates';
import { Sheet } from '../model/sheet';
import { extractTokens } from '../formula/formula';
import { Theme, ThemeKey, getThemeColor } from './theme';
import { setTextRange, toTextRange } from './utils/textrange';
import { escapeHTML } from './utils/html';

export const FormulaBarHeight = 23;
export const FormulaBarMargin = 10;

export class FormulaBar {
  private sheet?: Sheet;
  private theme: Theme;

  private container: HTMLDivElement;
  private cellLabel: HTMLDivElement;
  private formulaInput: HTMLDivElement;
  private boundRenderInput: () => void;

  constructor(theme: Theme = 'light') {
    this.theme = theme;

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
    this.formulaInput.contentEditable = 'true';
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

    this.boundRenderInput = this.renderInput.bind(this);
    this.formulaInput.addEventListener('input', this.boundRenderInput);
  }

  public getContainer(): HTMLElement {
    return this.container;
  }

  public initialize(sheet: Sheet) {
    this.sheet = sheet;
  }

  public cleanup() {
    this.formulaInput.removeEventListener('input', this.boundRenderInput);
    this.sheet = undefined;
    this.container.remove();
  }

  public async render() {
    if (!this.sheet) return;

    const ref = this.sheet.getActiveCell();
    this.cellLabel.textContent = toSref(ref);
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

  private renderInput(): void {
    const text = this.formulaInput.innerText;
    if (!text.startsWith('=')) {
      return;
    }

    const tokens = extractTokens(text);
    const contents: Array<string> = [];
    for (const token of tokens) {
      if (token.type === 'REFERENCE' || token.type === 'NUM') {
        contents.push(
          `<span style="color: ${this.getThemeColor(`tokens.${token.type}`)}">${token.text}</span>`,
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

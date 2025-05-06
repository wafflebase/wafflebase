import { toSref } from '../worksheet/coordinates';
import { Sheet } from '../worksheet/sheet';
import { Theme, getThemeColor } from './theme';

export const FormulaBarHeight = 23;
export const FormulaBarMargin = 10;

export class FormulaBar {
  private sheet?: Sheet;
  private theme: Theme;

  private container: HTMLDivElement;
  private cellLabel: HTMLDivElement;
  private formulaInput: HTMLInputElement;

  constructor(container: HTMLDivElement, theme: Theme = 'light') {
    this.container = container;
    this.theme = theme;

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

    this.formulaInput = document.createElement('input');
    this.formulaInput.style.margin = '20px';
    this.formulaInput.style.width = '100%';
    this.formulaInput.style.height = '12px';
    this.formulaInput.style.border = 'none';
    this.formulaInput.style.font = '12px Arial';
    this.formulaInput.style.outlineWidth = '0';
    this.container.appendChild(this.formulaInput);
  }

  public initialize(sheet: Sheet) {
    this.sheet = sheet;
  }

  public cleanup() {
    this.sheet = undefined;
    this.container.innerHTML = '';
  }

  public async render() {
    if (!this.sheet) return;
    
    const ref = this.sheet.getActiveCell();
    this.cellLabel.textContent = toSref(ref);
    this.formulaInput.value = await this.sheet.toInputString(ref);
  }

  public getFormulaInput(): HTMLInputElement {
    return this.formulaInput;
  }

  public getValue(): string {
    return this.formulaInput.value;
  }

  public setValue(value: string) {
    this.formulaInput.value = value;
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
} 
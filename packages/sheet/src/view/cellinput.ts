import { extractTokens } from '../formula/formula';
import { Theme, ThemeKey, getThemeColor } from './theme';
import { setTextRange, toTextRange } from './utils/textrange';
import { escapeHTML } from './utils/html';
import { DefaultCellWidth, DefaultCellHeight } from './layout';

export class CellInput {
  private container: HTMLDivElement;
  private input: HTMLDivElement;
  private theme: Theme;
  private boundRenderInput: () => void;

  constructor(theme: Theme = 'light') {
    this.theme = theme;

    this.container = document.createElement('div');
    this.container.style.position = 'absolute';
    this.container.style.left = '-1000px';
    this.container.style.width = DefaultCellWidth + 'px';
    this.container.style.height = DefaultCellHeight + 'px';
    this.container.style.zIndex = '1';
    this.container.style.margin = '0px';
    this.container.style.pointerEvents = 'none';

    this.input = document.createElement('div');
    this.input.contentEditable = 'true';
    this.input.style.width = '100%';
    this.input.style.height = '100%';
    this.input.style.border = 'none';
    this.input.style.outline = `2px solid ${this.getThemeColor('activeCellColor')}`;
    this.input.style.fontFamily = 'Arial, sans-serif';
    this.input.style.fontSize = '14px';
    this.input.style.fontWeight = 'normal';
    this.input.style.lineHeight = '1.5';
    this.input.style.color = this.getThemeColor('cellTextColor');
    this.input.style.backgroundColor = this.getThemeColor('cellBGColor');
    this.container.appendChild(this.input);

    this.boundRenderInput = this.renderInput.bind(this);
    this.input.addEventListener('input', this.boundRenderInput);
  }

  public cleanup(): void {
    this.input.removeEventListener('input', this.boundRenderInput);
    this.container.remove();
  }

  public getContainer(): HTMLDivElement {
    return this.container;
  }

  public getInput(): HTMLDivElement {
    return this.input;
  }

  public show(
    left: number,
    top: number,
    value: string = '',
    focus: boolean = true,
  ): void {
    this.container.style.left = left + 'px';
    this.container.style.top = top + 'px';
    this.container.style.pointerEvents = 'auto';
    this.input.innerText = value;

    this.renderInput();
    if (focus) {
      setTextRange(this.input, {
        start: this.input.innerText.length,
        end: this.input.innerText.length,
      });
      this.input.focus();
    }
  }

  public hide(): void {
    this.container.style.left = '-1000px';
    this.container.style.pointerEvents = 'none';
    this.input.innerText = '';
    this.input.blur();
  }

  public isShown(): boolean {
    return this.container.style.left !== '-1000px';
  }

  public isFocused(): boolean {
    return document.activeElement === this.input;
  }

  public getValue(): string {
    return this.input.innerText;
  }

  public setValue(value: string): void {
    this.input.innerText = value;
    this.renderInput();
  }

  public hasFormula(): boolean {
    return this.input.innerText.startsWith('=');
  }

  private renderInput(): void {
    const text = this.input.innerText;
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

    const textRange = toTextRange(this.input);
    this.input.innerHTML = '=' + contents.join('');
    if (textRange) {
      setTextRange(this.input, textRange);
    }
  }

  private getThemeColor(key: ThemeKey): string {
    return getThemeColor(this.theme, key);
  }
}

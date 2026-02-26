import { CellStyle } from '../model/types';
import { extractTokens } from '../formula/formula';
import { Theme, ThemeKey, getThemeColor, getFormulaRangeColor } from './theme';
import { setTextRange, toTextRange } from './utils/textrange';
import { escapeHTML } from './utils/html';
import {
  DefaultCellWidth,
  DefaultCellHeight,
  CellFontSize,
  CellLineHeight,
} from './layout';

export class CellInput {
  private container: HTMLDivElement;
  private input: HTMLDivElement;
  private cellPositionHint: HTMLDivElement;
  private theme: Theme;
  private boundHandleInput: () => void;
  private minWidth: number = DefaultCellWidth;
  private minHeight: number = DefaultCellHeight;
  private maxWidth: number = Infinity;
  private maxHeight: number = Infinity;
  private composing: boolean = false;
  private primed: boolean = false;
  private boundHandleCompositionStart: () => void;
  private boundHandleCompositionEnd: () => void;
  private onPrimedActivate?: () => void;

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
    this.input.style.border = 'none';
    this.input.style.outline = `2px solid ${this.getThemeColor('activeCellColor')}`;
    this.input.style.fontFamily = 'Arial, sans-serif';
    this.input.style.fontSize = CellFontSize + 'px';
    this.input.style.fontWeight = 'normal';
    this.input.style.lineHeight = String(CellLineHeight);
    this.input.style.color = this.getThemeColor('cellTextColor');
    this.input.style.backgroundColor = this.getThemeColor('cellBGColor');
    this.input.style.whiteSpace = 'pre';
    this.input.style.overflow = 'hidden';
    this.container.appendChild(this.input);

    this.cellPositionHint = document.createElement('div');
    this.cellPositionHint.style.position = 'absolute';
    this.cellPositionHint.style.right = '4px';
    this.cellPositionHint.style.top = '4px';
    this.cellPositionHint.style.padding = '0 4px';
    this.cellPositionHint.style.borderRadius = '3px';
    this.cellPositionHint.style.border = `1px solid ${this.getThemeColor('cellBorderColor')}`;
    this.cellPositionHint.style.backgroundColor = this.getThemeColor('headerBGColor');
    this.cellPositionHint.style.color = this.getThemeColor('cellTextColor');
    this.cellPositionHint.style.fontSize = '10px';
    this.cellPositionHint.style.lineHeight = '14px';
    this.cellPositionHint.style.fontFamily = 'Arial, sans-serif';
    this.cellPositionHint.style.pointerEvents = 'none';
    this.cellPositionHint.style.display = 'none';
    this.cellPositionHint.style.zIndex = '2';
    this.container.appendChild(this.cellPositionHint);

    this.boundHandleInput = this.handleInput.bind(this);
    this.boundHandleCompositionStart = this.handleCompositionStart.bind(this);
    this.boundHandleCompositionEnd = this.handleCompositionEnd.bind(this);
    this.input.addEventListener('input', this.boundHandleInput);
    this.input.addEventListener(
      'compositionstart',
      this.boundHandleCompositionStart,
    );
    this.input.addEventListener('compositionend', this.boundHandleCompositionEnd);
  }

  public cleanup(): void {
    this.input.removeEventListener('input', this.boundHandleInput);
    this.input.removeEventListener(
      'compositionstart',
      this.boundHandleCompositionStart,
    );
    this.input.removeEventListener('compositionend', this.boundHandleCompositionEnd);
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
    width?: number,
    height?: number,
    maxWidth?: number,
    maxHeight?: number,
    placeCaretAtEnd: boolean = true,
  ): void {
    this.primed = false;
    this.applyEditingAppearance();
    this.updateFrame(
      left,
      top,
      width ?? DefaultCellWidth,
      height ?? DefaultCellHeight,
      maxWidth ?? Infinity,
      maxHeight ?? Infinity,
    );
    this.input.innerText = value;

    this.renderInput();
    this.adjustSize();
    if (focus) {
      this.input.focus();
      if (placeCaretAtEnd) {
        setTextRange(this.input, {
          start: this.input.innerText.length,
          end: this.input.innerText.length,
        });
      }
    }
  }

  public prime(
    left: number,
    top: number,
    width?: number,
    height?: number,
    maxWidth?: number,
    maxHeight?: number,
  ): void {
    this.primed = true;
    this.updateFrame(
      left,
      top,
      width ?? DefaultCellWidth,
      height ?? DefaultCellHeight,
      maxWidth ?? Infinity,
      maxHeight ?? Infinity,
    );
    this.input.innerText = '';
    this.renderInput();
    this.adjustSize();
    this.applyPrimedAppearance();
    this.input.focus();
  }

  public hide(): void {
    this.primed = false;
    this.applyEditingAppearance();
    this.container.style.left = '-1000px';
    this.container.style.pointerEvents = 'none';
    this.setCellPositionHint();
    this.input.innerText = '';
    this.input.blur();
  }

  public isShown(): boolean {
    return this.container.style.left !== '-1000px';
  }

  public isFocused(): boolean {
    return document.activeElement === this.input;
  }

  public isComposing(): boolean {
    return this.composing;
  }

  public isPrimed(): boolean {
    return this.primed;
  }

  public setOnPrimedActivate(callback: () => void): void {
    this.onPrimedActivate = callback;
  }

  public getValue(): string {
    return this.input.innerText;
  }

  public setValue(value: string): void {
    this.input.innerText = value;
    this.renderInput();
    this.adjustSize();
  }

  public hasFormula(): boolean {
    return this.input.innerText.startsWith('=');
  }

  public updatePlacement(
    left: number,
    top: number,
    width: number = DefaultCellWidth,
    height: number = DefaultCellHeight,
    maxWidth: number = Infinity,
    maxHeight: number = Infinity,
  ): void {
    this.updateFrame(left, top, width, height, maxWidth, maxHeight);
    this.adjustSize();
  }

  public setCellPositionHint(position?: string): void {
    if (!position) {
      this.cellPositionHint.style.display = 'none';
      this.cellPositionHint.innerText = '';
      return;
    }
    this.cellPositionHint.innerText = position;
    this.cellPositionHint.style.display = 'block';
  }

  public applyStyle(style?: CellStyle): void {
    this.input.style.fontWeight = style?.b ? 'bold' : 'normal';
    this.input.style.fontStyle = style?.i ? 'italic' : 'normal';

    const decorations: string[] = [];
    if (style?.u) decorations.push('underline');
    if (style?.st) decorations.push('line-through');
    this.input.style.textDecoration = decorations.length
      ? decorations.join(' ')
      : 'none';

    this.input.style.color = style?.tc || this.getThemeColor('cellTextColor');
    this.input.style.backgroundColor =
      style?.bg || this.getThemeColor('cellBGColor');
    this.input.style.textAlign = style?.al || 'left';

    // Vertical alignment via flexbox on the container
    const va = style?.va || 'top';
    this.container.style.display = 'flex';
    this.container.style.alignItems =
      va === 'middle' ? 'center' : va === 'bottom' ? 'flex-end' : 'flex-start';
  }

  private handleInput(): void {
    this.activatePrimedInput();
    if (this.composing) {
      this.adjustSize();
      return;
    }
    this.renderInput();
    this.adjustSize();
  }

  private handleCompositionStart(): void {
    this.activatePrimedInput();
    this.composing = true;
  }

  private handleCompositionEnd(): void {
    this.composing = false;
    this.renderInput();
    this.adjustSize();
  }

  private updateFrame(
    left: number,
    top: number,
    width: number,
    height: number,
    maxWidth: number,
    maxHeight: number,
  ): void {
    this.minWidth = width;
    this.minHeight = height;
    this.maxWidth = maxWidth;
    this.maxHeight = maxHeight;

    this.container.style.left = left + 'px';
    this.container.style.top = top + 'px';
  }

  private adjustSize(): void {
    // Temporarily shrink to min dimensions so scroll sizes measure the content
    this.input.style.width = this.minWidth + 'px';
    this.input.style.height = this.minHeight + 'px';

    const width = Math.min(
      Math.max(this.minWidth, this.input.scrollWidth),
      this.maxWidth,
    );
    const height = Math.min(
      Math.max(this.minHeight, this.input.scrollHeight),
      this.maxHeight,
    );

    this.container.style.width = width + 'px';
    this.container.style.height = height + 'px';
    this.input.style.width = width + 'px';
    this.input.style.height = height + 'px';
    this.input.style.overflowY =
      this.input.scrollHeight > this.maxHeight ? 'auto' : 'hidden';
  }

  private renderInput(): void {
    if (this.composing) {
      return;
    }

    const text = this.input.innerText;
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

    const textRange = toTextRange(this.input);
    this.input.innerHTML = '=' + contents.join('');
    if (textRange) {
      setTextRange(this.input, textRange);
    }
  }

  private getThemeColor(key: ThemeKey): string {
    return getThemeColor(this.theme, key);
  }

  private activatePrimedInput(): void {
    if (!this.primed) {
      return;
    }
    this.primed = false;
    this.applyEditingAppearance();
    this.onPrimedActivate?.();
  }

  private applyEditingAppearance(): void {
    this.container.style.pointerEvents = 'auto';
    this.input.style.outline = `2px solid ${this.getThemeColor('activeCellColor')}`;
    this.input.style.color = this.getThemeColor('cellTextColor');
    this.input.style.backgroundColor = this.getThemeColor('cellBGColor');
    this.input.style.caretColor = this.getThemeColor('cellTextColor');
  }

  private applyPrimedAppearance(): void {
    this.container.style.pointerEvents = 'none';
    this.input.style.outline = 'none';
    this.input.style.color = 'transparent';
    this.input.style.backgroundColor = 'transparent';
    this.input.style.caretColor = 'transparent';
  }
}

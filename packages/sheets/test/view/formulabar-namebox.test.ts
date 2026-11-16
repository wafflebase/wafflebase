// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormulaBar, parseNameBoxInput } from '../../src/view/formulabar';
import { Sheet } from '../../src/model/worksheet/sheet';
import { MemStore } from '../../src/store/memory';

const Dimension = { rows: 1000, columns: 100 };

describe('parseNameBoxInput', () => {
  it('reads a single cell, case-insensitively and with $ markers', () => {
    expect(parseNameBoxInput('C3', Dimension)).toEqual({
      kind: 'cell',
      ref: { r: 3, c: 3 },
    });
    expect(parseNameBoxInput(' $c$3 ', Dimension)).toEqual({
      kind: 'cell',
      ref: { r: 3, c: 3 },
    });
  });

  it('reads a range and normalizes its corners', () => {
    expect(parseNameBoxInput('D4:B2', Dimension)).toEqual({
      kind: 'range',
      range: [
        { r: 2, c: 2 },
        { r: 4, c: 4 },
      ],
    });
  });

  it('reads whole columns and whole rows', () => {
    expect(parseNameBoxInput('A:C', Dimension)).toEqual({
      kind: 'columns',
      from: 1,
      to: 3,
    });
    expect(parseNameBoxInput('5:2', Dimension)).toEqual({
      kind: 'rows',
      from: 2,
      to: 5,
    });
  });

  it('rejects text that is not a reference', () => {
    for (const text of ['', 'hello', 'A0', '3C', 'A1:', 'Sheet2', '=A1', 'A1:B']) {
      expect(parseNameBoxInput(text, Dimension)).toBeNull();
    }
  });

  it('rejects references past the grid', () => {
    expect(parseNameBoxInput('A1001', Dimension)).toBeNull();
    expect(parseNameBoxInput('CW1', Dimension)).toBeNull();
    expect(parseNameBoxInput('1:1001', Dimension)).toBeNull();
  });
});

describe('FormulaBar name box', () => {
  let bar: FormulaBar | undefined;

  afterEach(() => {
    bar?.cleanup();
    bar = undefined;
  });

  async function mount(): Promise<{ bar: FormulaBar; nameBox: HTMLInputElement }> {
    const sheet = new Sheet(new MemStore());
    sheet.selectStart({ r: 8, c: 6 });
    bar = new FormulaBar();
    document.body.appendChild(bar.getContainer());
    bar.initialize(sheet);
    await bar.render();
    return { bar, nameBox: bar.getNameBox() };
  }

  const press = (el: HTMLElement, key: string) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);
    return event;
  };

  it('is an editable input showing the active cell', async () => {
    const { nameBox } = await mount();
    expect(nameBox.tagName).toBe('INPUT');
    expect(nameBox.value).toBe('F8');
    expect(nameBox.getAttribute('aria-label')).toBe('Name box');
  });

  it('submits the typed reference on Enter', async () => {
    const { bar, nameBox } = await mount();
    const onSubmit = vi.fn().mockReturnValue(true);
    bar.setNameBoxHandlers({ onSubmit, onCancel: vi.fn() });

    nameBox.focus();
    nameBox.value = 'C3';
    const event = press(nameBox, 'Enter');

    expect(onSubmit).toHaveBeenCalledWith('C3');
    expect(event.defaultPrevented).toBe(true);
  });

  it('reverts and stays put when the reference is invalid', async () => {
    const { bar, nameBox } = await mount();
    const onSubmit = vi.fn().mockReturnValue(false);
    bar.setNameBoxHandlers({ onSubmit, onCancel: vi.fn() });

    nameBox.focus();
    nameBox.value = 'not a ref';
    press(nameBox, 'Enter');

    expect(nameBox.value).toBe('F8');
    expect(document.activeElement).toBe(nameBox);
  });

  it('restores the label and hands focus back on Escape', async () => {
    const { bar, nameBox } = await mount();
    const onCancel = vi.fn();
    bar.setNameBoxHandlers({ onSubmit: vi.fn(), onCancel });

    nameBox.focus();
    nameBox.value = 'Z9';
    press(nameBox, 'Escape');

    expect(nameBox.value).toBe('F8');
    expect(onCancel).toHaveBeenCalled();
  });

  it('does not overwrite what the user is typing on a re-render', async () => {
    const { bar, nameBox } = await mount();
    nameBox.focus();
    nameBox.value = 'B2';
    await bar.render();
    expect(nameBox.value).toBe('B2');

    nameBox.blur();
    expect(nameBox.value).toBe('F8');
  });

  it('selects the whole reference on the first click', async () => {
    const { nameBox } = await mount();
    const down = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    nameBox.dispatchEvent(down);

    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(nameBox);
    expect(nameBox.selectionStart).toBe(0);
    expect(nameBox.selectionEnd).toBe('F8'.length);
  });

  it('recognizes its own events so the grid can ignore them', async () => {
    const { bar, nameBox } = await mount();
    expect(bar.isNameBoxTarget(nameBox)).toBe(true);
    expect(bar.isNameBoxTarget(bar.getFormulaInput())).toBe(false);
  });
});

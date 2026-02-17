// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionCatalog } from '../../src/formula/function-catalog';
import { FunctionBrowser } from '../../src/view/function-browser';

describe('FunctionBrowser', () => {
  let browser: FunctionBrowser;

  beforeEach(() => {
    browser = new FunctionBrowser('light');
    document.body.appendChild(browser.getContainer());
  });

  afterEach(() => {
    browser.cleanup();
    document.body.innerHTML = '';
  });

  it('shows all functions by default', () => {
    browser.show();

    const rows = browser.getContainer().querySelectorAll('[data-func-name]');
    expect(rows).toHaveLength(FunctionCatalog.length);
  });

  it('filters functions by search input', () => {
    browser.show();

    const input = browser.getContainer().querySelector('input');
    expect(input).toBeTruthy();
    input!.value = 'countif';
    input!.dispatchEvent(new Event('input', { bubbles: true }));

    const rows = Array.from(
      browser.getContainer().querySelectorAll('[data-func-name]'),
    ).map((row) => (row as HTMLElement).dataset.funcName);

    expect(rows).toContain('COUNTIF');
    expect(rows).toContain('COUNTIFS');
    expect(rows).not.toContain('SUM');
  });

  it('inserts selected function on Enter key', () => {
    const onInsert = vi.fn();
    browser.setOnInsert(onInsert);
    browser.show();

    const input = browser.getContainer().querySelector('input');
    expect(input).toBeTruthy();
    input!.value = 'sum';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0][0].name).toBe('SUM');
    expect(browser.isVisible()).toBe(false);
  });

  it('inserts selected function on row mouse down', () => {
    const onInsert = vi.fn();
    browser.setOnInsert(onInsert);
    browser.show();

    const row = browser
      .getContainer()
      .querySelector('[data-func-name="SUM"]') as HTMLElement | null;
    expect(row).toBeTruthy();
    row!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0][0].name).toBe('SUM');
    expect(browser.isVisible()).toBe(false);
  });
});

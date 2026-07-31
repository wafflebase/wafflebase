import { describe, it, expect } from 'vitest';
import { isEditableTarget } from './is-editable-target';

/**
 * Regression coverage for C1: the document-level Space-for-pan keydown
 * handler in `BoardView` must not swallow a space keystroke typed into
 * a regular editable field (SiteHeader rename input, Share dialog,
 * etc.) — it should only intercept Space when the canvas (or some
 * non-editable surface) has focus.
 */
describe('isEditableTarget', () => {
  it('is false for a non-Element target (e.g. document/window)', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
  });

  it('is false for a plain non-editable element (e.g. the canvas host div)', () => {
    const div = document.createElement('div');
    expect(isEditableTarget(div)).toBe(false);
  });

  it('is true for an <input> (e.g. the SiteHeader rename input, Share dialog)', () => {
    const input = document.createElement('input');
    expect(isEditableTarget(input)).toBe(true);
  });

  it('is true for a <textarea>', () => {
    const textarea = document.createElement('textarea');
    expect(isEditableTarget(textarea)).toBe(true);
  });

  it('is true for a <select>', () => {
    const select = document.createElement('select');
    expect(isEditableTarget(select)).toBe(true);
  });

  it('is true for a contenteditable element', () => {
    // jsdom does not implement `contentEditable` attribute reflection
    // (setting `div.contentEditable = 'true'` never flips
    // `isContentEditable`), so stub the getter directly to exercise
    // this branch of `isEditableTarget` in isolation.
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', {
      value: true,
      configurable: true,
    });
    expect(isEditableTarget(div)).toBe(true);
  });

  // Regression coverage for F2: a focused BoardToolbar toggle (a native
  // <button> under Radix's Toggle/Toolbar primitives) must not have its
  // Space-activates-click behavior swallowed by the pan-mode shortcut.
  it('is true for a <button> (e.g. a focused BoardToolbar toggle)', () => {
    const button = document.createElement('button');
    expect(isEditableTarget(button)).toBe(true);
  });

  it('is true for an element with role="button"', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'button');
    expect(isEditableTarget(div)).toBe(true);
  });

  it('is false for a non-button element with an unrelated role', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'presentation');
    expect(isEditableTarget(div)).toBe(false);
  });
});

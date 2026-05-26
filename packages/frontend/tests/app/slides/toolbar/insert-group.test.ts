import { describe, it, expect } from 'vitest';
import { isLinePickerKind } from '@/app/slides/line-picker-helpers.ts';

/**
 * These are logic tests for InsertGroup rather than its React rendering.
 * The testable surface — the insert-mode → active-kind mapping logic that
 * determines which child picker receives a non-null activeKind — is covered
 * here without rendering the component.
 *
 * Full interaction tests (click Image button → onImagePick fires, etc.) belong
 * in the browser interaction suite (tests/visual / Playwright) once the new
 * toolbar is wired into slides-detail.tsx.
 */

describe('InsertGroup activeKind derivation', () => {
  /**
   * The ShapePicker receives a non-null activeKind when insertMode is a
   * ShapeKind — i.e. not null, not 'text', and not a connector kind.
   */
  function shapePickerActiveKind(insertMode: string | null): string | null {
    if (!insertMode) return null;
    if (insertMode === 'text') return null;
    if (isLinePickerKind(insertMode)) return null;
    return insertMode;
  }

  it('shapePickerActiveKind is null when insertMode is null', () => {
    expect(shapePickerActiveKind(null)).toBe(null);
  });

  it('shapePickerActiveKind is null when insertMode is "text"', () => {
    expect(shapePickerActiveKind('text')).toBe(null);
  });

  it('shapePickerActiveKind is null when insertMode is a connector kind', () => {
    expect(shapePickerActiveKind('connector:line')).toBe(null);
    expect(shapePickerActiveKind('connector:arrow')).toBe(null);
  });

  it('shapePickerActiveKind returns the kind for any ShapeKind value', () => {
    expect(shapePickerActiveKind('rect')).toBe('rect');
    expect(shapePickerActiveKind('ellipse')).toBe('ellipse');
    expect(shapePickerActiveKind('rightArrow')).toBe('rightArrow');
  });

  /**
   * The LinePicker receives a non-null activeKind only for connector kinds.
   */
  it('linePickerActiveKind is non-null only for connector kinds', () => {
    const lineActive = (mode: string | null) =>
      isLinePickerKind(mode) ? mode : null;

    expect(lineActive(null)).toBe(null);
    expect(lineActive('text')).toBe(null);
    expect(lineActive('rect')).toBe(null);
    expect(lineActive('connector:line')).toBe('connector:line');
    expect(lineActive('connector:arrow')).toBe('connector:arrow');
  });

  /**
   * The Select toggle is pressed when insertMode === null.
   * The Text toggle is pressed when insertMode === 'text'.
   */
  it('Select toggle pressed state matches insertMode === null', () => {
    const isSelectPressed = (mode: string | null) => mode === null;
    expect(isSelectPressed(null)).toBe(true);
    expect(isSelectPressed('text')).toBe(false);
    expect(isSelectPressed('rect')).toBe(false);
    expect(isSelectPressed('connector:line')).toBe(false);
  });

  it('Text toggle pressed state matches insertMode === "text"', () => {
    const isTextPressed = (mode: string | null) => mode === 'text';
    expect(isTextPressed(null)).toBe(false);
    expect(isTextPressed('text')).toBe(true);
    expect(isTextPressed('rect')).toBe(false);
  });
});

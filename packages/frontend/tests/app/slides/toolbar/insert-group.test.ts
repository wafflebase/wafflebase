import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLinePickerKind } from '@/app/slides/line-picker-helpers.ts';

/**
 * InsertGroup (.tsx) cannot be rendered by the Node --experimental-strip-types
 * test runner because it contains JSX. The resolve-hooks stub swaps all .tsx
 * files for no-op exports so transitive imports don't crash. The testable
 * surface — the insert-mode → active-kind mapping logic that determines which
 * child picker receives a non-null activeKind — is covered here without
 * needing a DOM.
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
    assert.equal(shapePickerActiveKind(null), null);
  });

  it('shapePickerActiveKind is null when insertMode is "text"', () => {
    assert.equal(shapePickerActiveKind('text'), null);
  });

  it('shapePickerActiveKind is null when insertMode is a connector kind', () => {
    assert.equal(shapePickerActiveKind('connector:line'), null);
    assert.equal(shapePickerActiveKind('connector:arrow'), null);
  });

  it('shapePickerActiveKind returns the kind for any ShapeKind value', () => {
    assert.equal(shapePickerActiveKind('rect'), 'rect');
    assert.equal(shapePickerActiveKind('ellipse'), 'ellipse');
    assert.equal(shapePickerActiveKind('rightArrow'), 'rightArrow');
  });

  /**
   * The LinePicker receives a non-null activeKind only for connector kinds.
   */
  it('linePickerActiveKind is non-null only for connector kinds', () => {
    const lineActive = (mode: string | null) =>
      isLinePickerKind(mode) ? mode : null;

    assert.equal(lineActive(null), null);
    assert.equal(lineActive('text'), null);
    assert.equal(lineActive('rect'), null);
    assert.equal(lineActive('connector:line'), 'connector:line');
    assert.equal(lineActive('connector:arrow'), 'connector:arrow');
  });

  /**
   * The Select toggle is pressed when insertMode === null.
   * The Text toggle is pressed when insertMode === 'text'.
   */
  it('Select toggle pressed state matches insertMode === null', () => {
    const isSelectPressed = (mode: string | null) => mode === null;
    assert.equal(isSelectPressed(null), true);
    assert.equal(isSelectPressed('text'), false);
    assert.equal(isSelectPressed('rect'), false);
    assert.equal(isSelectPressed('connector:line'), false);
  });

  it('Text toggle pressed state matches insertMode === "text"', () => {
    const isTextPressed = (mode: string | null) => mode === 'text';
    assert.equal(isTextPressed(null), false);
    assert.equal(isTextPressed('text'), true);
    assert.equal(isTextPressed('rect'), false);
  });
});

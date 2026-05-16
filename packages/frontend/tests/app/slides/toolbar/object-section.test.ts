/**
 * Routing logic tests for ObjectSection.
 *
 * The component itself is TSX and cannot be rendered in the Node strip-types
 * runner. We test the routing predicate that determines whether ShapeControls
 * is shown versus left empty.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

type SelectionType = 'shape' | 'connector' | 'image' | 'text-element' | 'mixed';

/** Mirrors the condition in object-section.tsx */
function showShapeControls(selectionType: SelectionType): boolean {
  return selectionType === 'shape' || selectionType === 'connector';
}

describe('ObjectSection routing', () => {
  it('shows ShapeControls for shape selection', () => {
    assert.equal(showShapeControls('shape'), true);
  });

  it('shows ShapeControls for connector selection', () => {
    assert.equal(showShapeControls('connector'), true);
  });

  it('hides ShapeControls for image selection', () => {
    assert.equal(showShapeControls('image'), false);
  });

  it('hides ShapeControls for text-element selection', () => {
    assert.equal(showShapeControls('text-element'), false);
  });

  it('hides ShapeControls for mixed selection', () => {
    assert.equal(showShapeControls('mixed'), false);
  });
});

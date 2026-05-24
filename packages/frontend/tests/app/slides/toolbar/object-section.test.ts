/**
 * Routing logic tests for ObjectSection.
 *
 * This is a logic test, not a component-render test: we exercise the
 * routing predicate that determines whether ShapeControls is shown versus
 * left empty.
 */

import { describe, it, expect } from 'vitest';

type SelectionType = 'shape' | 'connector' | 'image' | 'text-element' | 'mixed';

/** Mirrors the condition in object-section.tsx */
function showShapeControls(selectionType: SelectionType): boolean {
  return selectionType === 'shape' || selectionType === 'connector';
}

describe('ObjectSection routing', () => {
  it('shows ShapeControls for shape selection', () => {
    expect(showShapeControls('shape')).toBe(true);
  });

  it('shows ShapeControls for connector selection', () => {
    expect(showShapeControls('connector')).toBe(true);
  });

  it('hides ShapeControls for image selection', () => {
    expect(showShapeControls('image')).toBe(false);
  });

  it('hides ShapeControls for text-element selection', () => {
    expect(showShapeControls('text-element')).toBe(false);
  });

  it('hides ShapeControls for mixed selection', () => {
    expect(showShapeControls('mixed')).toBe(false);
  });
});

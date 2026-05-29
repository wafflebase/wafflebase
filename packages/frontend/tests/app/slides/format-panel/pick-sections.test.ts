import { describe, it, expect } from 'vitest';
import {
  pickSections,
  type PanelSelection,
} from '@/app/slides/format-panel/pick-sections';

function objSel(
  type: Exclude<
    PanelSelection extends { kind: 'object'; selectionType: infer T }
      ? T
      : never,
    never
  >,
): PanelSelection {
  return {
    kind: 'object',
    selectionType: type,
    elements: [],
    slideId: 's1',
  };
}

describe('pickSections', () => {
  it('idle → empty', () => {
    expect(pickSections({ kind: 'idle' })).toEqual([]);
  });

  it('shape → [size-position]', () => {
    expect(pickSections(objSel('shape'))).toEqual(['size-position']);
  });

  it('image → [size-position, image-adjustments, alt-text]', () => {
    expect(pickSections(objSel('image'))).toEqual([
      'size-position',
      'image-adjustments',
      'alt-text',
    ]);
  });

  it('text-element → [size-position, text-fitting]', () => {
    expect(pickSections(objSel('text-element'))).toEqual([
      'size-position',
      'text-fitting',
    ]);
  });

  it('connector → [size-position]', () => {
    expect(pickSections(objSel('connector'))).toEqual(['size-position']);
  });

  it('group → [size-position]', () => {
    expect(pickSections(objSel('group'))).toEqual(['size-position']);
  });

  it('mixed → [size-position]', () => {
    expect(pickSections(objSel('mixed'))).toEqual(['size-position']);
  });
});

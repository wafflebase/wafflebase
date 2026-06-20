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

  it('shape → [size-position, drop-shadow, reflection, alt-text]', () => {
    expect(pickSections(objSel('shape'))).toEqual([
      'size-position',
      'drop-shadow',
      'reflection',
      'alt-text',
    ]);
  });

  it('image → [size-position, image-adjustments, drop-shadow, reflection, alt-text]', () => {
    expect(pickSections(objSel('image'))).toEqual([
      'size-position',
      'image-adjustments',
      'drop-shadow',
      'reflection',
      'alt-text',
    ]);
  });

  it('text-element → [size-position, text-fitting, drop-shadow, reflection, alt-text]', () => {
    expect(pickSections(objSel('text-element'))).toEqual([
      'size-position',
      'text-fitting',
      'drop-shadow',
      'reflection',
      'alt-text',
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

  it('table → [size-position, alt-text]', () => {
    // Regression guard: before adding 'table' to ObjectSelectionType,
    // derivePanelSelection mapped single-table selections to 'mixed', and
    // pickSections('mixed') + SizePositionSection's `kind !== 'mixed'`
    // gate hid W/H/Rotation from a single-table selection.
    // Drop shadow is excluded for tables (per-cell ctx.shadow would
    // shadow every border); alt-text applies.
    expect(pickSections(objSel('table'))).toEqual([
      'size-position',
      'alt-text',
    ]);
  });
});

import type { Element } from '@wafflebase/slides';

export type SectionId =
  | 'size-position'
  | 'text-fitting'
  | 'recolor'
  | 'image-adjustments'
  | 'drop-shadow'
  | 'reflection'
  | 'alt-text';

export type ObjectSelectionType =
  | 'shape'
  | 'image'
  | 'text-element'
  | 'connector'
  | 'group'
  | 'table'
  | 'mixed';

export type PanelSelection =
  | { kind: 'idle' }
  | {
      kind: 'object';
      selectionType: ObjectSelectionType;
      elements: readonly Element[];
      slideId: string;
    };

export function pickSections(selection: PanelSelection): readonly SectionId[] {
  if (selection.kind === 'idle') return [];
  switch (selection.selectionType) {
    case 'shape':
      // Drop shadow / reflection paint a single silhouette via the
      // effects renderer; shapes qualify. Recolor lands in PR 2.
      return ['size-position', 'drop-shadow', 'reflection', 'alt-text'];
    case 'image':
      return [
        'size-position',
        'recolor',
        'image-adjustments',
        'drop-shadow',
        'reflection',
        'alt-text',
      ];
    case 'text-element':
      return [
        'size-position',
        'text-fitting',
        'drop-shadow',
        'reflection',
        'alt-text',
      ];
    case 'table':
      // Tables render as multi-draw grids — a per-cell `ctx.shadow*` would
      // shadow every border, so Drop shadow is excluded here (v1).
      return ['size-position', 'alt-text'];
    case 'connector':
    case 'group':
    case 'mixed':
      return ['size-position'];
  }
}

/** Sections that render together in one group rather than one each. */
const EFFECT_SECTIONS: ReadonlySet<SectionId> = new Set([
  'drop-shadow',
  'reflection',
]);

/**
 * Fold the flat section list into visual groups: adjacent effect toggles
 * share a group, every other section stands alone.
 */
export function groupSections(sections: readonly SectionId[]): SectionId[][] {
  const groups: SectionId[][] = [];
  for (const id of sections) {
    const last = groups[groups.length - 1];
    if (last && EFFECT_SECTIONS.has(id) && EFFECT_SECTIONS.has(last[0])) {
      last.push(id);
    } else {
      groups.push([id]);
    }
  }
  return groups;
}

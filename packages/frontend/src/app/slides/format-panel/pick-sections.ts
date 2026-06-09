import type { Element } from '@wafflebase/slides';

export type SectionId =
  | 'size-position'
  | 'text-fitting'
  | 'image-adjustments'
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

export function pickSections(
  selection: PanelSelection,
): readonly SectionId[] {
  if (selection.kind === 'idle') return [];
  switch (selection.selectionType) {
    case 'shape':
    case 'connector':
    case 'group':
    case 'table':
    case 'mixed':
      return ['size-position'];
    case 'image':
      return ['size-position', 'image-adjustments', 'alt-text'];
    case 'text-element':
      return ['size-position', 'text-fitting'];
  }
}

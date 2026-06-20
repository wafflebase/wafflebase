import type { Element } from '@wafflebase/slides';

export type SectionId =
  | 'size-position'
  | 'text-fitting'
  | 'image-adjustments'
  | 'drop-shadow'
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
      // Drop shadow paints a single silhouette via `ctx.shadow*`; shapes
      // qualify. Reflection / recolor land in later sections.
      return ['size-position', 'drop-shadow', 'alt-text'];
    case 'image':
      return ['size-position', 'image-adjustments', 'drop-shadow', 'alt-text'];
    case 'text-element':
      return ['size-position', 'text-fitting', 'drop-shadow', 'alt-text'];
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

/**
 * Maps a Tailwind color *utility* to a human-readable property label, so the
 * right pane reads "Background Color" instead of a bare `bg-primary`.
 */
const UTILITY_LABELS: Record<string, string> = {
  bg: 'Background Color',
  text: 'Text Color',
  border: 'Border Color',
  ring: 'Outline (Ring)',
  outline: 'Outline',
  fill: 'Fill Color',
  stroke: 'Stroke Color',
  decoration: 'Underline Color',
  divide: 'Divider Color',
  accent: 'Accent Color',
  shadow: 'Shadow Color',
  from: 'Gradient Start',
  via: 'Gradient Middle',
  to: 'Gradient End',
};

export function propertyLabel(utility: string): string {
  return UTILITY_LABELS[utility] ?? `${utility} color`;
}

const SPACING_LABELS: Record<string, string> = {
  p: 'Padding', px: 'Padding X', py: 'Padding Y', pt: 'Padding Top', pr: 'Padding Right', pb: 'Padding Bottom', pl: 'Padding Left',
  m: 'Margin', mx: 'Margin X', my: 'Margin Y', mt: 'Margin Top', mr: 'Margin Right', mb: 'Margin Bottom', ml: 'Margin Left',
  gap: 'Gap', 'gap-x': 'Gap X', 'gap-y': 'Gap Y', 'space-x': 'Space X', 'space-y': 'Space Y',
};

/** Human-readable label for a non-color scale binding. */
export function scaleLabel(category: string, utility: string): string {
  if (category === 'radius') return 'Border Radius';
  if (category === 'fontSize') return 'Font Size';
  return SPACING_LABELS[utility] ?? utility;
}

/**
 * Join the property labels a single role fills within a variant into one
 * de-duplicated, human-readable string, e.g. `["bg","ring"] → "Background
 * Color · Outline (Ring)"`.
 */
export function joinPropertyLabels(utilities: string[]): string {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const u of utilities) {
    const label = propertyLabel(u);
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels.join(' · ');
}

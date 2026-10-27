import type { Finding } from '@wafflebase/slides';

/**
 * Findings the seed-template lint gate (`lint.spec.ts`) accepts. Each entry
 * names the template, the 1-based slide, the rule and the element's text,
 * and says why it stands. Keep the list short: an entry is either a design
 * decision or a known defect waiting on its own fix — say which.
 */
export type LintBaselineEntry = {
  template: string;
  slide: number;
  rule: Finding['rule'];
  text: string;
  reason: string;
};

export const LINT_BASELINE: LintBaselineEntry[] = [
  {
    template: 'product-launch-plan',
    slide: 1,
    rule: 'contrast',
    text: '<product> · Launch <date>',
    reason:
      'Known defect, not intentional: the coral theme secondary text on its cream background ' +
      'measures 4.4:1, just under the 4.5:1 a 16pt subtitle needs. A theme color change, ' +
      'left for a template follow-up.',
  },
];

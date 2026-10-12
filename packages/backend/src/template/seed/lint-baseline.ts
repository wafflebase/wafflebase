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
  {
    template: 'marketing-campaign',
    slide: 1,
    rule: 'contrast',
    text: '<campaign> · <period>',
    reason:
      'Known defect, not intentional: the block cover paints the white subtitle on the pop ' +
      'theme #ff2e63 accent at 3.6:1 (16pt needs 4.5:1), the block-preset problem already ' +
      'fixed for the workshop cover. Left for a template follow-up.',
  },
];

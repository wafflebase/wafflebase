import type { TemplateBrief } from './brief';
import { briefs as slidesCore } from './slides/core.briefs';
import { briefs as slidesEducation } from './slides/education.briefs';
import { briefs as slidesMarketFinance } from './slides/market-finance.briefs';
import { briefs as slidesMore } from './slides/more.briefs';
import { briefs as slidesWork } from './slides/work.briefs';

/**
 * Authoring brief for each slides template, keyed by the template's `slug`. An
 * agent writing a deck from a template looks it up here to learn what to ask
 * the user for. Nothing at use time reads it — see `brief.ts`.
 *
 * Each `slides/<family>.ts` has its briefs beside it in
 * `slides/<family>.briefs.ts`; this file holds one import per such file, in
 * the same order `index.ts` lists the seed files.
 */
export const TEMPLATE_BRIEFS: TemplateBrief[] = [
  ...slidesCore,
  ...slidesMore,
  ...slidesEducation,
  ...slidesWork,
  ...slidesMarketFinance,
];

/** Look up a template's input schema by slug. */
export function getTemplateBrief(slug: string): TemplateBrief | undefined {
  return TEMPLATE_BRIEFS.find((b) => b.slug === slug);
}

import type { TemplateBrief } from './brief';
import { projectKickoffBrief, weeklyBusinessReviewBrief } from './briefs-core';
import {
  okrReviewBrief,
  productLaunchPlanBrief,
  productRoadmapBrief,
  sprintRetrospectiveBrief,
  techTalkBrief,
} from './briefs-more';
import {
  seminarDeckBrief,
  studentPresentationBrief,
  universityLectureBrief,
  workshopTrainingBrief,
} from './briefs-education';
import {
  allHandsUpdateBrief,
  caseStudyBrief,
  devDesignReviewBrief,
  projectProposalBrief,
} from './briefs-work';
import {
  brandPitchBrief,
  designReviewUxBrief,
  equityAnalysisBrief,
  marketingCampaignBrief,
} from './briefs-market-finance';

/**
 * Authoring brief for each slides template, keyed by the template's `slug`. An
 * agent writing a deck from a template looks it up here to learn what to ask
 * the user for. Nothing at use time reads it — see `brief.ts`.
 */
export const TEMPLATE_BRIEFS: TemplateBrief[] = [
  weeklyBusinessReviewBrief,
  projectKickoffBrief,
  sprintRetrospectiveBrief,
  okrReviewBrief,
  productLaunchPlanBrief,
  techTalkBrief,
  productRoadmapBrief,
  seminarDeckBrief,
  universityLectureBrief,
  studentPresentationBrief,
  workshopTrainingBrief,
  devDesignReviewBrief,
  projectProposalBrief,
  allHandsUpdateBrief,
  caseStudyBrief,
  marketingCampaignBrief,
  brandPitchBrief,
  equityAnalysisBrief,
  designReviewUxBrief,
];

/** Look up a template's input schema by slug. */
export function getTemplateBrief(slug: string): TemplateBrief | undefined {
  return TEMPLATE_BRIEFS.find((b) => b.slug === slug);
}

import type { TemplateBrief } from './brief';
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
 * Input schema for every fillable slide template, keyed by the same `slug` as
 * the blank `TemplateSeed`. A fill agent looks a template up here to learn the
 * exact values to collect before it fills the template's placeholders.
 */
export const TEMPLATE_BRIEFS: TemplateBrief[] = [
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

import type { TemplateSeed } from '../types';
import {
  meetingNotes,
  partnerNewsletter,
  productRequirementsDoc,
  vendorOnboarding,
} from './docs';
import {
  retrospectiveBoard,
  siteVisitNotes,
  weeklyOneOnOne,
} from './note-and-board';
import {
  brainstormAffinityMap,
  pricingWorkshop,
  retroStartStopContinue,
  weeklyTeamSync,
} from './boards';
import {
  contentCalendar,
  invoice,
  monthlyBudgetTracker,
  regionalSalesReport,
  sharedExpenseSplitter,
  sprintTaskTracker,
  teamDirectory,
} from './sheets';
import { projectKickoff, weeklyBusinessReview } from './slides';
import {
  okrReview,
  productLaunchPlan,
  productRoadmap,
  sprintRetrospective,
  techTalk,
} from './slides-more';
import {
  seminarDeck,
  studentPresentation,
  universityLecture,
  workshopTraining,
} from './slides-education';
import {
  allHandsUpdate,
  caseStudy,
  customerOnboardingReview,
  devDesignReview,
  projectProposal,
} from './slides-work';
import {
  brandPitch,
  designReviewUx,
  equityAnalysis,
  marketingCampaign,
} from './slides-market-finance';

/**
 * Everything `pnpm backend seed:templates` publishes.
 *
 * Licensing: see `README.md` in this directory. Every entry is original to
 * this repository; nothing derived from a third-party template gallery may be
 * added.
 */
export const TEMPLATE_CATALOG: TemplateSeed[] = [
  weeklyBusinessReview,
  projectKickoff,
  sprintRetrospective,
  okrReview,
  productLaunchPlan,
  techTalk,
  productRoadmap,
  seminarDeck,
  universityLecture,
  studentPresentation,
  workshopTraining,
  devDesignReview,
  projectProposal,
  allHandsUpdate,
  caseStudy,
  customerOnboardingReview,
  marketingCampaign,
  brandPitch,
  equityAnalysis,
  designReviewUx,
  monthlyBudgetTracker,
  sprintTaskTracker,
  contentCalendar,
  invoice,
  regionalSalesReport,
  teamDirectory,
  sharedExpenseSplitter,
  productRequirementsDoc,
  meetingNotes,
  partnerNewsletter,
  vendorOnboarding,
  weeklyOneOnOne,
  siteVisitNotes,
  retrospectiveBoard,
  retroStartStopContinue,
  brainstormAffinityMap,
  weeklyTeamSync,
  pricingWorkshop,
];

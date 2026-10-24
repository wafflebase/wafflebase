import type { TemplateSeed } from '../types';
import { meetingNotes, productRequirementsDoc } from './docs';
import { retrospectiveBoard, weeklyOneOnOne } from './note-and-board';
import {
  contentCalendar,
  invoice,
  monthlyBudgetTracker,
  sprintTaskTracker,
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
  marketingCampaign,
  brandPitch,
  equityAnalysis,
  designReviewUx,
  monthlyBudgetTracker,
  sprintTaskTracker,
  contentCalendar,
  invoice,
  productRequirementsDoc,
  meetingNotes,
  weeklyOneOnOne,
  retrospectiveBoard,
];

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
  monthlyBudgetTracker,
  sprintTaskTracker,
  contentCalendar,
  invoice,
  productRequirementsDoc,
  meetingNotes,
  weeklyOneOnOne,
  retrospectiveBoard,
];

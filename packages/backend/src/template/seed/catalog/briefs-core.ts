import type { TemplateBrief } from './brief';

/**
 * Authoring briefs for the original two slides templates in `slides.ts`:
 * what an author should collect from a user before writing a deck from the
 * template with the same `slug`. Guidance only — see `brief.ts`.
 */

export const weeklyBusinessReviewBrief: TemplateBrief = {
  slug: 'weekly-business-review',
  summary: 'A weekly review: headline numbers, what moved, risks, decisions, owners.',
  fields: [
    { key: 'week', label: 'Week of', type: 'text', example: 'Oct 20' },
    { key: 'team', label: 'Team', type: 'text', example: 'Growth' },
    { key: 'headlineNumbers', label: 'Headline numbers (metric → this week vs last)', type: 'pairs', pair: ['Metric', 'This week vs last'], min: 2, max: 4, example: 'Revenue → $412k (+6%)' },
    { key: 'whatMoved', label: 'What moved', type: 'list', min: 2, max: 3 },
    { key: 'risks', label: 'Risks and blockers', type: 'list', min: 1, max: 3, example: 'Billing migration slips — Jae — vendor sign-off' },
    { key: 'decisions', label: 'Decisions needed today', type: 'list', min: 1, max: 2 },
    { key: 'nextSteps', label: 'Owners and next steps', type: 'list', min: 1, max: 3, example: 'Ship pricing page — Mina — Fri' },
  ],
};

export const projectKickoffBrief: TemplateBrief = {
  slug: 'project-kickoff',
  summary: 'A kickoff: problem, success, scope, owners, plan, risks.',
  fields: [
    { key: 'project', label: 'Project name', type: 'text', example: 'Search v2' },
    { key: 'startDate', label: 'Start date', type: 'text', example: 'Nov 3' },
    { key: 'problem', label: 'The problem', type: 'list', min: 2, max: 3 },
    { key: 'success', label: 'What success looks like', type: 'list', min: 2, max: 3 },
    { key: 'scope', label: 'Scope', type: 'pairs', pair: ['In scope', 'Out of scope'], min: 1, max: 3 },
    { key: 'owners', label: 'Team and owners', type: 'list', min: 2, max: 4, example: 'DRI — Mina' },
    { key: 'plan', label: 'Plan', type: 'list', min: 2, max: 3, example: 'Milestone 1 — Nov 21 — indexing service' },
    { key: 'risks', label: 'Risks', type: 'list', min: 1, max: 3 },
  ],
};

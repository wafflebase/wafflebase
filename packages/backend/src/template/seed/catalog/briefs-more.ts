import type { TemplateBrief } from './brief';

/**
 * Input schemas (required values) for the slides-more templates. Each brief's
 * `slug` matches the blank template's slug in `slides-more.ts`; a fill agent
 * collects these values and drops them into the template's placeholder slots.
 */

export const sprintRetrospectiveBrief: TemplateBrief = {
  slug: 'sprint-retrospective',
  summary: 'A sprint retro: what went well, what to improve, actions, one change.',
  fields: [
    { key: 'team', label: 'Team', type: 'text', example: 'Platform Team' },
    { key: 'sprint', label: 'Sprint number', type: 'text', example: '24' },
    { key: 'date', label: 'Date', type: 'text', example: 'Sep 22' },
    { key: 'wentWell', label: 'What went well', type: 'list', min: 2, max: 4, example: 'Shipped the new auth flow a day early' },
    { key: 'toImprove', label: 'What to improve', type: 'list', min: 2, max: 4, example: 'Standups ran long — trim to 10 minutes' },
    { key: 'actions', label: 'Action items', type: 'pairs', pair: ['Action', 'Owner'], min: 2, max: 4, example: 'Split the dashboard epic → Mina' },
    { key: 'keyChange', label: 'One change next sprint', type: 'line', example: 'Timebox standups to 10 minutes' },
  ],
};

export const okrReviewBrief: TemplateBrief = {
  slug: 'okr-review',
  summary: 'A quarterly OKR review: objectives, key-result status, learnings, next focus.',
  fields: [
    { key: 'team', label: 'Team', type: 'text', example: 'Growth' },
    { key: 'quarter', label: 'Quarter', type: 'text', example: 'Q3 2026' },
    { key: 'objectives', label: 'Objectives this quarter', type: 'list', min: 2, max: 4 },
    { key: 'keyResults', label: 'Key results (result → target vs actual)', type: 'pairs', pair: ['Key result', 'Target vs actual'], min: 2, max: 5 },
    { key: 'attainment', label: 'Average attainment', type: 'metric', example: '72% · average key-result attainment' },
    { key: 'learnings', label: 'What we learned', type: 'list', min: 2, max: 4 },
    { key: 'nextFocus', label: 'Focus for next quarter', type: 'line' },
  ],
};

export const productLaunchPlanBrief: TemplateBrief = {
  slug: 'product-launch-plan',
  summary: 'A launch plan: pitch, goal, channels, timeline, go/no-go.',
  fields: [
    { key: 'product', label: 'Product', type: 'text', example: 'Inbox 2.0' },
    { key: 'launchDate', label: 'Launch date', type: 'text', example: 'Oct 14' },
    { key: 'pitch', label: 'One-line pitch', type: 'line' },
    { key: 'audience', label: 'Who it is for', type: 'line' },
    { key: 'whyNow', label: 'Why it matters now', type: 'line' },
    { key: 'successCriteria', label: 'What success looks like', type: 'list', min: 2, max: 3 },
    { key: 'channels', label: 'Channels and messaging', type: 'pairs', pair: ['Channel', 'Message'], min: 2, max: 4 },
    { key: 'timeline', label: 'Timeline', type: 'list', min: 3, max: 4, example: 'T-14 — creative ready' },
    { key: 'goNoGo', label: 'Go / no-go criteria', type: 'line' },
  ],
};

export const techTalkBrief: TemplateBrief = {
  slug: 'tech-talk-paper-study',
  summary: 'A paper/tech talk: problem, key idea, trade-offs, takeaways.',
  fields: [
    { key: 'title', label: 'Talk or paper title', type: 'text' },
    { key: 'speaker', label: 'Speaker', type: 'text' },
    { key: 'date', label: 'Date', type: 'text' },
    { key: 'problem', label: 'The problem', type: 'list', min: 2, max: 3 },
    { key: 'keyIdea', label: 'How it works', type: 'list', min: 2, max: 3 },
    { key: 'strengths', label: 'Strengths', type: 'list', min: 2, max: 3 },
    { key: 'limitations', label: 'Limitations', type: 'list', min: 2, max: 3 },
    { key: 'takeaways', label: 'Takeaways', type: 'list', min: 2, max: 3 },
  ],
};

export const productRoadmapBrief: TemplateBrief = {
  slug: 'product-roadmap',
  summary: 'A now/next/later roadmap plus what the team is not doing.',
  fields: [
    { key: 'product', label: 'Product', type: 'text' },
    { key: 'period', label: 'Period', type: 'text', example: 'H2 2026' },
    { key: 'whereWeAre', label: 'Where we are', type: 'list', min: 2, max: 3 },
    { key: 'now', label: 'Now — in flight this quarter', type: 'line' },
    { key: 'next', label: 'Next — what comes after', type: 'line' },
    { key: 'later', label: 'Later — not committed yet', type: 'line' },
    { key: 'notDoing', label: 'What we are deliberately not doing', type: 'line' },
  ],
};

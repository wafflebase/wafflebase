import type { TemplateBrief } from './brief';

/**
 * Input schemas (required values) for the slides-work templates. Each brief's
 * `slug` matches the blank template's slug in `slides-work.ts`; a fill agent
 * collects these values and drops them into the template's placeholder slots.
 */

export const devDesignReviewBrief: TemplateBrief = {
  slug: 'dev-design-review',
  summary: 'An engineering design review: problem, goals, proposed design, alternatives, and the decision needed.',
  fields: [
    { key: 'system', label: 'System or feature', type: 'text', example: 'Search indexing pipeline' },
    { key: 'author', label: 'Author', type: 'text', example: 'Jin Park' },
    { key: 'date', label: 'Date', type: 'text', example: 'Sep 22' },
    { key: 'problem', label: 'Problem and background', type: 'list', min: 2, max: 3, example: 'Reindexing takes 40 minutes and blocks deploys' },
    { key: 'goalsNonGoals', label: 'Goals vs non-goals', type: 'pairs', pair: ['Goal', 'Non-goal'], min: 2, max: 3, example: 'Sub-minute reindex → Reworking the query layer' },
    { key: 'proposedDesign', label: 'Proposed design', type: 'list', min: 3, max: 4, example: 'Stream document changes into an incremental indexer' },
    { key: 'alternatives', label: 'Alternatives considered', type: 'pairs', pair: ['Option', 'Why not chosen'], min: 2, max: 3, example: 'Nightly full rebuild → Too stale for live search' },
    { key: 'risks', label: 'Risks and rollout', type: 'list', min: 2, max: 3, example: 'Index drift — reconcile job nightly, roll back via flag' },
    { key: 'decision', label: 'The decision we need today', type: 'line', example: 'Approve the incremental indexer approach for Q4' },
  ],
};

export const projectProposalBrief: TemplateBrief = {
  slug: 'project-proposal',
  summary: 'A case for starting a project: problem, solution, scope, plan, cost, and the ask.',
  fields: [
    { key: 'project', label: 'Project name', type: 'text', example: 'Unified onboarding' },
    { key: 'author', label: 'Author', type: 'text', example: 'Mina Seo' },
    { key: 'date', label: 'Date', type: 'text', example: 'Sep 22' },
    { key: 'problem', label: 'The problem', type: 'list', min: 2, max: 3, example: 'New users drop off before their first success' },
    { key: 'solution', label: 'Proposed solution', type: 'list', min: 2, max: 3, example: 'A guided first-run flow with a single clear next step' },
    { key: 'scope', label: 'Scope', type: 'pairs', pair: ['In scope', 'Out of scope'], min: 2, max: 3, example: 'Web signup flow → Mobile app onboarding' },
    { key: 'milestones', label: 'Plan and milestones', type: 'list', min: 3, max: 3, example: 'Milestone 1 — Oct 14 — flow prototype ships' },
    { key: 'cost', label: 'Cost and resources', type: 'list', min: 2, max: 3, example: 'Two engineers and a designer for six weeks' },
    { key: 'ask', label: 'What we are asking for', type: 'line', example: 'Approval to staff the project starting next sprint' },
  ],
};

export const allHandsUpdateBrief: TemplateBrief = {
  slug: 'all-hands-update',
  summary: 'A short all-hands update: where we are, highlights, the headline metric, and what comes next.',
  fields: [
    { key: 'teamOrCompany', label: 'Team or company', type: 'text', example: 'Product Team' },
    { key: 'date', label: 'Date', type: 'text', example: 'Sep 22' },
    { key: 'whereWeAre', label: 'Where we are', type: 'list', min: 2, max: 3, example: 'We shipped the redesign to every customer this period' },
    { key: 'highlights', label: 'Highlights', type: 'list', min: 2, max: 3, example: 'Closed the biggest enterprise deal of the year' },
    { key: 'headlineMetric', label: 'The headline metric this period', type: 'metric', example: '1.2M · monthly active users' },
    { key: 'whatComesNext', label: 'What comes next', type: 'list', min: 2, max: 3, example: 'Ship self-serve billing by end of quarter' },
  ],
};

export const caseStudyBrief: TemplateBrief = {
  slug: 'case-study',
  summary: 'A before-and-after customer story: the challenge, the approach, the results, and the lessons.',
  fields: [
    { key: 'customer', label: 'Customer', type: 'text', example: 'Northwind Retail' },
    { key: 'date', label: 'Date', type: 'text', example: 'Sep 22' },
    { key: 'challenge', label: 'Customer and challenge', type: 'list', min: 2, max: 3, example: 'Checkout abandonment was cutting revenue every weekend' },
    { key: 'approach', label: 'Approach', type: 'list', min: 2, max: 3, example: 'Rebuilt the checkout as a single guided step' },
    { key: 'headlineResult', label: 'The headline result', type: 'metric', example: '38% · faster checkout after launch' },
    { key: 'beforeAfter', label: 'Before and after', type: 'pairs', pair: ['Before', 'After'], min: 2, max: 3, example: 'Five-step checkout → One-step checkout' },
    { key: 'lessons', label: 'Lessons learned', type: 'list', min: 2, max: 3, example: 'Removing steps beat adding reassurance copy' },
  ],
};

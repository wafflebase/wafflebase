import type { TemplateBrief } from './brief';

/**
 * Input schemas (required values) for the market/finance/design templates. Each
 * brief's `slug` matches the blank template's slug in `slides-market-finance.ts`;
 * a fill agent collects these values and drops them into the template's
 * placeholder slots.
 */

export const marketingCampaignBrief: TemplateBrief = {
  slug: 'marketing-campaign',
  summary:
    'A campaign plan: audience, the big idea, channels and message, timeline, the KPI, and budget.',
  fields: [
    { key: 'campaign', label: 'Campaign name', type: 'text', example: 'Spring Signups' },
    { key: 'period', label: 'Period', type: 'text', example: 'Apr–Jun 2026' },
    { key: 'audience', label: 'Who we are talking to', type: 'list', min: 2, max: 3, example: 'First-year students who commute to campus' },
    { key: 'bigIdea', label: 'The one big idea', type: 'line', example: 'Make joining feel like it takes one tap, not one form' },
    { key: 'channels', label: 'Channels and message', type: 'pairs', pair: ['Channel', 'Message'], min: 2, max: 3, example: 'Instagram → short clips of members at work' },
    { key: 'timeline', label: 'Timeline', type: 'list', min: 3, max: 4, example: 'Pre-launch — creative and landing page ready' },
    { key: 'kpi', label: 'The result this campaign is measured on', type: 'metric', example: '18% · lift in signups over last term' },
    { key: 'budget', label: 'Budget', type: 'list', min: 2, max: 3, example: 'Half to paid social, rest to print and events' },
  ],
};

export const brandPitchBrief: TemplateBrief = {
  slug: 'brand-pitch',
  summary:
    'A short brand pitch: who we are, the opportunity, how we position, the number behind it, and the ask.',
  fields: [
    { key: 'brand', label: 'Brand', type: 'text', example: 'Northwind' },
    { key: 'date', label: 'Date', type: 'text', example: 'Sep 22' },
    { key: 'whoWeAre', label: 'Who we are', type: 'list', min: 2, max: 3, example: 'We make tools that help small teams ship faster' },
    { key: 'opportunity', label: 'The opportunity', type: 'list', min: 2, max: 3, example: 'The shift toward remote-first teams is still underserved' },
    { key: 'positioning', label: 'How we position', type: 'line', example: 'The space we own that others do not, in one line the customer remembers' },
    { key: 'proofNumber', label: 'The number that proves the opportunity is real', type: 'metric', example: '40% · of target teams have no tool for this today' },
    { key: 'ask', label: 'What we are asking for', type: 'line', example: 'A 6-month pilot with three flagship teams' },
  ],
};

export const equityAnalysisBrief: TemplateBrief = {
  slug: 'equity-analysis',
  summary:
    'A read on a stock: company snapshot, investment thesis, valuation, the key multiple, risks, and a recommendation.',
  fields: [
    { key: 'ticker', label: 'Ticker', type: 'text', example: 'ACME' },
    { key: 'date', label: 'Date', type: 'text', example: 'Sep 22' },
    { key: 'snapshot', label: 'Company snapshot', type: 'list', min: 2, max: 3, example: 'Builds payments infrastructure for online marketplaces' },
    { key: 'thesis', label: 'Investment thesis', type: 'list', min: 2, max: 3, example: 'The market is mispricing its recurring revenue' },
    { key: 'valuation', label: 'Valuation', type: 'pairs', pair: ['Metric', 'Value'], min: 2, max: 3, example: 'Forward P/E → 14x' },
    { key: 'keyMultiple', label: 'The multiple the case rests on', type: 'metric', example: '12x · forward earnings vs 18x for peers' },
    { key: 'risks', label: 'Risks', type: 'list', min: 2, max: 3, example: 'A larger competitor cutting fees to zero' },
    { key: 'recommendation', label: 'Our recommendation', type: 'line', example: 'Buy, with a 12-month target of $180' },
  ],
};

export const designReviewUxBrief: TemplateBrief = {
  slug: 'design-review-ux',
  summary:
    'A design/UX review: the problem, users and context, before and after, open questions, and the feedback needed.',
  fields: [
    { key: 'feature', label: 'Feature or change', type: 'text', example: 'Checkout redesign' },
    { key: 'date', label: 'Date', type: 'text', example: 'Sep 22' },
    { key: 'problem', label: 'The problem', type: 'list', min: 2, max: 3, example: 'Users drop off at the address step' },
    { key: 'usersAndContext', label: 'Users and context', type: 'list', min: 2, max: 3, example: 'Returning buyers on mobile, in a hurry' },
    { key: 'beforeAfter', label: 'Before and after', type: 'pairs', pair: ['Before', 'After'], min: 2, max: 3, example: 'Four form screens → one scrollable page' },
    { key: 'openQuestions', label: 'Open questions', type: 'list', min: 2, max: 3, example: 'Do we keep guest checkout as the default?' },
    { key: 'feedbackNeeded', label: 'The feedback we need', type: 'line', example: 'Is the single-page flow worth the extra build time?' },
  ],
};

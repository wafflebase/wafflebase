import { themedDeck } from '../builders';
import type { TemplateSeed } from '../types';

/**
 * Marketing, finance, and design slide templates for the gallery, authored
 * natively against the built-in layouts (docs/design/template-gallery.md).
 * Each picks a distinct built-in theme so the gallery reads as a set of
 * different looks rather than one design with different words. Every deck here
 * is original to this repository — see `README.md` for the licensing rule.
 */

export const marketingCampaign: TemplateSeed = {
  slug: 'marketing-campaign',
  title: 'Marketing Campaign',
  description:
    'A one-pass plan for a campaign: who it is for, the big idea, the channels and message, the timeline, the KPI that matters, and the budget.',
  category: 'Marketing',
  tags: ['deck', 'marketing', 'campaign'],
  content: {
    kind: 'slides',
    document: themedDeck('pop', 'Marketing Campaign', [
      ['title-slide', [['Marketing Campaign'], ['<campaign> · <period>']], 'block'],
      [
        'title-body',
        [
          ['Who we are talking to'],
          [
            'Who the audience is, in one line',
            'What they want that we can offer',
            'Where they already spend attention',
          ],
        ],
        'sidebar',
      ],
      ['main-point', [['The one big idea']], 'plain'],
      [
        'title-two-columns',
        [
          ['Channels and message'],
          ['Channel', '—', '—', '—'],
          ['Message', '—', '—', '—'],
        ],
        'plain',
      ],
      [
        'title-body',
        [
          ['Timeline'],
          [
            'Pre-launch — what has to be ready',
            'Launch — what goes live, and where',
            'Sustain — how we keep it running',
            'Wrap — when we review results',
          ],
        ],
        'plain',
      ],
      ['big-number', [['<xx>%'], ['The one result this campaign is measured on']], 'geo'],
      [
        'title-body',
        [
          ['Budget'],
          [
            'What the money is spent on',
            'How it splits across channels',
            'What we hold back as reserve',
          ],
        ],
        'plain',
      ],
    ]),
  },
};

export const brandPitch: TemplateSeed = {
  slug: 'brand-pitch',
  title: 'Brand Pitch',
  description:
    'A short pitch for a brand: who we are, the opportunity in front of us, how we position against it, the numbers behind it, and the ask.',
  category: 'Marketing',
  tags: ['deck', 'brand', 'pitch'],
  content: {
    kind: 'slides',
    document: themedDeck('plum', 'Brand Pitch', [
      ['title-slide', [['Brand Pitch'], ['<brand> · <date>']], 'split'],
      [
        'title-body',
        [
          ['Who we are'],
          [
            'What we make, in one line',
            'What we stand for',
            'Why we are the ones to do it',
          ],
        ],
        'sidebar',
      ],
      [
        'title-body',
        [
          ['The opportunity'],
          [
            'The shift happening in the market',
            'Who is underserved today',
            'Why the timing is right now',
          ],
        ],
        'plain',
      ],
      [
        'section-title-description',
        [
          ['How we position'],
          [
            'The space we own that others do not — and the one thing a customer should remember.',
          ],
        ],
        'band',
      ],
      ['big-number', [['<xx>%'], ['The number that proves the opportunity is real']], 'geo'],
      ['main-point', [['What we are asking for']], 'plain'],
    ]),
  },
};

export const equityAnalysis: TemplateSeed = {
  slug: 'equity-analysis',
  title: 'Equity Analysis',
  description:
    'A structured read on a stock: the company snapshot, the investment thesis, valuation, the key metric, the risks, and a recommendation.',
  category: 'Finance',
  tags: ['deck', 'finance', 'equity', 'stocks'],
  content: {
    kind: 'slides',
    document: themedDeck('marina', 'Equity Analysis', [
      ['title-slide', [['Equity Analysis'], ['<ticker> · <date>']], 'sidebar'],
      [
        'title-body',
        [
          ['Company snapshot'],
          [
            'What the business does',
            'How it makes money',
            'Where it sits in its market',
          ],
        ],
        'plain',
      ],
      [
        'title-body',
        [
          ['Investment thesis'],
          [
            'Why the market is mispricing it',
            'What has to go right',
            'What the payoff looks like if it does',
          ],
        ],
        'plain',
      ],
      [
        'title-two-columns',
        [
          ['Valuation'],
          ['Metric', '—', '—', '—'],
          ['Value', '—', '—', '—'],
        ],
        'plain',
      ],
      ['big-number', [['<xx>x'], ['The one multiple the case rests on']], 'geo'],
      [
        'title-body',
        [
          ['Risks'],
          [
            'What could break the thesis',
            'What we are watching for',
            'What we would do if it turns',
          ],
        ],
        'plain',
      ],
      ['main-point', [['Our recommendation']], 'plain'],
    ]),
  },
};

export const designReviewUx: TemplateSeed = {
  slug: 'design-review-ux',
  title: 'Design Review (Product/UX)',
  description:
    'A frame for reviewing a product or UX change: the problem, the users and context, the proposal, before and after, open questions, and the feedback needed.',
  category: 'Design',
  tags: ['deck', 'design', 'ux', 'review'],
  content: {
    kind: 'slides',
    document: themedDeck('spotlight', 'Design Review (Product/UX)', [
      ['title-slide', [['Design Review (Product/UX)'], ['<feature> · <date>']], 'geo'],
      [
        'title-body',
        [
          ['The problem'],
          [
            'What is not working today',
            'Who it hurts, and how often',
            'Why it is worth fixing now',
          ],
        ],
        'sidebar',
      ],
      [
        'title-body',
        [
          ['Users and context'],
          [
            'Who runs into this',
            'What they are trying to do',
            'Where and when it happens',
          ],
        ],
        'plain',
      ],
      ['section-header', [['The proposal']], 'band'],
      [
        'title-two-columns',
        [
          ['Before and after'],
          ['Before', '—', '—', '—'],
          ['After', '—', '—', '—'],
        ],
        'plain',
      ],
      [
        'title-body',
        [
          ['Open questions'],
          [
            'What we have not decided yet',
            'What we are unsure about',
            'What we need to test',
          ],
        ],
        'plain',
      ],
      ['main-point', [['The feedback we need']], 'plain'],
    ]),
  },
};

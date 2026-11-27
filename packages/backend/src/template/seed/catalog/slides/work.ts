import { themedDeck } from '../../builders';
import type { TemplateSeed } from '../../types';

/**
 * Work-oriented slide templates for the gallery, authored natively against the
 * built-in layouts (docs/design/template-gallery.md). Each picks a distinct
 * built-in theme so the gallery reads as a set of different looks rather than
 * one design with different words. Every deck here is original to this
 * repository — see `README.md` for the licensing rule.
 */

const devDesignReview: TemplateSeed = {
  slug: 'dev-design-review',
  title: 'Design Review (Engineering)',
  description:
    'A structure for reviewing an engineering design: the problem, the goals, the proposed approach, the alternatives considered, and the decision that is actually needed.',
  category: 'design/design-review',
  tags: ['deck', 'engineering', 'design-doc'],
  content: {
    kind: 'slides',
    document: themedDeck('geometric', 'Design Review (Engineering)', [
      ['title-slide', [['Design Review (Engineering)'], ['<system or feature> · <author> · <date>']], 'header'],
      [
        'title-body',
        [
          ['Problem and background'],
          [
            'What is broken or missing today',
            'Who is affected, and how much',
            'Why we are looking at this now',
          ],
        ],
        'plain',
      ],
      [
        'title-two-columns',
        [
          ['Goals vs non-goals'],
          ['Goals', '—', '—', '—'],
          ['Non-goals', '—', '—', '—'],
        ],
        'plain',
      ],
      [
        'title-body',
        [
          ['Proposed design'],
          [
            'The core approach in one line',
            'Key components and how they fit',
            'Data flow and interfaces',
            'What changes for callers',
          ],
        ],
        'sidebar',
      ],
      [
        'title-two-columns',
        [
          ['Alternatives considered'],
          ['Option', '—', '—', '—'],
          ['Why not chosen', '—', '—', '—'],
        ],
        'plain',
      ],
      [
        'title-body',
        [
          ['Risks and rollout'],
          [
            'Biggest risk — mitigation',
            'How we ship it safely (flags, stages)',
            'How we roll back if it goes wrong',
          ],
        ],
        'plain',
      ],
      ['main-point', [['The decision we need today']], 'plain'],
    ]),
  },
};

const projectProposal: TemplateSeed = {
  slug: 'project-proposal',
  title: 'Project Proposal',
  description:
    'A concise case for starting a project: the problem, the proposed solution, what is in and out of scope, the plan, the cost, and the ask.',
  category: 'work/pitch-proposal',
  tags: ['deck', 'proposal', 'planning'],
  content: {
    kind: 'slides',
    document: themedDeck('swiss', 'Project Proposal', [
      ['title-slide', [['Project Proposal'], ['<project name> · <author> · <date>']], 'block'],
      [
        'title-body',
        [
          ['The problem'],
          [
            'What is going wrong today',
            'What it costs us to leave it',
            'Why now',
          ],
        ],
        'plain',
      ],
      [
        'title-body',
        [
          ['Proposed solution'],
          [
            'The approach in one line',
            'How it addresses the problem',
            'What success looks like',
          ],
        ],
        'sidebar',
      ],
      [
        'title-two-columns',
        [
          ['Scope'],
          ['In scope', '—', '—', '—'],
          ['Out of scope', '—', '—', '—'],
        ],
        'plain',
      ],
      [
        'title-body',
        [
          ['Plan and milestones'],
          [
            'Milestone 1 — date — what ships',
            'Milestone 2 — date — what ships',
            'Milestone 3 — date — what ships',
          ],
        ],
        'plain',
      ],
      [
        'title-body',
        [
          ['Cost and resources'],
          [
            'People needed — roles and time',
            'Budget or tooling required',
            'Dependencies on other teams',
          ],
        ],
        'plain',
      ],
      ['main-point', [['What we are asking for']], 'plain'],
    ]),
  },
};

const allHandsUpdate: TemplateSeed = {
  slug: 'all-hands-update',
  title: 'All-Hands Update',
  description:
    'A short company or team update for an all-hands: where we are, the highlights, the headline metric, what comes next, and a thank-you.',
  category: 'work/report-review',
  tags: ['deck', 'allhands', 'update'],
  content: {
    kind: 'slides',
    document: themedDeck('streamline', 'All-Hands Update', [
      ['title-slide', [['All-Hands Update'], ['<team or company> · <date>']], 'gradient'],
      [
        'title-body',
        [
          ['Where we are'],
          [
            'The one thing to remember from today',
            'How the last period went overall',
            'What has changed since we last met',
          ],
        ],
        'sidebar',
      ],
      [
        'title-body',
        [
          ['Highlights'],
          [
            'A win worth celebrating',
            'A win worth celebrating',
            'Progress on a long-running effort',
          ],
        ],
        'plain',
      ],
      ['big-number', [['<value>'], ['The headline metric this period']], 'geo'],
      [
        'title-body',
        [
          ['What comes next'],
          [
            'The priority for the next period',
            'What we need from the team',
            'Dates and moments to watch',
          ],
        ],
        'plain',
      ],
      ['main-point', [['Thank you']], 'plain'],
    ]),
  },
};

const caseStudy: TemplateSeed = {
  slug: 'case-study',
  title: 'Case Study',
  description:
    'A before-and-after story of a customer engagement: the challenge, the approach, the results, and the lessons worth reusing.',
  category: 'marketing/brand-press',
  tags: ['deck', 'case-study'],
  content: {
    kind: 'slides',
    document: themedDeck('shift', 'Case Study', [
      ['title-slide', [['Case Study'], ['<customer> · <date>']], 'header'],
      [
        'title-body',
        [
          ['Customer and challenge'],
          [
            'Who the customer is',
            'The problem they came to us with',
            'Why it mattered to their business',
          ],
        ],
        'sidebar',
      ],
      [
        'title-body',
        [
          ['Approach'],
          [
            'What we set out to do',
            'The key decisions we made',
            'How we worked together',
          ],
        ],
        'plain',
      ],
      ['big-number', [['<value>'], ['The headline result']], 'geo'],
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
          ['Lessons learned'],
          [
            'What worked and why',
            'What we would do differently',
            'What carries into the next engagement',
          ],
        ],
        'plain',
      ],
    ]),
  },
};

const customerOnboardingReview: TemplateSeed = {
  slug: 'customer-onboarding-review',
  title: 'Customer Onboarding Review',
  description:
    'A review of how new customers get started, built from interviews and funnel data: what we heard, where onboarding stalls, and what we will change first.',
  category: 'work/report-review',
  tags: ['deck', 'customer-research', 'onboarding'],
  content: {
    kind: 'slides',
    document: themedDeck('tropic', 'Customer Onboarding Review', [
      ['title-slide', [['Customer Onboarding Review'], ['<product> · <number> customer conversations · <period>']], 'dots'],
      [
        'title-body',
        [
          ['What we set out to learn'],
          [
            'The question this review answers',
            'Who we talked to — segment, size, how recently they joined',
            'What we drew on — interviews, surveys, funnel data',
          ],
        ],
        'plain',
      ],
      ['big-number', [['<value>'], ['Share of new customers who reach their first success in week one']], 'geo'],
      [
        'title-body',
        [
          ['What we heard'],
          [
            'Theme — what customers said, in their own words',
            'Theme — what customers said, in their own words',
            'Theme — what customers said, in their own words',
            'Theme — what customers said, in their own words',
          ],
        ],
        'sidebar',
      ],
      [
        'title-two-columns',
        [
          ['Where onboarding works and where it stalls'],
          ['Working', '—', '—', '—'],
          ['Stalling', '—', '—', '—'],
        ],
        'plain',
      ],
      [
        'title-body',
        [
          ['What we will change'],
          [
            'Change — owner — target date',
            'Change — owner — target date',
            'Change — owner — target date',
          ],
        ],
        'plain',
      ],
      [
        'title-body',
        [
          ['How we will know it worked'],
          [
            'The metric we expect to move, and by how much',
            'When we will check it',
            'What would make us change course',
          ],
        ],
        'plain',
      ],
      ['main-point', [['The one change to make first']], 'plain'],
    ]),
  },
};

/** This file's templates, in gallery order — `../index.ts` concatenates them. */
export const seeds: TemplateSeed[] = [
  devDesignReview,
  projectProposal,
  allHandsUpdate,
  caseStudy,
  customerOnboardingReview,
];

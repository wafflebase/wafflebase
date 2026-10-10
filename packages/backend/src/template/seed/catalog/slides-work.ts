import { themedDeck } from '../builders';
import type { TemplateSeed } from '../types';

/**
 * Work-oriented slide templates for the gallery, authored natively against the
 * built-in layouts (docs/design/template-gallery.md). Each picks a distinct
 * built-in theme so the gallery reads as a set of different looks rather than
 * one design with different words. Every deck here is original to this
 * repository — see `README.md` for the licensing rule.
 */

export const devDesignReview: TemplateSeed = {
  slug: 'dev-design-review',
  title: 'Design Review (Engineering)',
  description:
    'A structure for reviewing an engineering design: the problem, the goals, the proposed approach, the alternatives considered, and the decision that is actually needed.',
  category: 'Business',
  tags: ['deck', 'engineering', 'design-doc'],
  content: {
    kind: 'slides',
    document: themedDeck('geometric', 'Design Review (Engineering)', [
      ['title-slide', [['Design Review (Engineering)'], ['<system or feature> · <author> · <date>']], 'sidebar'],
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

export const projectProposal: TemplateSeed = {
  slug: 'project-proposal',
  title: 'Project Proposal',
  description:
    'A concise case for starting a project: the problem, the proposed solution, what is in and out of scope, the plan, the cost, and the ask.',
  category: 'Project management',
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

export const allHandsUpdate: TemplateSeed = {
  slug: 'all-hands-update',
  title: 'All-Hands Update',
  description:
    'A short company or team update for an all-hands: where we are, the highlights, the headline metric, what comes next, and a thank-you.',
  category: 'Business',
  tags: ['deck', 'allhands', 'update'],
  content: {
    kind: 'slides',
    document: themedDeck('streamline', 'All-Hands Update', [
      ['title-slide', [['All-Hands Update'], ['<team or company> · <date>']], 'geo'],
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

export const caseStudy: TemplateSeed = {
  slug: 'case-study',
  title: 'Case Study',
  description:
    'A before-and-after story of a customer engagement: the challenge, the approach, the results, and the lessons worth reusing.',
  category: 'Business',
  tags: ['deck', 'case-study'],
  content: {
    kind: 'slides',
    document: themedDeck('shift', 'Case Study', [
      ['title-slide', [['Case Study'], ['<customer> · <date>']], 'split'],
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

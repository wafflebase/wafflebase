import { deck, slide } from '../builders';
import type { TemplateSeed } from '../types';

export const weeklyBusinessReview: TemplateSeed = {
  slug: 'weekly-business-review',
  title: 'Weekly Business Review',
  description:
    'A standing agenda for the Monday leadership sync: last week’s numbers, what moved, what is at risk, and what each owner is doing about it.',
  category: 'Business',
  tags: ['deck', 'meeting', 'metrics'],
  content: {
    kind: 'slides',
    document: deck('Weekly Business Review', [
      slide('title-slide', [
        ['Weekly Business Review'],
        ['Week of <date> · <team>'],
      ]),
      slide('title-body', [
        ['Agenda'],
        [
          'Headline numbers',
          'What moved, and why',
          'Risks and blockers',
          'Decisions we need today',
          'Owners and next steps',
        ],
      ]),
      slide('title-two-columns', [
        ['Headline numbers'],
        ['Metric', 'Revenue', 'Active accounts', 'Churn', 'Pipeline'],
        ['This week vs last', '—', '—', '—', '—'],
      ]),
      slide('title-body', [
        ['What moved'],
        [
          'Biggest positive change, and the cause',
          'Biggest negative change, and the cause',
          'Anything that looks like a trend rather than noise',
        ],
      ]),
      slide('title-body', [
        ['Risks and blockers'],
        [
          'Risk — owner — what would resolve it',
          'Risk — owner — what would resolve it',
          'Escalations that need a decision in this meeting',
        ],
      ]),
      slide('title-body', [
        ['Decisions needed today'],
        [
          'Decision — who decides — by when',
          'Decision — who decides — by when',
        ],
      ]),
      slide('main-point', [['Next steps']]),
      slide('title-body', [
        ['Owners and next steps'],
        [
          'Action — owner — due date',
          'Action — owner — due date',
          'Action — owner — due date',
        ],
      ]),
    ]),
  },
};

export const projectKickoff: TemplateSeed = {
  slug: 'project-kickoff',
  title: 'Project Kickoff',
  description:
    'Everything a kickoff has to settle before work starts: the problem, what is in and out of scope, who owns what, the plan, and the risks nobody has named yet.',
  category: 'Project management',
  tags: ['deck', 'kickoff', 'planning'],
  content: {
    kind: 'slides',
    document: deck('Project Kickoff', [
      slide('title-slide', [
        ['Project Kickoff'],
        ['<project name> · <start date>'],
      ]),
      slide('title-body', [
        ['The problem'],
        [
          'Who has this problem today',
          'What it costs them',
          'Why now',
        ],
      ]),
      slide('title-body', [
        ['What success looks like'],
        [
          'The one number that has to move',
          'How we will know we are done',
          'What we are explicitly not trying to prove',
        ],
      ]),
      slide('title-two-columns', [
        ['Scope'],
        ['In scope', '—', '—', '—'],
        ['Out of scope', '—', '—', '—'],
      ]),
      slide('title-body', [
        ['Team and owners'],
        [
          'Directly responsible individual',
          'Contributors',
          'Reviewers and approvers',
          'Who to escalate to',
        ],
      ]),
      slide('title-body', [
        ['Plan'],
        [
          'Milestone 1 — date — what ships',
          'Milestone 2 — date — what ships',
          'Milestone 3 — date — what ships',
        ],
      ]),
      slide('title-body', [
        ['Risks'],
        [
          'Risk — likelihood — impact — mitigation',
          'Risk — likelihood — impact — mitigation',
          'What would make us stop the project',
        ],
      ]),
      slide('section-header', [['Questions']]),
    ]),
  },
};

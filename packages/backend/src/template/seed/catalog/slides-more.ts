import { themedDeck } from '../builders';
import type { TemplateSeed } from '../types';

/**
 * Additional slide templates for the gallery, authored natively against the
 * built-in layouts (docs/design/template-gallery.md). Each picks a distinct
 * built-in theme AND a distinct cover composition (see `Decor` in builders)
 * so the gallery reads as a set of different designs rather than one design
 * with different words. Every deck here is original to this repository — see
 * `README.md` for the licensing rule.
 */

export const sprintRetrospective: TemplateSeed = {
  slug: 'sprint-retrospective',
  title: 'Sprint Retrospective',
  description:
    'A short, honest look back at a sprint: what to keep, what to change, and the one thing the team commits to next time.',
  category: 'Project management',
  tags: ['deck', 'retro', 'agile', 'meeting'],
  content: {
    kind: 'slides',
    document: themedDeck('slate', 'Sprint Retrospective', [
      [
        'title-slide',
        [['Sprint Retrospective'], ['<team> · Sprint <n> · <date>']],
        'sidebar',
      ],
      [
        'title-body',
        [
          ['What went well'],
          [
            'Something worth keeping — and why',
            'Something worth keeping — and why',
            'Something worth keeping — and why',
          ],
        ],
      ],
      [
        'title-body',
        [
          ['What to improve'],
          [
            'What slowed us down, and the cause',
            'What we want to stop doing',
            'A gap we noticed too late',
          ],
        ],
      ],
      [
        'title-two-columns',
        [
          ['Action items'],
          ['Action', '—', '—', '—'],
          ['Owner and due date', '—', '—', '—'],
        ],
      ],
      ['main-point', [['One thing we change next sprint']], 'band'],
    ]),
  },
};

export const okrReview: TemplateSeed = {
  slug: 'okr-review',
  title: 'OKR Review',
  description:
    'A quarterly check on objectives and key results: where each one landed, what moved the numbers, and what carries into next quarter.',
  category: 'Business',
  tags: ['deck', 'okr', 'goals', 'quarterly'],
  content: {
    kind: 'slides',
    document: themedDeck('material', 'OKR Review', [
      ['title-slide', [['OKR Review'], ['<team> · <quarter>']], 'band'],
      [
        'title-body',
        [
          ['Objectives this quarter'],
          [
            'Objective 1 — the outcome we wanted',
            'Objective 2 — the outcome we wanted',
            'Objective 3 — the outcome we wanted',
          ],
        ],
      ],
      [
        'title-two-columns',
        [
          ['Key results and where they landed'],
          ['Key result', '—', '—', '—', '—'],
          ['Target vs actual', '—', '—', '—', '—'],
        ],
      ],
      [
        'big-number',
        [['<xx>%'], ['Average key-result attainment this quarter']],
        'geo',
      ],
      [
        'title-body',
        [
          ['What we learned'],
          [
            'What actually moved the numbers',
            'What we thought would work but did not',
            'What we would set differently',
          ],
        ],
      ],
      ['main-point', [['The focus for next quarter']]],
    ]),
  },
};

export const productLaunchPlan: TemplateSeed = {
  slug: 'product-launch-plan',
  title: 'Product Launch Plan',
  description:
    'Everything a launch has to line up before the date: the pitch, the goal, the channels, the timeline, and the go / no-go call.',
  category: 'Marketing',
  tags: ['deck', 'launch', 'go-to-market', 'product'],
  content: {
    kind: 'slides',
    document: themedDeck('coral', 'Product Launch Plan', [
      ['title-slide', [['Product Launch Plan'], ['<product> · Launch <date>']], 'geo'],
      [
        'title-body',
        [
          ['What we are launching'],
          ['The one-line pitch', 'Who it is for', 'Why it matters now'],
        ],
      ],
      [
        'title-body',
        [
          ['What success looks like'],
          [
            'The one number that has to move',
            'Secondary metrics we will watch',
            'What "good" looks like at day 30',
          ],
        ],
      ],
      [
        'title-two-columns',
        [
          ['Channels and messaging'],
          ['Channel', '—', '—', '—'],
          ['Message', '—', '—', '—'],
        ],
      ],
      [
        'title-body',
        [
          ['Timeline'],
          [
            'T-14 — what has to be ready',
            'T-7 — what has to be ready',
            'Launch day — who does what',
            'T+7 — review and iterate',
          ],
        ],
      ],
      ['main-point', [['Go / no-go criteria']], 'band'],
    ]),
  },
};

export const techTalk: TemplateSeed = {
  slug: 'tech-talk-paper-study',
  title: 'Tech Talk / Paper Study',
  description:
    'A structure for presenting a paper or a technical topic: the problem, the key idea, the trade-offs, and what you would take away.',
  category: 'Education',
  tags: ['deck', 'talk', 'paper', 'study', 'engineering'],
  content: {
    kind: 'slides',
    document: themedDeck('modern-writer', 'Tech Talk / Paper Study', [
      ['title-slide', [['<talk or paper title>'], ['<speaker> · <date>']], 'block'],
      [
        'title-body',
        [
          ['The problem'],
          [
            'What problem this addresses',
            'Why existing approaches fall short',
            'Why it is worth solving',
          ],
        ],
      ],
      ['section-header', [['The key idea']], 'band'],
      [
        'title-body',
        [
          ['How it works'],
          [
            'The core insight in one line',
            'The mechanism, step by step',
            'What is clever about it',
          ],
        ],
      ],
      [
        'title-two-columns',
        [['Trade-offs'], ['Strengths', '—', '—'], ['Limitations', '—', '—']],
      ],
      [
        'title-body',
        [
          ['Takeaways'],
          ['What I would use this for', 'Open questions', 'Where to read more'],
        ],
      ],
      ['main-point', [['Discussion']]],
    ]),
  },
};

export const productRoadmap: TemplateSeed = {
  slug: 'product-roadmap',
  title: 'Product Roadmap',
  description:
    'A now / next / later roadmap that shows direction without over-promising dates, plus what the team is deliberately not doing.',
  category: 'Project management',
  tags: ['deck', 'roadmap', 'planning', 'product'],
  content: {
    kind: 'slides',
    document: themedDeck('paradigm', 'Product Roadmap', [
      ['title-slide', [['Product Roadmap'], ['<product> · <period>']], 'split'],
      [
        'title-body',
        [
          ['Where we are'],
          [
            'What shipped recently',
            'What users keep asking for',
            'What is holding back growth',
          ],
        ],
      ],
      [
        'section-title-description',
        [
          ['Now'],
          ['What is in flight this quarter, and the outcome each item is for.'],
        ],
        'band',
      ],
      [
        'section-title-description',
        [
          ['Next'],
          ['What comes after — and what has to be true before we start it.'],
        ],
        'band',
      ],
      [
        'section-title-description',
        [
          ['Later'],
          ['Bets we believe in but are not committing to a date yet.'],
        ],
        'band',
      ],
      ['main-point', [['What we are deliberately not doing']]],
    ]),
  },
};

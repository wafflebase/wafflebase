import { themedDeck } from '../builders';
import type { TemplateSeed } from '../types';

/**
 * Education-focused slide templates for the gallery, authored natively against
 * the built-in layouts (docs/design/template-gallery.md). Each picks a
 * distinct built-in theme so the gallery reads as a set of different looks
 * rather than one design with different words. Every deck here is original to
 * this repository — see `README.md` for the licensing rule.
 */

export const seminarDeck: TemplateSeed = {
  slug: 'seminar-deck',
  title: 'Seminar Deck',
  description:
    'A clear structure for a seminar or talk: the topic, the background it rests on, the core content, and a close that invites questions.',
  category: 'Education',
  tags: ['deck', 'seminar', 'talk'],
  content: {
    kind: 'slides',
    document: themedDeck('momentum', 'Seminar Deck', [
      ['title-slide', [['Seminar Deck'], ['<speaker> · <date>']], 'geo'],
      [
        'title-body',
        [
          ["Today's topic"],
          [
            'The question this seminar answers',
            'Why it matters to this audience',
            'What you will take away',
          ],
        ],
        'plain',
      ],
      ['section-header', [['Background']], 'band'],
      [
        'title-body',
        [
          ['Core content'],
          [
            'The first key idea',
            'The second key idea',
            'The third key idea',
            'How they fit together',
          ],
        ],
        'sidebar',
      ],
      [
        'title-body',
        [
          ['Key takeaways'],
          [
            'The one thing to remember',
            'What it changes in practice',
            'Where to go deeper',
          ],
        ],
        'plain',
      ],
      ['main-point', [['Questions?']], 'plain'],
    ]),
  },
};

export const universityLecture: TemplateSeed = {
  slug: 'university-lecture',
  title: 'University Lecture',
  description:
    'A lecture that moves from objectives to a concept, works an example, contrasts mistakes with the right approach, and points to further reading.',
  category: 'Education',
  tags: ['deck', 'lecture', 'academic'],
  content: {
    kind: 'slides',
    document: themedDeck('luxe', 'University Lecture', [
      ['title-slide', [['University Lecture'], ['<course> · Lecture <n> · <date>']], 'sidebar'],
      [
        'title-body',
        [
          ['Learning objectives'],
          [
            'By the end you will be able to <objective>',
            'By the end you will be able to <objective>',
            'By the end you will be able to <objective>',
          ],
        ],
        'plain',
      ],
      [
        'section-title-description',
        [
          ['Core concept'],
          ['State the concept in one sentence, then define each term it rests on.'],
        ],
        'band',
      ],
      [
        'title-body',
        [
          ['Worked example'],
          [
            'The problem to solve',
            'Step through the reasoning',
            'The result, and why it holds',
          ],
        ],
        'plain',
      ],
      [
        'title-two-columns',
        [
          ['Common mistakes vs the right approach'],
          ['Common mistake', '—', '—', '—'],
          ['The right approach', '—', '—', '—'],
        ],
        'plain',
      ],
      [
        'title-body',
        [
          ['Summary'],
          [
            'The concept, restated',
            'The example that anchors it',
            'The pitfall to avoid',
          ],
        ],
        'plain',
      ],
      ['main-point', [['Further reading: <reference>']], 'plain'],
    ]),
  },
};

export const studentPresentation: TemplateSeed = {
  slug: 'student-presentation',
  title: 'Student Presentation',
  description:
    'A simple frame for a class or assignment presentation: the topic and question, what you did, the numbers, and what you learned.',
  category: 'Education',
  tags: ['deck', 'student', 'assignment'],
  content: {
    kind: 'slides',
    document: themedDeck('spearmint', 'Student Presentation', [
      ['title-slide', [['Student Presentation'], ['<name> · <course> · <date>']], 'band'],
      [
        'title-body',
        [
          ['Topic and question'],
          [
            'The topic I chose',
            'The question I set out to answer',
            'Why it interested me',
          ],
        ],
        'plain',
      ],
      [
        'title-body',
        [
          ['What I did'],
          [
            'How I approached it',
            'What I looked at or tested',
            'What I left out, and why',
          ],
        ],
        'plain',
      ],
      ['big-number', [['<xx>'], ['The key result, in one number']], 'geo'],
      [
        'title-body',
        [
          ['What I learned'],
          [
            'What the result tells us',
            'What surprised me',
            'What I would do differently',
          ],
        ],
        'plain',
      ],
      ['main-point', [['Thank you']], 'plain'],
    ]),
  },
};

export const workshopTraining: TemplateSeed = {
  slug: 'workshop-training',
  title: 'Workshop / Training',
  description:
    'A hands-on session that sets what people will learn, walks the agenda, moves into practice step by step, and wraps up with resources.',
  category: 'Education',
  tags: ['deck', 'workshop', 'training'],
  content: {
    kind: 'slides',
    document: themedDeck('beach-day', 'Workshop / Training', [
      ['title-slide', [['Workshop / Training'], ['<facilitator> · <date>']], 'block'],
      [
        'title-body',
        [
          ["What you'll learn today"],
          [
            'The skill you will walk away with',
            'Who this session is for',
            'What you need to follow along',
          ],
        ],
        'plain',
      ],
      [
        'title-body',
        [
          ['Agenda'],
          [
            'Intro and setup',
            'Core concepts',
            'Hands-on practice',
            'Wrap-up and questions',
          ],
        ],
        'plain',
      ],
      ['section-header', [['Hands-on practice']], 'band'],
      [
        'title-body',
        [
          ['Steps'],
          [
            'Step 1 — <do this>',
            'Step 2 — <do this>',
            'Step 3 — <do this>',
            'Check your result against <expected>',
          ],
        ],
        'plain',
      ],
      [
        'title-body',
        [
          ['Wrap-up'],
          [
            'What we covered',
            'The habit to keep practicing',
            'How to get help when you are stuck',
          ],
        ],
        'plain',
      ],
      ['main-point', [['Resources: <link>']], 'plain'],
    ]),
  },
};

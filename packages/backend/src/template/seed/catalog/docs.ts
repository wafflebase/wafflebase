import { bullet, heading, para, title } from '../builders';
import type { TemplateSeed } from '../types';

export const productRequirementsDoc: TemplateSeed = {
  slug: 'product-requirements-doc',
  title: 'Product Requirements Doc',
  description:
    'A one-page spec that answers the questions a reviewer will ask anyway: the problem, who has it, what is out of scope, and how you will know it worked.',
  category: 'Project management',
  tags: ['spec', 'product', 'planning'],
  content: {
    kind: 'doc',
    document: {
      blocks: [
        title('Product Requirements: <feature>'),
        para('Author: —  ·  Status: Draft  ·  Last updated: —'),

        heading('Problem', 1),
        para(
          'What is broken today, for whom, and what it costs them. Write this so someone who has never seen the product understands why it matters.',
        ),

        heading('Goals', 1),
        bullet('The outcome this has to produce'),
        bullet('The number that has to move, and by how much'),

        heading('Non-goals', 1),
        bullet('Something a reader would reasonably assume is included, and is not'),
        bullet('Work deliberately deferred, with the reason'),

        heading('Proposal', 1),
        para(
          'What we are going to build, in enough detail that an engineer could disagree with it. Prefer describing behaviour over describing screens.',
        ),

        heading('Open questions', 1),
        bullet('Question — who can answer it — by when'),

        heading('Risks', 1),
        bullet('Risk — what it would cost — how we would detect it early'),

        heading('Success criteria', 1),
        para(
          'How we decide, after shipping, whether this worked. If it cannot be measured, say what would count as evidence instead.',
        ),
      ],
    },
  },
};

export const meetingNotes: TemplateSeed = {
  slug: 'meeting-notes',
  title: 'Meeting Notes',
  description:
    'Attendees, decisions and action items, in the order you actually need them afterwards — decisions first, discussion last.',
  category: 'Business',
  tags: ['meeting', 'notes', 'team'],
  content: {
    kind: 'doc',
    document: {
      blocks: [
        title('<meeting> — <date>'),
        para('Attendees: —'),
        para('Facilitator: —  ·  Notetaker: —'),

        heading('Decisions', 1),
        para(
          'What was actually decided, and by whom. Written first because this is the part people come back for.',
        ),
        bullet('Decision — owner — effective when'),

        heading('Action items', 1),
        bullet('Action — owner — due date'),
        bullet('Action — owner — due date'),

        heading('Discussion', 1),
        bullet('Topic — the substance, not the transcript'),

        heading('Parked', 1),
        bullet('Raised but not resolved — who picks it up'),
      ],
    },
  },
};

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

export const partnerNewsletter: TemplateSeed = {
  slug: 'partner-newsletter',
  title: 'Partner Newsletter',
  description:
    'A periodic update for partners or customers that leads with what changed for them, flags what they need to act on, and ends with how to reach you.',
  category: 'Marketing',
  tags: ['newsletter', 'partners', 'communication'],
  content: {
    kind: 'doc',
    document: {
      blocks: [
        title('Partner newsletter — <period>'),
        para('From: <team>  ·  For: <audience>  ·  Issue: —'),

        heading('Headline', 1),
        para(
          'The one thing a partner should take away if they read nothing else. Lead with the result and the number behind it, then a sentence on why it happened.',
        ),
        para(
          'Add a chart or image here if it makes the point faster than a sentence can.',
        ),

        heading('What is new', 1),
        para(
          'Features or services partners can use today. Describe each by what it lets them do, not by what it is called internally.',
        ),
        bullet('<feature> — what it lets partners do — where to find it'),
        bullet('<feature> — what it lets partners do — where to find it'),

        heading('Upcoming changes', 1),
        para(
          'Anything that changes how partners work with you. Give each one an effective date and the step they need to take before it, so nobody finds out on the day.',
        ),
        bullet('<change> — effective <date> — what partners need to do'),
        bullet('<retirement> — last day <date> — what to move to instead'),

        heading('Events and training', 1),
        bullet('<date> — <session title> — who it is for'),
        bullet('<date> — <session title> — who it is for'),
        para(
          'Length, format, and whether sessions are recorded for anyone who cannot attend live.',
        ),

        heading('Questions', 1),
        para(
          'How to reply and who reads it. Say what you do with the feedback, so partners know it is worth sending.',
        ),
      ],
    },
  },
};

export const vendorOnboarding: TemplateSeed = {
  slug: 'vendor-onboarding',
  title: 'Vendor Onboarding',
  description:
    'A setup plan for bringing a new supplier on board, from signed agreement to first purchase order, with owners and the paperwork to collect.',
  category: 'Business',
  tags: ['vendor', 'procurement', 'onboarding', 'checklist'],
  content: {
    kind: 'doc',
    document: {
      blocks: [
        title('New vendor setup: <vendor>'),
        para(
          'Requested by: —  ·  Status: Not started  ·  Target first order: —',
        ),

        heading('Summary', 1),
        para(
          'What this vendor supplies, why we are adding them, and any constraint that shapes the setup — a deadline, a spending threshold, a region.',
        ),

        heading('Timeline', 1),
        para(
          'The steps in order, each with the day it should be done. A step that waits on another team says so, so a slip is visible before it blocks the first order.',
        ),
        bullet('Agreement signed — owner — by —'),
        bullet('Documents received from the vendor — owner — by —'),
        bullet('Account created in the purchasing system — owner — by —'),
        bullet('Bank details verified by accounts payable — owner — by —'),
        bullet('First purchase order sent — owner — by —'),

        heading('Contacts', 1),
        bullet('Procurement lead: —'),
        bullet('Accounts payable: —'),
        bullet('Vendor account manager: —'),
        bullet('Vendor billing contact: —'),

        heading('Documents to collect', 1),
        para(
          'Note the date each one arrives. Ask for anything with banking details through a channel you can verify, never on the strength of an email alone.',
        ),
        bullet('Signed master agreement'),
        bullet('Tax form — the one your jurisdiction requires'),
        bullet('Certificate of insurance'),
        bullet('Bank details on company letterhead'),

        heading('Terms', 1),
        bullet('Payment terms: —'),
        bullet('Currency: —'),
        bullet('Approval threshold for purchase orders: —'),

        heading('Notes', 1),
        para('Anything that came up during setup the next person should know.'),
      ],
    },
  },
};

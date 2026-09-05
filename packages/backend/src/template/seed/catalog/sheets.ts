import {
  boldMoneyFormula,
  cell,
  formula,
  money,
  moneyFormula,
  rows,
  th,
} from '../builders';
import type { TemplateSeed } from '../types';

export const monthlyBudgetTracker: TemplateSeed = {
  slug: 'monthly-budget-tracker',
  title: 'Monthly Budget Tracker',
  description:
    'Track planned against actual spending by category, with the variance calculated for you. Replace the sample rows and the totals follow.',
  category: 'Finance',
  tags: ['budget', 'personal', 'formulas'],
  content: {
    kind: 'sheet',
    tabName: 'Budget',
    frozenRows: 1,
    cells: {
      ...rows('A1', [
        [th('Category'), th('Planned'), th('Actual'), th('Variance')],
        [cell('Rent'), money('1500'), money('1500'), moneyFormula('=B2-C2', '0')],
        [cell('Groceries'), money('600'), money('648'), moneyFormula('=B3-C3', '-48')],
        [cell('Transport'), money('180'), money('142'), moneyFormula('=B4-C4', '38')],
        [cell('Utilities'), money('220'), money('231'), moneyFormula('=B5-C5', '-11')],
        [cell('Subscriptions'), money('60'), money('74'), moneyFormula('=B6-C6', '-14')],
        [cell('Dining out'), money('250'), money('312'), moneyFormula('=B7-C7', '-62')],
        [cell('Savings'), money('800'), money('800'), moneyFormula('=B8-C8', '0')],
      ]),
      ...rows('A10', [
        [
          cell('Total', { b: true }),
          boldMoneyFormula('=SUM(B2:B8)', '3610'),
          boldMoneyFormula('=SUM(C2:C8)', '3707'),
          boldMoneyFormula('=SUM(D2:D8)', '-97'),
        ],
      ]),
    },
  },
};

export const sprintTaskTracker: TemplateSeed = {
  slug: 'sprint-task-tracker',
  title: 'Sprint Task Tracker',
  description:
    'One row per task: owner, status, estimate and actual. The summary counts each status for you, so standup reads off the sheet.',
  category: 'Project management',
  tags: ['sprint', 'agile', 'tracker'],
  content: {
    kind: 'sheet',
    tabName: 'Sprint',
    frozenRows: 1,
    cells: {
      ...rows('A1', [
        [
          th('Task'),
          th('Owner'),
          th('Status'),
          th('Estimate (d)'),
          th('Actual (d)'),
          th('Notes'),
        ],
        [
          cell('Draft the API contract'),
          cell('—'),
          cell('Done'),
          cell('2'),
          cell('2'),
          cell(''),
        ],
        [
          cell('Wire the read path'),
          cell('—'),
          cell('In progress'),
          cell('3'),
          cell('1'),
          cell(''),
        ],
        [
          cell('Migration + backfill'),
          cell('—'),
          cell('Blocked'),
          cell('2'),
          cell('0'),
          cell('Waiting on staging data'),
        ],
        [
          cell('Tests for the failure path'),
          cell('—'),
          cell('To do'),
          cell('1'),
          cell('0'),
          cell(''),
        ],
        [
          cell('Docs + changelog'),
          cell('—'),
          cell('To do'),
          cell('1'),
          cell('0'),
          cell(''),
        ],
      ]),
      ...rows('H1', [
        [th('Summary'), th('Count')],
        [cell('To do'), formula('=COUNTIF(C2:C50,"To do")', '2')],
        [cell('In progress'), formula('=COUNTIF(C2:C50,"In progress")', '1')],
        [cell('Blocked'), formula('=COUNTIF(C2:C50,"Blocked")', '1')],
        [cell('Done'), formula('=COUNTIF(C2:C50,"Done")', '1')],
        [
          cell('Days estimated', { b: true }),
          formula('=SUM(D2:D50)', '9', { b: true }),
        ],
        [
          cell('Days spent', { b: true }),
          formula('=SUM(E2:E50)', '3', { b: true }),
        ],
      ]),
    },
  },
};

export const contentCalendar: TemplateSeed = {
  slug: 'content-calendar',
  title: 'Content Calendar',
  description:
    'Plan posts across channels: what publishes when, who writes it, where it goes, and whether it actually shipped.',
  category: 'Marketing',
  tags: ['content', 'calendar', 'planning'],
  content: {
    kind: 'sheet',
    tabName: 'Calendar',
    frozenRows: 1,
    cells: {
      ...rows('A1', [
        [
          th('Publish date'),
          th('Title'),
          th('Channel'),
          th('Owner'),
          th('Status'),
          th('Link'),
        ],
        [
          cell('2026-09-07'),
          cell('Launch announcement'),
          cell('Blog'),
          cell('—'),
          cell('Published'),
          cell(''),
        ],
        [
          cell('2026-09-09'),
          cell('Feature deep dive'),
          cell('Newsletter'),
          cell('—'),
          cell('Draft'),
          cell(''),
        ],
        [
          cell('2026-09-14'),
          cell('Customer story'),
          cell('Blog'),
          cell('—'),
          cell('Idea'),
          cell(''),
        ],
        [
          cell('2026-09-18'),
          cell('Release notes'),
          cell('Changelog'),
          cell('—'),
          cell('Idea'),
          cell(''),
        ],
      ]),
      ...rows('H1', [
        [th('Status'), th('Count')],
        [cell('Idea'), formula('=COUNTIF(E2:E100,"Idea")', '2')],
        [cell('Draft'), formula('=COUNTIF(E2:E100,"Draft")', '1')],
        [cell('Published'), formula('=COUNTIF(E2:E100,"Published")', '1')],
      ]),
    },
  },
};

export const invoice: TemplateSeed = {
  slug: 'invoice',
  title: 'Invoice',
  description:
    'A single-page invoice: your details, their details, line items, and a total that adds tax for you.',
  category: 'Finance',
  tags: ['invoice', 'billing', 'freelance'],
  content: {
    kind: 'sheet',
    tabName: 'Invoice',
    cells: {
      ...rows('A1', [[cell('INVOICE', { b: true })]]),
      ...rows('A3', [
        [cell('From', { b: true }), cell('<your name>')],
        [cell(''), cell('<address>')],
        [cell(''), cell('<email>')],
      ]),
      ...rows('D3', [
        [cell('Bill to', { b: true }), cell('<client name>')],
        [cell(''), cell('<address>')],
        [cell(''), cell('<email>')],
      ]),
      ...rows('A7', [
        [cell('Invoice no.', { b: true }), cell('0001')],
        [cell('Issued', { b: true }), cell('2026-09-04')],
        [cell('Due', { b: true }), cell('2026-10-04')],
      ]),
      ...rows('A11', [
        [th('Description'), th('Qty'), th('Unit price'), th('Amount')],
        [
          cell('<service>'),
          cell('1'),
          money('1200'),
          moneyFormula('=B12*C12', '1200'),
        ],
        [
          cell('<service>'),
          cell('4'),
          money('150'),
          moneyFormula('=B13*C13', '600'),
        ],
        [cell(''), cell(''), cell(''), cell('')],
        [cell(''), cell(''), cell(''), cell('')],
      ]),
      ...rows('C17', [
        [cell('Subtotal', { b: true }), moneyFormula('=SUM(D12:D15)', '1800')],
        [cell('Tax (10%)'), moneyFormula('=D17*0.1', '180')],
        [cell('Total due', { b: true }), boldMoneyFormula('=D17+D18', '1980')],
      ]),
      ...rows('A21', [[cell('Payment terms: net 30. Thank you.')]]),
    },
  },
};

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

const pct = (f: string, v: string, b = false) =>
  formula(f, v, b ? { nf: 'percent', b: true } : { nf: 'percent' });

export const regionalSalesReport: TemplateSeed = {
  slug: 'regional-sales-report',
  title: 'Regional Sales Report',
  description:
    'Compare revenue by region across the four quarters, with year totals, each region’s share and quarter-on-quarter change worked out for you.',
  category: 'Business',
  tags: ['sales', 'quarterly', 'report', 'formulas'],
  content: {
    kind: 'sheet',
    tabName: 'Sales',
    frozenRows: 1,
    cells: {
      ...rows('A1', [
        [
          th('Region'),
          th('Q1'),
          th('Q2'),
          th('Q3'),
          th('Q4'),
          th('Year total'),
          th('Share'),
        ],
        [
          cell('North'),
          money('42000'),
          money('45500'),
          money('48200'),
          money('51000'),
          moneyFormula('=SUM(B2:E2)', '186700'),
          pct('=F2/$F$6', '0.2656138853321952'),
        ],
        [
          cell('South'),
          money('38500'),
          money('36900'),
          money('40100'),
          money('43800'),
          moneyFormula('=SUM(B3:E3)', '159300'),
          pct('=F3/$F$6', '0.2266325224071703'),
        ],
        [
          cell('East'),
          money('51200'),
          money('53600'),
          money('55900'),
          money('58400'),
          moneyFormula('=SUM(B4:E4)', '219100'),
          pct('=F4/$F$6', '0.3117086356522976'),
        ],
        [
          cell('West'),
          money('29800'),
          money('33100'),
          money('35700'),
          money('39200'),
          moneyFormula('=SUM(B5:E5)', '137800'),
          pct('=F5/$F$6', '0.1960449566083369'),
        ],
        [
          cell('Total', { b: true }),
          boldMoneyFormula('=SUM(B2:B5)', '161500'),
          boldMoneyFormula('=SUM(C2:C5)', '169100'),
          boldMoneyFormula('=SUM(D2:D5)', '179900'),
          boldMoneyFormula('=SUM(E2:E5)', '192400'),
          boldMoneyFormula('=SUM(F2:F5)', '702900'),
          pct('=SUM(G2:G5)', '1', true),
        ],
        [
          cell('Change vs previous quarter'),
          cell(''),
          pct('=C6/B6-1', '0.04705882352941182'),
          pct('=D6/C6-1', '0.06386753400354817'),
          pct('=E6/D6-1', '0.06948304613674261'),
          cell(''),
          cell(''),
        ],
      ]),
      ...rows('A9', [
        [cell('How to use', { b: true })],
        [
          cell(
            'Rename the regions to your own territories, teams or products, and type each quarter’s revenue.',
          ),
        ],
        [
          cell(
            'Need another region? Insert a row above West and copy the Year total and Share formulas into it, so every sum picks it up.',
          ),
        ],
      ]),
    },
  },
};

export const teamDirectory: TemplateSeed = {
  slug: 'team-directory',
  title: 'Team Directory',
  description:
    'Keep everyone’s role, team, contact details and time zone in one shared list that new joiners can read on day one.',
  category: 'Business',
  tags: ['team', 'contacts', 'directory', 'onboarding'],
  content: {
    kind: 'sheet',
    tabName: 'Team',
    frozenRows: 1,
    cells: {
      ...rows('A1', [
        [
          th('Name'),
          th('Role'),
          th('Team'),
          th('Email'),
          th('Phone'),
          th('Time zone'),
          th('Ask me about'),
        ],
        [
          cell('<name>'),
          cell('Engineer'),
          cell('<team>'),
          cell('<email>'),
          cell('<phone>'),
          cell('<UTC offset>'),
          cell('<topics>'),
        ],
        [
          cell('<name>'),
          cell('Designer'),
          cell('<team>'),
          cell('<email>'),
          cell('<phone>'),
          cell('<UTC offset>'),
          cell(''),
        ],
        [
          cell('<name>'),
          cell('Manager'),
          cell('<team>'),
          cell('<email>'),
          cell('<phone>'),
          cell('<UTC offset>'),
          cell(''),
        ],
      ]),
      ...rows('I1', [
        [th('Summary'), th('Count')],
        [cell('People listed'), formula('=COUNTA(A2:A200)', '3')],
      ]),
      ...rows('I4', [
        [cell('One row per person; sort by Team.')],
        [cell('Ask me about: what to come to them for.')],
      ]),
    },
  },
};

export const sharedExpenseSplitter: TemplateSeed = {
  slug: 'shared-expense-splitter',
  title: 'Shared Expense Splitter',
  description:
    'Log what each flatmate paid for the household and see who is owed and who owes, with every cost split evenly for you.',
  category: 'Personal',
  tags: ['household', 'flatmates', 'split', 'formulas'],
  content: {
    kind: 'sheet',
    tabName: 'Expenses',
    frozenRows: 1,
    cells: {
      ...rows('A1', [
        [th('Item'), th('Category'), th('Paid by'), th('Amount'), th('Notes')],
        [
          cell('Rent'),
          cell('Housing'),
          cell('Flatmate 1'),
          money('2100'),
          cell('Monthly'),
        ],
        [
          cell('Electricity'),
          cell('Utilities'),
          cell('Flatmate 2'),
          money('96'),
          cell(''),
        ],
        [
          cell('Internet'),
          cell('Utilities'),
          cell('Flatmate 3'),
          money('45'),
          cell('Monthly'),
        ],
        [
          cell('Groceries'),
          cell('Food'),
          cell('Flatmate 2'),
          money('184'),
          cell(''),
        ],
        [
          cell('Cleaning'),
          cell('Household'),
          cell('Flatmate 3'),
          money('29'),
          cell(''),
        ],
        [
          cell('Groceries'),
          cell('Food'),
          cell('Flatmate 1'),
          money('138'),
          cell(''),
        ],
      ]),
      ...rows('G1', [
        [th('Flatmate'), th('Paid'), th('Fair share'), th('Balance')],
        [
          cell('Flatmate 1'),
          moneyFormula('=SUMIF($C$2:$C$200,G2,$D$2:$D$200)', '2238'),
          moneyFormula('=SUM($D$2:$D$200)/COUNTA($G$2:$G$4)', '864'),
          moneyFormula('=H2-I2', '1374'),
        ],
        [
          cell('Flatmate 2'),
          moneyFormula('=SUMIF($C$2:$C$200,G3,$D$2:$D$200)', '280'),
          moneyFormula('=SUM($D$2:$D$200)/COUNTA($G$2:$G$4)', '864'),
          moneyFormula('=H3-I3', '-584'),
        ],
        [
          cell('Flatmate 3'),
          moneyFormula('=SUMIF($C$2:$C$200,G4,$D$2:$D$200)', '74'),
          moneyFormula('=SUM($D$2:$D$200)/COUNTA($G$2:$G$4)', '864'),
          moneyFormula('=H4-I4', '-790'),
        ],
        [
          cell('Total', { b: true }),
          boldMoneyFormula('=SUM(H2:H4)', '2592'),
          boldMoneyFormula('=SUM(I2:I4)', '2592'),
          boldMoneyFormula('=SUM(J2:J4)', '0'),
        ],
      ]),
      ...rows('G7', [
        [cell('How to read it', { b: true })],
        [
          cell(
            'Positive balance: the flat owes you. Negative: you owe the flat.',
          ),
        ],
        [
          cell(
            'Rename flatmates here; a "Paid by" name must match exactly to count.',
          ),
        ],
        [
          cell(
            'Settled up? Duplicate the tab for next month and clear the expense rows.',
          ),
        ],
        [
          cell(
            'Another flatmate? Insert a row above Flatmate 3 and copy its formulas.',
          ),
        ],
      ]),
    },
  },
};

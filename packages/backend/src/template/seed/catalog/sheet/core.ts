import type { Cell, CellStyle } from '@wafflebase/sheets';
import { cell, formula, money, moneyFormula, rows } from '../../builders';
import type { TemplateSeed } from '../../types';

/*
 * One visual grammar for every sheet in this file, so the seven templates
 * read as a set. Colours come from the formatting picker's own swatches
 * (`formatting-colors.ts`), so whoever extends a template can match them, and
 * every fill is light enough that the dark theme's ink-flip
 * (`getCellTextColor`) keeps it readable without an explicit text colour.
 *
 * - Header: bold on the warm rule tone. The grid's own column headers are a
 *   cool grey, so a grey header row disappeared into the chrome.
 * - Side block (a summary beside the data): cream wash on its body, so it
 *   reads as a panel rather than a second table that happens to be nearby.
 * - Total: bold under a ruled top border — the ledger's sum line.
 * - Note: italic in the picker's mid ink, so guidance stays out of the way of
 *   the data. #857060 is 4.68:1 on white and 3.56:1 on the dark grid.
 *
 * Placeholders (`<name>`) deliberately carry no colour: typing over a cell
 * keeps its style, so a grey placeholder would leave the user's own text grey.
 */
const HEAD_BG = '#E8DCC4';
const WASH_BG = '#FBF6EC';
const NOTE_TC = '#857060';

/** Restyle a built cell, keeping its number format. */
const styled = (c: Cell, s: CellStyle): Cell => ({ ...c, s: { ...c.s, ...s } });

/** Header cell; `right` for a column of numbers, so it sits over them. */
const th = (v: string, right = false): Cell =>
  cell(v, { b: true, bg: HEAD_BG, ...(right ? { al: 'right' } : {}) });
const thr = (v: string): Cell => th(v, true);

/** The sum line: bold, ruled above. */
const total = (c: Cell): Cell => styled(c, { b: true, bt: true });

/** Body of a side block. */
const wash = (c: Cell): Cell => styled(c, { bg: WASH_BG });

/** A field name beside the value it labels (invoice header fields). */
const label = (v: string): Cell => cell(v, { tc: NOTE_TC });

/** Guidance text. */
const note = (v: string): Cell => cell(v, { i: true, tc: NOTE_TC });

const monthlyBudgetTracker: TemplateSeed = {
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
        [th('Category'), thr('Planned'), thr('Actual'), thr('Variance')],
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
          total(cell('Total')),
          total(moneyFormula('=SUM(B2:B8)', '3610')),
          total(moneyFormula('=SUM(C2:C8)', '3707')),
          total(moneyFormula('=SUM(D2:D8)', '-97')),
        ],
      ]),
    },
  },
};

const sprintTaskTracker: TemplateSeed = {
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
          thr('Estimate (d)'),
          thr('Actual (d)'),
          th('Notes'),
        ],
        // Task names stay within a default-width column: the Owner cell
        // beside them is never empty, so a longer name would be clipped.
        [
          cell('Draft API spec'),
          cell('—'),
          cell('Done'),
          cell('2'),
          cell('2'),
          cell(''),
        ],
        [
          cell('Wire read path'),
          cell('—'),
          cell('In progress'),
          cell('3'),
          cell('1'),
          cell(''),
        ],
        [
          cell('Data migration'),
          cell('—'),
          cell('Blocked'),
          cell('2'),
          cell('0'),
          cell('Waiting on staging data'),
        ],
        [
          cell('Failure tests'),
          cell('—'),
          cell('To do'),
          cell('1'),
          cell('0'),
          cell(''),
        ],
        [
          cell('Update docs'),
          cell('—'),
          cell('To do'),
          cell('1'),
          cell('0'),
          cell(''),
        ],
      ]),
      ...rows('H1', [
        [th('Summary'), thr('Count')],
        [wash(cell('To do')), wash(formula('=COUNTIF(C2:C50,"To do")', '2'))],
        [
          wash(cell('In progress')),
          wash(formula('=COUNTIF(C2:C50,"In progress")', '1')),
        ],
        [
          wash(cell('Blocked')),
          wash(formula('=COUNTIF(C2:C50,"Blocked")', '1')),
        ],
        [wash(cell('Done')), wash(formula('=COUNTIF(C2:C50,"Done")', '1'))],
        [
          // Named after the columns they sum; a bold 'Days estimated' ran
          // into the Count column.
          wash(total(cell('Estimate (d)'))),
          wash(total(formula('=SUM(D2:D50)', '9'))),
        ],
        [
          wash(cell('Actual (d)', { b: true })),
          wash(formula('=SUM(E2:E50)', '3', { b: true })),
        ],
      ]),
    },
  },
};

const contentCalendar: TemplateSeed = {
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
          cell('Launch post'),
          cell('Blog'),
          cell('—'),
          cell('Published'),
          cell(''),
        ],
        [
          cell('2026-09-09'),
          cell('Feature dive'),
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
        [th('Status'), thr('Count')],
        [wash(cell('Idea')), wash(formula('=COUNTIF(E2:E100,"Idea")', '2'))],
        [wash(cell('Draft')), wash(formula('=COUNTIF(E2:E100,"Draft")', '1'))],
        [
          wash(cell('Published')),
          wash(formula('=COUNTIF(E2:E100,"Published")', '1')),
        ],
      ]),
    },
  },
};

const invoice: TemplateSeed = {
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
      // The title rules off the page head, as wide as the Bill to block.
      ...rows('A1', [
        [
          cell('INVOICE', { b: true, bb: true }),
          cell('', { bb: true }),
          cell('', { bb: true }),
          cell('', { bb: true }),
          cell('', { bb: true }),
        ],
      ]),
      ...rows('A3', [
        [label('From'), cell('<your name>')],
        [cell(''), cell('<address>')],
        [cell(''), cell('<email>')],
      ]),
      ...rows('D3', [
        [label('Bill to'), cell('<client name>')],
        [cell(''), cell('<address>')],
        [cell(''), cell('<email>')],
      ]),
      ...rows('A7', [
        [label('Invoice no.'), cell('0001')],
        [label('Issued'), cell('2026-09-04')],
        [label('Due'), cell('2026-10-04')],
      ]),
      ...rows('A11', [
        [th('Description'), thr('Qty'), thr('Unit price'), thr('Amount')],
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
        // Rule off the item rows, so the two blank ones read as room for
        // more lines rather than as the end of the table.
        [
          cell('', { bb: true }),
          cell('', { bb: true }),
          cell('', { bb: true }),
          cell('', { bb: true }),
        ],
      ]),
      ...rows('C17', [
        [
          styled(label('Subtotal'), { al: 'right' }),
          moneyFormula('=SUM(D12:D15)', '1800'),
        ],
        [
          styled(label('Tax (10%)'), { al: 'right' }),
          moneyFormula('=D17*0.1', '180'),
        ],
        [
          cell('Total due', { b: true, al: 'right', bg: HEAD_BG }),
          styled(moneyFormula('=D17+D18', '1980'), { b: true, bg: HEAD_BG }),
        ],
      ]),
      ...rows('A21', [[note('Payment terms: net 30. Thank you.')]]),
    },
  },
};

const pct = (f: string, v: string) => formula(f, v, { nf: 'percent' });

/** A derived figure read beside the table rather than as part of it. */
const aside = (c: Cell): Cell => styled(c, { i: true, tc: NOTE_TC });

const regionalSalesReport: TemplateSeed = {
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
          thr('Q1'),
          thr('Q2'),
          thr('Q3'),
          thr('Q4'),
          thr('Year total'),
          thr('Share'),
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
          total(cell('Total')),
          total(moneyFormula('=SUM(B2:B5)', '161500')),
          total(moneyFormula('=SUM(C2:C5)', '169100')),
          total(moneyFormula('=SUM(D2:D5)', '179900')),
          total(moneyFormula('=SUM(E2:E5)', '192400')),
          total(moneyFormula('=SUM(F2:F5)', '702900')),
          total(pct('=SUM(G2:G5)', '1')),
        ],
        [
          note('Change vs previous quarter'),
          cell(''),
          aside(pct('=C6/B6-1', '0.04705882352941182')),
          aside(pct('=D6/C6-1', '0.06386753400354817')),
          aside(pct('=E6/D6-1', '0.06948304613674261')),
          cell(''),
          cell(''),
        ],
      ]),
      ...rows('A9', [
        [cell('How to use', { b: true })],
        [
          note(
            'Rename the regions to your own territories, teams or products, and type each quarter’s revenue.',
          ),
        ],
        [
          note(
            'Need another region? Insert a row above West and copy the Year total and Share formulas into it, so every sum picks it up.',
          ),
        ],
      ]),
    },
  },
};

const teamDirectory: TemplateSeed = {
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
        [th('Summary'), thr('Count')],
        [wash(cell('People listed')), wash(formula('=COUNTA(A2:A200)', '3'))],
      ]),
      ...rows('I4', [
        [note('One row per person; sort by Team.')],
        [note('Ask me about: what to come to them for.')],
      ]),
    },
  },
};

const sharedExpenseSplitter: TemplateSeed = {
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
        [th('Item'), th('Category'), th('Paid by'), thr('Amount'), th('Notes')],
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
        [th('Flatmate'), thr('Paid'), thr('Fair share'), thr('Balance')],
        [
          wash(cell('Flatmate 1')),
          wash(moneyFormula('=SUMIF($C$2:$C$200,G2,$D$2:$D$200)', '2238')),
          wash(moneyFormula('=SUM($D$2:$D$200)/COUNTA($G$2:$G$4)', '864')),
          wash(moneyFormula('=H2-I2', '1374')),
        ],
        [
          wash(cell('Flatmate 2')),
          wash(moneyFormula('=SUMIF($C$2:$C$200,G3,$D$2:$D$200)', '280')),
          wash(moneyFormula('=SUM($D$2:$D$200)/COUNTA($G$2:$G$4)', '864')),
          wash(moneyFormula('=H3-I3', '-584')),
        ],
        [
          wash(cell('Flatmate 3')),
          wash(moneyFormula('=SUMIF($C$2:$C$200,G4,$D$2:$D$200)', '74')),
          wash(moneyFormula('=SUM($D$2:$D$200)/COUNTA($G$2:$G$4)', '864')),
          wash(moneyFormula('=H4-I4', '-790')),
        ],
        [
          wash(total(cell('Total'))),
          wash(total(moneyFormula('=SUM(H2:H4)', '2592'))),
          wash(total(moneyFormula('=SUM(I2:I4)', '2592'))),
          wash(total(moneyFormula('=SUM(J2:J4)', '0'))),
        ],
      ]),
      ...rows('G7', [
        [cell('How to read it', { b: true })],
        [
          note(
            'Positive balance: the flat owes you. Negative: you owe the flat.',
          ),
        ],
        [
          note(
            'Rename flatmates here; a "Paid by" name must match exactly to count.',
          ),
        ],
        [
          note(
            'Settled up? Duplicate the tab for next month and clear the expense rows.',
          ),
        ],
        [
          note(
            'Another flatmate? Insert a row above Flatmate 3 and copy its formulas.',
          ),
        ],
      ]),
    },
  },
};

/** This file's templates, in gallery order — `../index.ts` concatenates them. */
export const seeds: TemplateSeed[] = [
  monthlyBudgetTracker,
  sprintTaskTracker,
  contentCalendar,
  invoice,
  regionalSalesReport,
  teamDirectory,
  sharedExpenseSplitter,
];

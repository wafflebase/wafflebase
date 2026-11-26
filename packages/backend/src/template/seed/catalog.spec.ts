import {
  assertValidDocsBody,
  assertValidNoteBody,
  assertValidSlidesBody,
} from '../../api/v1/docs-content.controller';
import { TEMPLATE_CATALOG } from './catalog';
import { seedDocumentId } from './seed-templates';

/**
 * The catalogue's contract with the rest of the product.
 *
 * The point of running the **real** validators here rather than re-asserting
 * a shape by hand is that they are the ones `PUT /documents/:id/content`
 * applies. A seed that passes here is a payload the product's own write path
 * accepts; a second copy of the contract in this file would drift from it and
 * the drift would surface half-way through a seed run against a live
 * deployment instead of in CI.
 */

import {
  createWorksheet,
  getWorksheetCell,
  parseRef,
  replaceWorksheetCells,
} from '@wafflebase/sheets';
import { ALL_CATEGORY_SLUGS } from '../template-taxonomy';

describe('template seed catalogue', () => {
  it('is not empty', () => {
    expect(TEMPLATE_CATALOG.length).toBeGreaterThan(0);
  });

  it('has unique slugs', () => {
    const slugs = TEMPLATE_CATALOG.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  // A slug is the seed's identity (it derives the document id below), so the
  // shape is fixed once, here, rather than left to taste: lower kebab case, a
  // `.ko` suffix for a Korean variant, short enough to read in a URL.
  it.each(TEMPLATE_CATALOG.map((s) => [s.slug] as const))(
    'slug %s is lower kebab case, at most 48 characters',
    (slug) => {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*(\.ko)?$/);
      expect(slug.length).toBeLessThanOrEqual(48);
    },
  );

  // The catalogue's order as it stood when registration moved to one import
  // per file. New templates append after it; nothing listed here may be
  // renamed, dropped or reordered — a re-run finds each document by its slug.
  it('keeps the existing templates in their order', () => {
    const pinned = [
      'weekly-business-review',
      'project-kickoff',
      'sprint-retrospective',
      'okr-review',
      'product-launch-plan',
      'tech-talk-paper-study',
      'product-roadmap',
      'seminar-deck',
      'university-lecture',
      'student-presentation',
      'workshop-training',
      'dev-design-review',
      'project-proposal',
      'all-hands-update',
      'case-study',
      'customer-onboarding-review',
      'marketing-campaign',
      'brand-pitch',
      'equity-analysis',
      'design-review-ux',
      'monthly-budget-tracker',
      'sprint-task-tracker',
      'content-calendar',
      'invoice',
      'regional-sales-report',
      'team-directory',
      'shared-expense-splitter',
      'product-requirements-doc',
      'meeting-notes',
      'partner-newsletter',
      'vendor-onboarding',
      'weekly-one-on-one',
      'site-visit-notes',
      'retrospective-board',
      'board-retro-start-stop-continue',
      'board-brainstorm-affinity-map',
      'board-weekly-team-sync',
      'board-pricing-workshop',
    ];
    expect(TEMPLATE_CATALOG.slice(0, pinned.length).map((s) => s.slug)).toEqual(
      pinned,
    );
  });

  it('maps every slug to a distinct, stable document id', () => {
    const ids = TEMPLATE_CATALOG.map((s) => seedDocumentId(s.slug));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
    // Pinned to a literal, not to another call of the same function — that
    // holds for any pure function and proves nothing. The property worth
    // guarding is that the derivation never *changes*: it is how a re-run
    // finds the document it created last time, so altering it orphans every
    // document already seeded on every deployment.
    expect(seedDocumentId('weekly-business-review')).toBe(
      '88d23516-225e-5b7c-911a-ea882d767f70',
    );
  });

  it.each(TEMPLATE_CATALOG.map((s) => [s.slug, s] as const))(
    '%s carries listing metadata the gallery can show',
    (_slug, seed) => {
      expect(seed.title.trim()).not.toBe('');
      expect(seed.description.trim()).not.toBe('');
      expect(ALL_CATEGORY_SLUGS).toContain(seed.category);
      // Seeds are filed under their most precise leaf, never a bare top: a
      // top is the fallback for a listing that fits no leaf, and the catalog
      // is authored to fit.
      expect(seed.category).toContain('/');
      expect(seed.tags.length).toBeGreaterThan(0);
      for (const tag of seed.tags) expect(tag.trim()).not.toBe('');
    },
  );

  it.each(TEMPLATE_CATALOG.map((s) => [s.slug, s] as const))(
    '%s content is a payload the v1 write path accepts',
    (_slug, seed) => {
      const content = seed.content;
      if (content.kind === 'doc') {
        expect(() => assertValidDocsBody(content.document)).not.toThrow();
        return;
      }
      if (content.kind === 'slides') {
        expect(() => assertValidSlidesBody(content.document)).not.toThrow();
        return;
      }
      if (content.kind === 'note') {
        expect(() => assertValidNoteBody(content.document)).not.toThrow();
        return;
      }
      if (content.kind === 'board') {
        expect(content.root.meta.title.trim()).not.toBe('');
        expect(content.root.elements.length).toBeGreaterThan(0);
        for (const el of content.root.elements) {
          expect(el.id).not.toBe('');
          // The renderer reads all four unconditionally, and a board has no
          // layout to fall back on the way a slide does.
          for (const side of ['x', 'y', 'w', 'h'] as const) {
            expect(Number.isFinite(el.frame[side])).toBe(true);
          }
          expect(el.frame.w).toBeGreaterThan(0);
          expect(el.frame.h).toBeGreaterThan(0);
        }
        return;
      }
      // sheet
      expect(content.tabName.trim()).not.toBe('');
      expect(Object.keys(content.cells).length).toBeGreaterThan(0);
      for (const ref of Object.keys(content.cells)) {
        expect(ref).toMatch(/^[A-Z]+[0-9]+$/);
      }
    },
  );

  it('caches a value on every formula cell', () => {
    // Nothing recalculates a formula until an editor session opens the
    // document, and a template is previewed far more often than it is opened.
    // A formula with no cached `v` reads as an empty column on the one screen
    // that decides whether somebody uses the template.
    for (const seed of TEMPLATE_CATALOG) {
      if (seed.content.kind !== 'sheet') continue;
      for (const [ref, c] of Object.entries(seed.content.cells)) {
        if (!c.f) continue;
        expect(`${seed.slug}!${ref} v=${c.v ?? ''}`).toMatch(/v=.+$/);
      }
    }
  });

  /**
   * The cached values above are hand-written, so they can drift the moment
   * somebody edits a sample number and forgets the total under it.
   *
   * These re-derive each total from the seed's own data rather than
   * re-implementing a formula evaluator: `Sheet` is not exported from
   * `@wafflebase/sheets`, and reaching past that boundary to run the real
   * calculator here would be worse than checking the arithmetic that the
   * sample data actually asserts.
   */
  describe('cached totals match the sample data they summarise', () => {
    const seedBySlug = (slug: string) => {
      const seed = TEMPLATE_CATALOG.find((s) => s.slug === slug);
      if (!seed || seed.content.kind !== 'sheet') {
        throw new Error(`${slug} is not a sheet seed`);
      }
      return seed.content.cells;
    };
    const num = (cells: Record<string, { v?: string }>, ref: string) =>
      Number(cells[ref]?.v ?? NaN);

    it('monthly-budget-tracker', () => {
      const c = seedBySlug('monthly-budget-tracker');
      let planned = 0;
      let actual = 0;
      for (let row = 2; row <= 8; row++) {
        const p = num(c, `B${row}`);
        const a = num(c, `C${row}`);
        planned += p;
        actual += a;
        expect(num(c, `D${row}`)).toBe(p - a);
      }
      expect(num(c, 'B10')).toBe(planned);
      expect(num(c, 'C10')).toBe(actual);
      expect(num(c, 'D10')).toBe(planned - actual);
    });

    it('invoice', () => {
      const c = seedBySlug('invoice');
      let subtotal = 0;
      for (const row of [12, 13]) {
        const amount = num(c, `B${row}`) * num(c, `C${row}`);
        expect(num(c, `D${row}`)).toBe(amount);
        subtotal += amount;
      }
      expect(num(c, 'D17')).toBe(subtotal);
      expect(num(c, 'D18')).toBeCloseTo(subtotal * 0.1, 6);
      expect(num(c, 'D19')).toBeCloseTo(subtotal * 1.1, 6);
    });

    it('sprint-task-tracker', () => {
      const c = seedBySlug('sprint-task-tracker');
      const statuses = Object.entries(c)
        .filter(([ref]) => /^C([2-9]|[1-4][0-9]|50)$/.test(ref))
        .map(([, v]) => v.v);
      const counted: Record<string, string> = {
        'To do': 'I2',
        'In progress': 'I3',
        Blocked: 'I4',
        Done: 'I5',
      };
      for (const [status, ref] of Object.entries(counted)) {
        expect(num(c, ref)).toBe(statuses.filter((s) => s === status).length);
      }
      const sum = (col: string) =>
        Object.entries(c)
          .filter(([ref]) =>
            new RegExp(`^${col}([2-9]|[1-4][0-9]|50)$`).test(ref),
          )
          .reduce((acc, [, v]) => acc + Number(v.v ?? 0), 0);
      expect(num(c, 'I6')).toBe(sum('D'));
      expect(num(c, 'I7')).toBe(sum('E'));
    });

    it('content-calendar', () => {
      const c = seedBySlug('content-calendar');
      const statuses = Object.entries(c)
        .filter(([ref]) => /^E([2-9]|[1-9][0-9]|100)$/.test(ref))
        .map(([, v]) => v.v);
      for (const [status, ref] of Object.entries({
        Idea: 'I2',
        Draft: 'I3',
        Published: 'I4',
      })) {
        expect(num(c, ref)).toBe(statuses.filter((s) => s === status).length);
      }
    });

    it('regional-sales-report', () => {
      const c = seedBySlug('regional-sales-report');
      const cols = ['B', 'C', 'D', 'E'];
      let year = 0;
      for (let row = 2; row <= 5; row++) {
        const total = cols.reduce(
          (acc, col) => acc + num(c, `${col}${row}`),
          0,
        );
        expect(num(c, `F${row}`)).toBe(total);
        year += total;
      }
      for (const col of cols) {
        let quarter = 0;
        for (let row = 2; row <= 5; row++) quarter += num(c, `${col}${row}`);
        expect(num(c, `${col}6`)).toBe(quarter);
      }
      expect(num(c, 'F6')).toBe(year);
      for (let row = 2; row <= 5; row++) {
        expect(num(c, `G${row}`)).toBeCloseTo(num(c, `F${row}`) / year, 12);
      }
      for (const [col, prev] of [
        ['C', 'B'],
        ['D', 'C'],
        ['E', 'D'],
      ]) {
        expect(num(c, `${col}7`)).toBeCloseTo(
          num(c, `${col}6`) / num(c, `${prev}6`) - 1,
          12,
        );
      }
    });

    it('team-directory', () => {
      const c = seedBySlug('team-directory');
      const people = Object.entries(c).filter(
        ([ref, v]) => /^A([2-9]|[1-9][0-9]|1[0-9][0-9]|200)$/.test(ref) && v.v,
      ).length;
      expect(num(c, 'J2')).toBe(people);
    });

    it('shared-expense-splitter', () => {
      const c = seedBySlug('shared-expense-splitter');
      const expenses = Object.entries(c).filter(([ref]) =>
        /^C([2-9]|[1-9][0-9]|1[0-9][0-9]|200)$/.test(ref),
      );
      const total = expenses.reduce(
        (acc, [ref]) => acc + num(c, `D${ref.slice(1)}`),
        0,
      );
      const share = total / 3;
      for (let row = 2; row <= 4; row++) {
        const who = c[`G${row}`]?.v;
        const paid = expenses
          .filter(([, v]) => v.v === who)
          .reduce((acc, [ref]) => acc + num(c, `D${ref.slice(1)}`), 0);
        expect(num(c, `H${row}`)).toBe(paid);
        expect(num(c, `I${row}`)).toBe(share);
        expect(num(c, `J${row}`)).toBe(paid - share);
      }
      expect(num(c, 'H5')).toBe(total);
      expect(num(c, 'J5')).toBe(0);
    });
  });

  it('rebuilds a worksheet rather than merging into it', () => {
    // `--force-content` re-writes a document that already holds the previous
    // catalogue. `updateWorksheetCell` per cell would leave anything a
    // revision *removed* sitting there, so the sheet on screen would match no
    // version of the catalogue while the run still reported `rewritten`.
    // The other four kinds go through whole-root writers that replace; this
    // pins that sheets do too.
    const ws = createWorksheet();
    replaceWorksheetCells(ws, [[parseRef('A1'), { v: 'stale' }]]);
    expect(getWorksheetCell(ws, parseRef('A1'))?.v).toBe('stale');

    const budget = TEMPLATE_CATALOG.find(
      (s) => s.slug === 'monthly-budget-tracker',
    );
    if (!budget || budget.content.kind !== 'sheet') throw new Error('missing');
    replaceWorksheetCells(
      ws,
      Object.entries(budget.content.cells).map(
        ([ref, cell]) => [parseRef(ref), cell] as const,
      ),
    );

    // A1 is a header in this catalogue entry, so it is overwritten rather than
    // dropped — the cell that proves removal is one the catalogue never names.
    expect(getWorksheetCell(ws, parseRef('A1'))?.v).toBe('Category');
    replaceWorksheetCells(ws, [[parseRef('Z99'), { v: 'orphan' }]]);
    expect(getWorksheetCell(ws, parseRef('A1'))).toBeUndefined();
  });

  it('gives every element on a board a unique id', () => {
    for (const seed of TEMPLATE_CATALOG) {
      if (seed.content.kind !== 'board') continue;
      const ids = seed.content.root.elements.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('gives every slide and element in a deck a unique id', () => {
    for (const seed of TEMPLATE_CATALOG) {
      if (seed.content.kind !== 'slides') continue;
      const slideIds = seed.content.document.slides.map((s) => s.id);
      expect(new Set(slideIds).size).toBe(slideIds.length);
      for (const slide of seed.content.document.slides) {
        const ids = slide.elements.map((e) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('gives every docs block a unique id', () => {
    for (const seed of TEMPLATE_CATALOG) {
      if (seed.content.kind !== 'doc') continue;
      const ids = seed.content.document.blocks.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

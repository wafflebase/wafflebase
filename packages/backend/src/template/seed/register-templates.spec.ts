import { approvalFor, documentPath, refileFor } from './register-templates';
import type { TemplateSeed } from './types';

const SEED: TemplateSeed = {
  slug: 'budget',
  title: 'Budget',
  description: 'Track spending.',
  category: 'finance/budget',
  tags: ['budget'],
  content: { kind: 'sheet', tabName: 'Budget', cells: {} },
};

const WATERMARK = new Date('2026-11-01T00:00:00.000Z');

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    status: 'listed',
    visibility: 'public',
    contentChangedAt: WATERMARK,
    reviewedContentAt: WATERMARK,
    title: SEED.title,
    description: SEED.description,
    category: SEED.category,
    tags: SEED.tags,
    ...overrides,
  } as Parameters<typeof refileFor>[0];
}

/**
 * Approval is by listing id, never by a title read off the queue page: the
 * page shows the 100 oldest submissions and no id, so a seed's own row could
 * be cut off while a stranger's identically titled submission matched.
 */
describe('approvalFor', () => {
  it('approves exactly the listing it was given, echoing its watermark', () => {
    expect(approvalFor(listing({ status: 'pending' }))).toEqual({
      id: 'listing-1',
      dto: { decision: 'approve', contentAt: WATERMARK.toISOString() },
    });
  });

  it('echoes an absent watermark as absent, which review() compares as one', () => {
    expect(
      approvalFor(listing({ status: 'pending', contentChangedAt: null })),
    ).toEqual({ id: 'listing-1', dto: { decision: 'approve' } });
  });

  it.each(['listed', 'rejected', 'removed'])(
    'refuses a %s listing — only a submission awaiting review is approved',
    (status) => {
      expect(() => approvalFor(listing({ status }))).toThrow(/not pending/);
    },
  );
});

describe('refileFor', () => {
  it('leaves a listing whose card matches the catalogue alone', () => {
    expect(refileFor(listing(), SEED)).toEqual({ action: 'none' });
  });

  it('re-files a public listing whose category moved to a leaf', () => {
    expect(refileFor(listing({ category: 'Finance' }), SEED)).toEqual({
      action: 'refile',
      drift: { category: SEED.category },
    });
  });

  it.each([
    ['pending', 'public'],
    ['rejected', 'public'],
    ['listed', 'unlisted'],
  ])('leaves a %s/%s listing for a person', (status, visibility) => {
    const plan = refileFor(
      listing({ category: 'Finance', status, visibility }),
      SEED,
    );
    expect(plan).toMatchObject({ action: 'skip' });
  });

  it('will not re-approve content that changed since it was approved', () => {
    const plan = refileFor(
      listing({
        category: 'Finance',
        contentChangedAt: new Date('2026-11-02T00:00:00.000Z'),
      }),
      SEED,
    );
    expect(plan).toMatchObject({ action: 'skip' });
    expect((plan as { reason: string }).reason).toMatch(/content changed/);
  });

  it('treats a never-edited listing (no watermark on either side) as reviewed', () => {
    const plan = refileFor(
      listing({
        category: 'Finance',
        contentChangedAt: null,
        reviewedContentAt: null,
      }),
      SEED,
    );
    expect(plan).toMatchObject({ action: 'refile' });
  });
});

describe('documentPath', () => {
  it('uses the shared editor routes', () => {
    expect(documentPath('id', 'sheet')).toBe('/s/id');
    expect(documentPath('id', 'doc')).toBe('/d/id');
    expect(documentPath('id', 'board')).toBe('/b/id');
    expect(documentPath('id', 'slides')).toBe('/p/id');
    expect(documentPath('id', 'note')).toBe('/n/id');
  });
});

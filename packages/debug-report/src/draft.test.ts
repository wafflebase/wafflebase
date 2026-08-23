import { describe, expect, it } from 'vitest';
import {
  detachItem,
  DRAFT_SCHEMA,
  MAX_GROUP_ITEMS,
  MAX_SESSION_PRS,
  mergeGroups,
  parseDraftResult,
  splitGroup,
  ungrouped,
  withinSessionCap,
} from './draft';
import type { ProposedGroup } from './types';

const draft = (itemId: string, kind = 'spacing', title = `fix ${itemId}`) => ({
  itemId,
  title,
  body: 'The icon row has no gap.',
  severity: 'minor',
  kind,
  labels: ['ui'],
});

const ids = [
  { id: 'i1', note: 'the toolbar is cramped' },
  { id: 'i2', note: 'the label wraps' },
  { id: 'i3', note: 'the icon is off-centre' },
];

const titleOf = (itemId: string) => `title for ${itemId}`;

describe('DRAFT_SCHEMA', () => {
  it('requires the fields the panel renders', () => {
    expect(DRAFT_SCHEMA.required).toEqual(['drafts', 'proposedGroups']);
    expect(DRAFT_SCHEMA.properties.drafts.items.required).toContain('itemId');
    expect(DRAFT_SCHEMA.properties.drafts.items.required).toContain('kind');
  });
});

describe('parseDraftResult', () => {
  it('accepts a well-formed response and keeps the proposed grouping', () => {
    const result = parseDraftResult(
      {
        drafts: [draft('i1'), draft('i2')],
        proposedGroups: [
          { id: 'g1', kind: 'spacing', itemIds: ['i1', 'i2'], prTitle: 'Room to breathe' },
        ],
      },
      ids,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.drafts).toHaveLength(2);
    expect(result.result.proposedGroups[0]).toMatchObject({
      itemIds: ['i1', 'i2'],
      prTitle: 'Room to breathe',
    });
  });

  it('rejects a response that is not the schema', () => {
    expect(parseDraftResult('not json', ids).ok).toBe(false);
    expect(parseDraftResult({ drafts: 'nope' }, ids).ok).toBe(false);
    expect(parseDraftResult({ drafts: [], proposedGroups: 'nope' }, ids).ok).toBe(false);
  });

  it('rejects a draft with a severity or kind off the scale', () => {
    expect(
      parseDraftResult({ drafts: [{ ...draft('i1'), severity: 'blocker' }], proposedGroups: [] }, ids).ok,
    ).toBe(false);
    expect(
      parseDraftResult({ drafts: [{ ...draft('i1'), kind: 'vibes' }], proposedGroups: [] }, ids).ok,
    ).toBe(false);
  });

  it('DROPS a draft for an unknown item instead of failing the whole response', () => {
    // One hallucinated id must not cost the reporter the nine good drafts they
    // were waiting for — but the drop has to be visible.
    const result = parseDraftResult(
      { drafts: [draft('i1'), draft('ghost')], proposedGroups: [] },
      ids,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.drafts.map((d) => d.itemId)).toEqual(['i1']);
    expect(result.dropped.join()).toMatch(/ghost/);
  });

  it('drops a second draft for the same item', () => {
    const result = parseDraftResult({ drafts: [draft('i1'), draft('i1')], proposedGroups: [] }, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.drafts).toHaveLength(1);
    expect(result.dropped.join()).toMatch(/drafted twice/);
  });

  it('gives every undrafted-but-grouped item its own PR and says so', () => {
    const result = parseDraftResult(
      {
        drafts: [draft('i1')],
        proposedGroups: [{ id: 'g1', kind: 'spacing', itemIds: ['i1', 'i2'], prTitle: 'Both' }],
      },
      ids,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.proposedGroups[0].itemIds).toEqual(['i1']);
    expect(result.dropped.join()).toMatch(/i2 \(grouped but not drafted\)/);
  });

  it('keeps an item in the first group that claims it', () => {
    const result = parseDraftResult(
      {
        drafts: [draft('i1'), draft('i2')],
        proposedGroups: [
          { id: 'g1', kind: 'spacing', itemIds: ['i1'], prTitle: 'A' },
          { id: 'g2', kind: 'spacing', itemIds: ['i1', 'i2'], prTitle: 'B' },
        ],
      },
      ids,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // `i3` is in `ids` and undrafted, so the coverage rule gives it its own PR.
    expect(result.result.proposedGroups.map((g) => g.itemIds)).toEqual([
      ['i1'],
      ['i2'],
      ['i3'],
    ]);
    expect(result.dropped.join()).toMatch(/claimed by two groups/);
  });

  it('splits a logic item out of a group it was proposed into', () => {
    // One blocked behaviour fix must not hold up a spacing cleanup.
    const result = parseDraftResult(
      {
        drafts: [draft('i1'), draft('i2', 'logic')],
        proposedGroups: [
          { id: 'g1', kind: 'spacing', itemIds: ['i1', 'i2'], prTitle: 'Mixed' },
        ],
      },
      ids,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byItems = result.result.proposedGroups.map((g) => g.itemIds);
    expect(byItems).toEqual([['i1'], ['i2'], ['i3']]);
  });

  it('gives every ungrouped item its own PR', () => {
    const result = parseDraftResult({ drafts: [draft('i1'), draft('i2')], proposedGroups: [] }, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.proposedGroups).toHaveLength(3);
    expect(result.result.proposedGroups[0].prTitle).toBe('fix i1');
  });

  it('gives an item the model never mentioned its own PR, titled from the note', () => {
    // WITHHELD BEFORE THIS: `handOver` sends only items that appear in a group,
    // so an undrafted item travelled nowhere while still counting toward the
    // "N reports" the panel showed — reported as neither sent nor queued.
    const result = parseDraftResult(
      { drafts: [draft('i1')], proposedGroups: [] },
      ids,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const solo = result.result.proposedGroups.find((g) => g.itemIds[0] === 'i2');
    expect(solo).toMatchObject({ kind: 'logic', prTitle: 'the label wraps' });
    expect(result.dropped.join()).toMatch(/i2 \(not drafted\)/);
  });

  it('covers every item exactly once, drafted or not', () => {
    const result = parseDraftResult(
      {
        drafts: [draft('i1'), draft('i2')],
        proposedGroups: [
          { id: 'g1', kind: 'spacing', itemIds: ['i1', 'i2'], prTitle: 'Both' },
        ],
      },
      ids,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const covered = result.result.proposedGroups.flatMap((g) => g.itemIds);
    expect(covered.slice().sort()).toEqual(['i1', 'i2', 'i3']);
    expect(new Set(covered).size).toBe(covered.length);
  });

  it('caps a group at the item limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => `m${i}`);
    const manyItems = many.map((id) => ({ id, note: `note ${id}` }));
    const result = parseDraftResult(
      {
        drafts: many.map((id) => draft(id)),
        proposedGroups: [{ id: 'g1', kind: 'spacing', itemIds: many, prTitle: 'All' }],
      },
      manyItems,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.proposedGroups[0].itemIds).toHaveLength(MAX_GROUP_ITEMS);
    // The overflow is not lost — it becomes its own PR.
    const total = result.result.proposedGroups.flatMap((g) => g.itemIds);
    expect(new Set(total).size).toBe(12);
  });

  it('makes group ids unique so the reporter can address them', () => {
    const result = parseDraftResult(
      {
        drafts: [draft('i1'), draft('i2')],
        proposedGroups: [
          { id: 'same', kind: 'spacing', itemIds: ['i1'], prTitle: 'A' },
          { id: 'same', kind: 'spacing', itemIds: ['i2'], prTitle: 'B' },
        ],
      },
      ids,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const groupIds = result.result.proposedGroups.map((g) => g.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);
  });
});

describe('ungrouped', () => {
  it('is one item per PR, which is the no-credential path', () => {
    const groups = ungrouped([
      { id: 'i1', note: 'the toolbar is cramped' },
      { id: 'i2', note: 'undo goes one step short' },
    ]);
    expect(groups.map((g) => g.itemIds)).toEqual([['i1'], ['i2']]);
    expect(groups[0].prTitle).toBe('the toolbar is cramped');
  });
});

describe('the reporter’s three operations', () => {
  const grouped: ProposedGroup[] = [
    { id: 'g1', kind: 'spacing', itemIds: ['i1', 'i2', 'i3'], prTitle: 'Spacing' },
    { id: 'g2', kind: 'logic', itemIds: ['i4'], prTitle: 'Undo' },
  ];

  describe('detachItem', () => {
    it('pulls one item into its own PR', () => {
      const out = detachItem(grouped, 'i2', titleOf);
      expect(out.find((g) => g.id === 'g1')?.itemIds).toEqual(['i1', 'i3']);
      expect(out.find((g) => g.itemIds.includes('i2'))?.itemIds).toEqual(['i2']);
    });

    it('leaves a single-item group alone', () => {
      expect(detachItem(grouped, 'i4', titleOf)).toEqual(grouped);
    });

    it('ignores an unknown item', () => {
      expect(detachItem(grouped, 'nope', titleOf)).toEqual(grouped);
    });
  });

  describe('splitGroup', () => {
    it('breaks a group into one PR per item', () => {
      const out = splitGroup(grouped, 'g1', titleOf);
      expect(out.map((g) => g.itemIds)).toEqual([['i1'], ['i2'], ['i3'], ['i4']]);
    });

    it('leaves a single-item group and an unknown group alone', () => {
      expect(splitGroup(grouped, 'g2', titleOf)).toEqual(grouped);
      expect(splitGroup(grouped, 'nope', titleOf)).toEqual(grouped);
    });
  });

  describe('mergeGroups', () => {
    it('merges and keeps the first group’s identity', () => {
      const { groups, warning } = mergeGroups(
        [
          { id: 'a', kind: 'spacing', itemIds: ['i1'], prTitle: 'A' },
          { id: 'b', kind: 'spacing', itemIds: ['i2'], prTitle: 'B' },
        ],
        'a',
        'b',
      );
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({ id: 'a', itemIds: ['i1', 'i2'], prTitle: 'A' });
      expect(warning).toBeUndefined();
    });

    it('WARNS but does not block a cross-kind merge', () => {
      // The reporter knows things the rules do not, and a tool that silently
      // overrides its user teaches them to distrust it.
      const { groups, warning } = mergeGroups(grouped, 'g1', 'g2');
      expect(groups).toHaveLength(1);
      expect(groups[0].itemIds).toEqual(['i1', 'i2', 'i3', 'i4']);
      expect(warning).toMatch(/different kinds/);
      expect(warning).toMatch(/behaviour fix/);
    });

    it('warns when the merge exceeds the group cap', () => {
      const big = Array.from({ length: 8 }, (_, i) => `b${i}`);
      const { warning } = mergeGroups(
        [
          { id: 'a', kind: 'spacing', itemIds: big, prTitle: 'A' },
          { id: 'b', kind: 'spacing', itemIds: ['x'], prTitle: 'B' },
        ],
        'a',
        'b',
      );
      expect(warning).toMatch(new RegExp(`${MAX_GROUP_ITEMS}-item limit`));
    });

    it('is a no-op for unknown or identical groups', () => {
      expect(mergeGroups(grouped, 'g1', 'g1').groups).toEqual(grouped);
      expect(mergeGroups(grouped, 'g1', 'nope').groups).toEqual(grouped);
    });
  });
});

describe('withinSessionCap', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({
    id: `g${i}`,
    kind: 'spacing' as const,
    itemIds: [`i${i}`],
    prTitle: `P${i}`,
  }));

  it('queues the overflow instead of dropping it', () => {
    const { send, queued } = withinSessionCap(many);
    expect(send).toHaveLength(MAX_SESSION_PRS);
    expect(queued).toHaveLength(7 - MAX_SESSION_PRS);
  });

  it('sends everything when it fits', () => {
    const { send, queued } = withinSessionCap(many.slice(0, 3));
    expect(send).toHaveLength(3);
    expect(queued).toEqual([]);
  });
});

describe('parseDraftResult · homogeneity', () => {
  it('reduces a mixed group to one kind, and gives the rest their own PRs', () => {
    // Nothing compared one member's kind to another's, so a `layout` item —
    // which groups only by file — could ride along inside a spacing PR.
    const result = parseDraftResult(
      {
        drafts: [draft('i1', 'spacing'), draft('i2', 'copy'), draft('i3', 'layout')],
        proposedGroups: [
          { id: 'g1', kind: 'spacing', itemIds: ['i1', 'i2', 'i3'], prTitle: 'Mixed' },
        ],
      },
      ['i1', 'i2', 'i3'].map((id) => ({ id, note: `note ${id}` })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byKind = result.result.proposedGroups.map((g) => [g.kind, g.itemIds] as const);
    expect(byKind).toEqual([
      ['spacing', ['i1']],
      ['copy', ['i2']],
      ['layout', ['i3']],
    ]);
  });

  it('takes the group’s kind from its members, not from the model’s label', () => {
    // The label is what the pipeline routes on: a spacing cleanup labelled
    // `logic` would go down the behaviour-fix path.
    const result = parseDraftResult(
      {
        drafts: [draft('i1', 'spacing'), draft('i2', 'spacing')],
        proposedGroups: [
          { id: 'g1', kind: 'logic', itemIds: ['i1', 'i2'], prTitle: 'Mislabelled' },
        ],
      },
      ['i1', 'i2'].map((id) => ({ id, note: `note ${id}` })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.proposedGroups).toHaveLength(1);
    expect(result.result.proposedGroups[0].kind).toBe('spacing');
  });

  it('keeps a layout item out of any group', () => {
    const result = parseDraftResult(
      {
        drafts: [draft('i1', 'layout'), draft('i2', 'layout')],
        proposedGroups: [
          { id: 'g1', kind: 'layout', itemIds: ['i1', 'i2'], prTitle: 'Structural' },
        ],
      },
      ['i1', 'i2'].map((id) => ({ id, note: `note ${id}` })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.proposedGroups.map((g) => g.itemIds)).toEqual([['i1'], ['i2']]);
  });
});

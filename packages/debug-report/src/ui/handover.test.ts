import { describe, expect, it, vi } from 'vitest';
import type { Bundle, DebugItem, Environment, ProposedGroup } from '../index';
import { MAX_SESSION_PRS } from '../index';
import { handOver, handoverReport, handoverSummary, liveGroups, requestDrafts } from './handover';

const env: Environment = {
  route: '/s/:id',
  viewport: { w: 1280, h: 800 },
  dpr: 2,
  theme: 'light',
  userAgent: 'test',
};

const item = (id: string, overrides: Partial<DebugItem> = {}): DebugItem => ({
  id,
  createdAt: 1,
  note: `note ${id}`,
  target: { kind: 'viewport', rect: { x: 0, y: 0, w: 10, h: 10 } },
  disposition: 'verify',
  agentCandidate: false,
  ...overrides,
});

const draft = (itemId: string, kind = 'spacing') => ({
  itemId,
  title: `fix ${itemId}`,
  body: 'body',
  severity: 'minor',
  kind,
  labels: ['ui'],
});

describe('requestDrafts', () => {
  it('returns the drafts and the proposed grouping', async () => {
    const outcome = await requestDrafts(
      {
        draft: async () => ({
          drafts: [draft('a'), draft('b')],
          proposedGroups: [
            { id: 'g1', kind: 'spacing', itemIds: ['a', 'b'], prTitle: 'Room to breathe' },
          ],
        }),
      } as never,
      [item('a'), item('b')],
    );
    expect(outcome.state.status).toBe('ready');
    expect(outcome.drafts.get('a')?.title).toBe('fix a');
    expect(outcome.groups[0].itemIds).toEqual(['a', 'b']);
  });

  it('degrades to one PR per item when there is no credential', async () => {
    // Drafting is an accelerator, never a dependency: the batch still goes.
    const outcome = await requestDrafts(
      { draft: async () => { throw new Error('not-configured: no model credential'); } } as never,
      [item('a'), item('b')],
    );
    expect(outcome.state).toMatchObject({ status: 'unavailable', reason: 'not-configured' });
    expect(outcome.drafts.size).toBe(0);
    expect(outcome.groups.map((g) => g.itemIds)).toEqual([['a'], ['b']]);
  });

  it('distinguishes a failure from a missing credential', async () => {
    // One is an instruction, the other is a retry.
    const outcome = await requestDrafts(
      { draft: async () => { throw new Error('the dev server did not answer'); } } as never,
      [item('a')],
    );
    expect(outcome.state).toMatchObject({ status: 'unavailable', reason: 'failed' });
  });

  it('refuses a malformed draft rather than rendering half of it', async () => {
    const outcome = await requestDrafts(
      { draft: async () => ({ drafts: [{ ...draft('a'), severity: 'blocker' }], proposedGroups: [] }) } as never,
      [item('a')],
    );
    expect(outcome.state).toMatchObject({ status: 'unavailable', reason: 'malformed' });
    expect(outcome.groups).toHaveLength(1);
  });

  it('reports the drafts that were dropped', async () => {
    const outcome = await requestDrafts(
      { draft: async () => ({ drafts: [draft('a'), draft('ghost')], proposedGroups: [] }) } as never,
      [item('a')],
    );
    expect(outcome.state).toMatchObject({ status: 'ready', drafted: 1 });
    if (outcome.state.status === 'ready') {
      expect(outcome.state.dropped.join()).toMatch(/ghost/);
    }
  });
});

describe('handOver', () => {
  const host = (send = vi.fn(async () => ({ ok: true as const, ref: '.wb-reports/s1' }))) => ({
    send,
    environment: () => env,
  });

  const store = (captures: Record<string, string> = {}) => ({
    getCapture: async (id: string) => captures[id],
  });

  const capture = (id: string) => ({ id, w: 10, h: 10, bytes: 100, layers: 1, mime: 'image/jpeg' });

  it('sends the bundle with the captures read back out of the store', async () => {
    const send = vi.fn(async () => ({ ok: true as const, ref: '.wb-reports/s1' }));
    const result = await handOver({
      host: host(send),
      store: store({ 'cap-1': 'data:image/jpeg;base64,AAAA' }),
      sessionId: 's1',
      items: [item('a', { capture: capture('cap-1') })],
      groups: [{ id: 'g1', kind: 'spacing', itemIds: ['a'], prTitle: 'A' }],
      drafts: new Map([['a', { title: 'T', body: 'B', severity: 'minor', kind: 'spacing', labels: [] }]]),
    });
    expect(result.sent.ok).toBe(true);
    const [bundle, captures] = send.mock.calls[0] as unknown as [Bundle, Array<{ id: string }>];
    expect(bundle.items[0].draft?.title).toBe('T');
    expect(captures.map((c) => c.id)).toEqual(['cap-1']);
    expect(result.missingCaptures).toEqual([]);
  });

  it('reports a capture it could not read instead of quietly sending without it', async () => {
    const result = await handOver({
      host: host(),
      store: store({}),
      sessionId: 's1',
      items: [item('a', { capture: capture('gone') })],
      groups: [],
      drafts: new Map(),
    });
    expect(result.missingCaptures).toEqual(['note a']);
  });

  it('holds PRs past the session cap back instead of dropping them', async () => {
    const groups: ProposedGroup[] = Array.from({ length: 7 }, (_, i) => ({
      id: `g${i}`,
      kind: 'spacing',
      itemIds: [`i${i}`],
      prTitle: `P${i}`,
    }));
    const send = vi.fn(async () => ({ ok: true as const, ref: 'ref' }));
    const result = await handOver({
      host: host(send),
      store: store(),
      sessionId: 's1',
      items: groups.map((g) => item(g.itemIds[0])),
      groups,
      drafts: new Map(),
    });
    expect(result.queued).toHaveLength(7 - MAX_SESSION_PRS);
    const [bundle] = send.mock.calls[0] as unknown as [Bundle];
    expect(bundle.groups).toHaveLength(MAX_SESSION_PRS);
  });

  it('does not send an item the reporter dropped', async () => {
    const send = vi.fn(async () => ({ ok: true as const, ref: 'ref' }));
    await handOver({
      host: host(send),
      store: store(),
      sessionId: 's1',
      items: [item('a'), item('b', { disposition: 'discard' })],
      groups: [],
      drafts: new Map(),
    });
    const [bundle] = send.mock.calls[0] as unknown as [Bundle];
    expect(bundle.items.map((i) => i.id)).toEqual(['a']);
  });
});

describe('what the reporter is told', () => {
  const bundle = (groups?: ProposedGroup[]): Bundle => ({
    schema: 1,
    sessionId: 's1',
    createdAt: 1,
    env,
    items: [item('a')],
    ...(groups ? { groups } : {}),
  });

  it('names where it went and warns that the shape may change', () => {
    const text = handoverReport({
      sent: { ok: true, ref: '.wb-reports/s1' },
      bundle: bundle([{ id: 'g1', kind: 'spacing', itemIds: ['a'], prTitle: 'A' }]),
      queued: [],
      queuedItems: [],
      missingCaptures: [],
    });
    expect(text).toContain('.wb-reports/s1');
    expect(text).toMatch(/may split or merge/);
  });

  it('says what was queued and what travelled without an image', () => {
    const text = handoverReport({
      sent: { ok: true, ref: 'ref' },
      bundle: bundle(),
      queued: [{ id: 'q', kind: 'spacing', itemIds: ['z'], prTitle: 'Q' }],
      queuedItems: [item('z')],
      missingCaptures: ['note a'],
    });
    expect(text).toMatch(/stayed queued/);
    expect(text).toMatch(/without an image/);
  });

  it('says plainly when nothing was sent', () => {
    const text = handoverReport({
      sent: { ok: false, error: 'the dev server did not answer' },
      bundle: bundle(),
      queued: [],
      queuedItems: [],
      missingCaptures: [],
    });
    expect(text).toMatch(/^Nothing was sent/);
  });
});

describe('handoverSummary', () => {
  it('counts reports, PRs, images, drops and the queue', () => {
    const groups: ProposedGroup[] = Array.from({ length: 6 }, (_, i) => ({
      id: `g${i}`,
      kind: 'spacing',
      itemIds: [`i${i}`],
      prTitle: `P${i}`,
    }));
    const items = [
      ...groups.map((g) => item(g.itemIds[0])),
      item('dropped', { disposition: 'discard' }),
      item('shot', { capture: { id: 'c', w: 1, h: 1, bytes: 1, layers: 1, mime: 'image/jpeg' } }),
    ];
    const text = handoverSummary(items, groups);
    expect(text).toContain('7 reports');
    expect(text).toContain('1 image(s)');
    expect(text).toContain('1 dropped');
    expect(text).toContain('1 waiting for the next batch');
  });
});

describe('handOver · what stays behind', () => {
  const host = (send = vi.fn(async () => ({ ok: true as const, ref: 'ref' }))) => ({
    send,
    environment: () => env,
  });
  const store = () => ({ getCapture: async () => undefined });

  it('applies the cap AFTER dead groups are removed', async () => {
    // A group whose items were all dropped used to consume one of the five
    // slots, so the batch under-delivered while a real PR was reported queued.
    const groups: ProposedGroup[] = [
      { id: 'dead', kind: 'spacing', itemIds: ['gone'], prTitle: 'Dead' },
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `g${i}`,
        kind: 'spacing' as const,
        itemIds: [`i${i}`],
        prTitle: `P${i}`,
      })),
    ];
    const send = vi.fn(async () => ({ ok: true as const, ref: 'ref' }));
    const result = await handOver({
      host: host(send),
      store: store(),
      sessionId: 's1',
      items: [
        item('gone', { disposition: 'discard' }),
        ...Array.from({ length: 5 }, (_, i) => item(`i${i}`)),
      ],
      groups,
      drafts: new Map(),
    });
    const [bundle] = send.mock.calls[0] as unknown as [Bundle];
    expect(bundle.groups).toHaveLength(5);
    expect(result.queued).toEqual([]);
  });

  it('sends only the items behind the PRs that travelled, and returns the rest', async () => {
    // Sending the queued items ungrouped would put them in front of the
    // pipeline anyway and defeat the cap they were held back by.
    const groups: ProposedGroup[] = Array.from({ length: 7 }, (_, i) => ({
      id: `g${i}`,
      kind: 'spacing',
      itemIds: [`i${i}`],
      prTitle: `P${i}`,
    }));
    const send = vi.fn(async () => ({ ok: true as const, ref: 'ref' }));
    const result = await handOver({
      host: host(send),
      store: store(),
      sessionId: 's1',
      items: groups.map((g) => item(g.itemIds[0])),
      groups,
      drafts: new Map(),
    });
    const [bundle] = send.mock.calls[0] as unknown as [Bundle];
    expect(bundle.items.map((i) => i.id)).toEqual(['i0', 'i1', 'i2', 'i3', 'i4']);
    expect(result.queuedItems.map((i) => i.id)).toEqual(['i5', 'i6']);
  });

  it('sends everything when there is no grouping at all', async () => {
    const send = vi.fn(async () => ({ ok: true as const, ref: 'ref' }));
    await handOver({
      host: host(send),
      store: store(),
      sessionId: 's1',
      items: [item('a'), item('b')],
      groups: [],
      drafts: new Map(),
    });
    const [bundle] = send.mock.calls[0] as unknown as [Bundle];
    expect(bundle.items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('handoverSummary agrees with what handOver sends', () => {
  it('does not count a group of only-discarded items against the cap', () => {
    // The cap was applied to the raw proposal here and to the live groups in
    // `handOver`, so the panel could say a PR was waiting for the next batch
    // while the handover sent it. A preview that disagrees with the action is
    // the one thing this panel may not do.
    const items = [
      ...Array.from({ length: 5 }, (_, i) => item(`live-${i}`)),
      { ...item('dropped'), disposition: 'discard' as const },
    ];
    const proposed = (id: string, itemIds: string[]): ProposedGroup => ({
      id,
      kind: 'spacing',
      itemIds,
      prTitle: id,
    });
    const groups = [
      ...Array.from({ length: 5 }, (_, i) => proposed(`g${i}`, [`live-${i}`])),
      proposed('dead', ['dropped']),
    ];
    // Six proposed, but only five are alive — so nothing waits.
    expect(handoverSummary(items, groups)).not.toMatch(/waiting for the next batch/);
    expect(liveGroups(items, groups)).toHaveLength(5);
  });
});

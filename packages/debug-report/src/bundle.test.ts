import { describe, expect, it } from 'vitest';
import { buildBundle, readEnvironment, summariseBundle } from './bundle';
import { BUNDLE_SCHEMA, parseBundle, type DebugItem, type ProposedGroup } from './types';

const item = (id: string, overrides: Partial<DebugItem> = {}): DebugItem => ({
  id,
  createdAt: 1,
  note: `note ${id}`,
  target: { kind: 'viewport', rect: { x: 0, y: 0, w: 10, h: 10 } },
  disposition: 'verify',
  agentCandidate: false,
  ...overrides,
});

const env = {
  route: '/s/:id',
  viewport: { w: 1280, h: 800 },
  dpr: 2,
  theme: 'light',
  userAgent: 'test',
};

describe('buildBundle', () => {
  it('produces a bundle its own parser accepts', () => {
    const bundle = buildBundle({
      sessionId: 's1',
      items: [item('a'), item('b')],
      env,
      now: () => 1_770_000_000_000,
    });
    expect(bundle.schema).toBe(BUNDLE_SCHEMA);
    const parsed = parseBundle(JSON.parse(JSON.stringify(bundle)));
    expect(parsed.ok).toBe(true);
  });

  it('leaves discarded items behind', () => {
    const bundle = buildBundle({
      sessionId: 's1',
      items: [item('a'), item('b', { disposition: 'discard' })],
      env,
    });
    expect(bundle.items.map((i) => i.id)).toEqual(['a']);
  });

  it('never lets an approved group name an item it is not sending', () => {
    const groups: ProposedGroup[] = [
      { id: 'g1', kind: 'spacing', itemIds: ['a', 'b'], prTitle: 'Both' },
      { id: 'g2', kind: 'spacing', itemIds: ['b'], prTitle: 'Only the discarded one' },
    ];
    const bundle = buildBundle({
      sessionId: 's1',
      items: [item('a'), item('b', { disposition: 'discard' })],
      env,
      groups,
    });
    expect(bundle.groups).toEqual([{ id: 'g1', kind: 'spacing', itemIds: ['a'], prTitle: 'Both' }]);
    // And the result still parses, which is what the filtering is for: a group
    // naming a missing item is a rejection downstream.
    expect(parseBundle(JSON.parse(JSON.stringify(bundle))).ok).toBe(true);
  });

  it('omits groups entirely when none survive', () => {
    const bundle = buildBundle({ sessionId: 's1', items: [item('a')], env, groups: [] });
    expect('groups' in bundle).toBe(false);
  });
});

describe('summariseBundle', () => {
  it('counts what the panel is about to send', () => {
    const summary = summariseBundle(
      [
        item('a', { capture: { id: 'c1', w: 10, h: 10, bytes: 100, layers: 1, mime: 'image/jpeg' } }),
        item('b', { disposition: 'publish', agentCandidate: true }),
        item('c', { disposition: 'discard' }),
      ],
      [{ id: 'g1', kind: 'spacing', itemIds: ['a'], prTitle: 'A' }],
    );
    expect(summary).toEqual({
      items: 2,
      verify: 1,
      publish: 1,
      discarded: 1,
      captures: 1,
      groups: 1,
      agentCandidates: 1,
    });
  });

  it('does not count a group whose items were all discarded', () => {
    const summary = summariseBundle([item('a', { disposition: 'discard' })], [
      { id: 'g1', kind: 'spacing', itemIds: ['a'], prTitle: 'A' },
    ]);
    expect(summary.groups).toBe(0);
  });
});

describe('readEnvironment', () => {
  const win = {
    innerWidth: 1024,
    innerHeight: 768,
    devicePixelRatio: 2,
    navigator: { userAgent: 'agent/1' },
  } as unknown as Window;

  it('reads the observation environment', () => {
    expect(readEnvironment({ route: '/login', theme: 'dark', win })).toEqual({
      route: '/login',
      viewport: { w: 1024, h: 768 },
      dpr: 2,
      theme: 'dark',
      userAgent: 'agent/1',
    });
  });

  it('reports an absent build SHA as absent rather than guessing', () => {
    // An agent reading yesterday's code because a bundle implied it is worse
    // than one that knows it does not know.
    const env = readEnvironment({ route: '/login', theme: 'dark', win });
    expect('buildSha' in env).toBe(false);
    expect(readEnvironment({ route: '/', theme: 'dark', buildSha: 'abc123', win }).buildSha).toBe(
      'abc123',
    );
  });

  it('falls back to a sane dpr and viewport with no window', () => {
    const env = readEnvironment({
      route: '/',
      theme: 'light',
      win: { innerWidth: 0, innerHeight: 0, devicePixelRatio: 0, navigator: {} } as unknown as Window,
    });
    expect(env.dpr).toBe(1);
    expect(env.userAgent).toBe('unknown');
  });
});

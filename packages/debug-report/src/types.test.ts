import { describe, expect, it } from 'vitest';
import {
  BUNDLE_SCHEMA,
  parseBundle,
  type Bundle,
  type DebugItem,
} from './types';

/** A bundle that must parse, so every negative case is one mutation away from it. */
function validBundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    schema: BUNDLE_SCHEMA,
    sessionId: 'session-1',
    createdAt: 1_770_000_000_000,
    env: {
      buildSha: 'abc1234',
      route: '/s/:id',
      viewport: { w: 1280, h: 800 },
      dpr: 2,
      theme: 'light',
      userAgent: 'test',
      documentType: 'sheet',
      role: 'owner',
    },
    items: [validItem()],
    ...overrides,
  };
}

function validItem(overrides: Partial<DebugItem> = {}): DebugItem {
  return {
    id: 'item-1',
    createdAt: 1_770_000_000_001,
    note: 'the toolbar icons are cramped',
    target: {
      kind: 'dom',
      selector: 'div.toolbar > button.icon',
      tag: 'button',
      text: 'Bold',
      rect: { x: 10, y: 20, w: 32, h: 32 },
    },
    disposition: 'verify',
    agentCandidate: false,
    ...overrides,
  };
}

/** `parseBundle` accepts unknown input, so tests may hand it malformed shapes. */
const parse = (value: unknown) => parseBundle(value);

describe('parseBundle', () => {
  it('round-trips a valid bundle through JSON', () => {
    const bundle = validBundle();
    const result = parse(JSON.stringify(bundle));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bundle).toEqual(bundle);
  });

  it('accepts an already-parsed object', () => {
    expect(parse(validBundle()).ok).toBe(true);
  });

  it('rejects text that is not JSON', () => {
    const result = parse('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/not valid JSON/);
  });

  it('rejects an unrecognised schema version, and says nothing else', () => {
    const result = parse({ ...validBundle(), schema: BUNDLE_SCHEMA + 1 });
    expect(result.ok).toBe(false);
    // One message: on a version skew, complaints about individual fields are
    // noise about fields that legitimately moved.
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/bundle\.schema/);
    }
  });

  it('rejects an item with no note — there would be nothing to verify', () => {
    const bundle = validBundle({ items: [{ ...validItem(), note: '   ' }] });
    const result = parse(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/note/);
  });

  it('rejects an unknown disposition rather than defaulting it', () => {
    const bundle = validBundle({
      items: [{ ...validItem(), disposition: 'file-it' as never }],
    });
    const result = parse(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/disposition/);
  });

  it('rejects an unknown target kind', () => {
    const bundle = validBundle({
      items: [
        {
          ...validItem(),
          target: { kind: 'svg', rect: { x: 0, y: 0, w: 1, h: 1 } } as never,
        },
      ],
    });
    expect(parse(bundle).ok).toBe(false);
  });

  it('accepts a canvas target with no address', () => {
    const bundle = validBundle({
      items: [
        {
          ...validItem(),
          target: {
            kind: 'canvas',
            surface: 'sheet',
            rect: { x: 0, y: 0, w: 120, h: 40 },
          },
        },
      ],
    });
    expect(parse(bundle).ok).toBe(true);
  });

  it('reports every problem at once', () => {
    const bundle = {
      ...validBundle(),
      sessionId: '',
      createdAt: 'yesterday',
    };
    const result = parse(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((m) => m.includes('sessionId'))).toBe(true);
      expect(result.errors.some((m) => m.includes('createdAt'))).toBe(true);
    }
  });

  it('rejects duplicate item ids', () => {
    const bundle = validBundle({ items: [validItem(), validItem()] });
    const result = parse(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/duplicate item id/);
  });

  it('rejects a NaN rect coordinate', () => {
    const bundle = validBundle({
      items: [
        {
          ...validItem(),
          target: {
            kind: 'viewport',
            rect: { x: 0, y: 0, w: Number.NaN, h: 10 },
          },
        },
      ],
    });
    expect(parse(bundle).ok).toBe(false);
  });

  it('rejects a capture with no mime, keeping a complete one', () => {
    const capture = {
      id: 'cap-1',
      w: 340,
      h: 220,
      bytes: 6144,
      layers: 2,
      mime: 'image/jpeg',
    };
    expect(parse(validBundle({ items: [{ ...validItem(), capture }] })).ok).toBe(true);
    const { mime: _gone, ...incomplete } = capture;
    expect(
      parse(
        validBundle({
          items: [{ ...validItem(), capture: incomplete as never }],
        }),
      ).ok,
    ).toBe(false);
  });

  it('rejects a draft whose severity is off the scale', () => {
    const bundle = validBundle({
      items: [
        {
          ...validItem(),
          draft: {
            title: 'Give the toolbar room to breathe',
            body: 'The icon row has no gap.',
            severity: 'blocker' as never,
            kind: 'spacing',
            labels: ['ui'],
          },
        },
      ],
    });
    expect(parse(bundle).ok).toBe(false);
  });

  describe('groups', () => {
    const twoItems = [validItem(), validItem({ id: 'item-2' })];

    it('accepts a grouping that partitions the items it names', () => {
      const result = parse(
        validBundle({
          items: twoItems,
          groups: [
            {
              id: 'g1',
              kind: 'spacing',
              itemIds: ['item-1', 'item-2'],
              prTitle: 'Give the toolbar and menus room to breathe',
            },
          ],
        }),
      );
      expect(result.ok).toBe(true);
    });

    it('accepts items left out of every group', () => {
      // Ungrouped is a normal state: a `logic` item is never grouped, and
      // overflow past the per-session cap stays queued.
      const result = parse(
        validBundle({
          items: twoItems,
          groups: [
            { id: 'g1', kind: 'spacing', itemIds: ['item-1'], prTitle: 'Spacing' },
          ],
        }),
      );
      expect(result.ok).toBe(true);
    });

    it('rejects a group naming an item that is not in the bundle', () => {
      const result = parse(
        validBundle({
          items: twoItems,
          groups: [
            { id: 'g1', kind: 'spacing', itemIds: ['item-9'], prTitle: 'Spacing' },
          ],
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join()).toMatch(/no such item item-9/);
    });

    it('rejects one item claimed by two groups', () => {
      const result = parse(
        validBundle({
          items: twoItems,
          groups: [
            { id: 'g1', kind: 'spacing', itemIds: ['item-1'], prTitle: 'A' },
            { id: 'g2', kind: 'spacing', itemIds: ['item-1'], prTitle: 'B' },
          ],
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join()).toMatch(/already in another group/);
    });

    it('rejects duplicate group ids', () => {
      const result = parse(
        validBundle({
          items: twoItems,
          groups: [
            { id: 'g1', kind: 'spacing', itemIds: ['item-1'], prTitle: 'A' },
            { id: 'g1', kind: 'spacing', itemIds: ['item-2'], prTitle: 'B' },
          ],
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join()).toMatch(/duplicate group id/);
    });

    it('rejects an empty group', () => {
      const result = parse(
        validBundle({
          items: twoItems,
          groups: [{ id: 'g1', kind: 'spacing', itemIds: [], prTitle: 'A' }],
        }),
      );
      expect(result.ok).toBe(false);
    });

    it('rejects an unknown change kind', () => {
      const result = parse(
        validBundle({
          items: twoItems,
          groups: [
            { id: 'g1', kind: 'vibes' as never, itemIds: ['item-1'], prTitle: 'A' },
          ],
        }),
      );
      expect(result.ok).toBe(false);
    });
  });
  it('refuses a malformed optional field instead of dropping it', () => {
    // FAIL CLOSED. `isNonEmptyString(v) ? { k: v } : {}` accepted the bundle and
    // removed the field, so `text: 42` parsed as ok — and `text` is the agent's
    // only grep key into the source, dropped without telling anyone.
    for (const [field, value] of [
      ['testId', 42],
      ['text', ''],
      ['text', null],
    ] as const) {
      const b = validBundle();
      (b.items[0].target as Record<string, unknown>)[field] = value;
      const result = parseBundle(b);
      expect(result.ok, `${field}=${JSON.stringify(value)} should be refused`).toBe(false);
      if (!result.ok) expect(result.errors.join()).toMatch(/when present/);
    }
  });

  it('still accepts an absent optional field', () => {
    // Absent is not malformed — the distinction is the whole point.
    const b = validBundle();
    delete (b.items[0].target as Record<string, unknown>).testId;
    delete (b.items[0].target as Record<string, unknown>).text;
    expect(parseBundle(b).ok).toBe(true);
  });

});

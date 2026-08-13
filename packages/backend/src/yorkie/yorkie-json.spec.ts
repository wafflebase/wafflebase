import {
  detachYorkieValue,
  normalizeJsonSnapshot,
  parseJsonSnapshot,
  snapshotJsonRoot,
} from './yorkie-json';

/**
 * A stand-in for a Yorkie root proxy: `toJSON()` returns the root as a JSON
 * *string*, which is what makes `JSON.stringify(proxy)` double-encode rather
 * than serialise the object — the behaviour every snapshot tier has to cope
 * with. The fields sit beside it so a proxy walk can still read them.
 */
function rootProxy(json: string, fields: Record<string, unknown>) {
  return { toJSON: () => json, ...fields };
}

describe('parseJsonSnapshot', () => {
  it('repairs unescaped control characters inside strings', () => {
    expect(parseJsonSnapshot('{"a":"x\u0001y"}')).toEqual({ a: 'x\u0001y' });
  });

  it('leaves an already-escaped newline alone', () => {
    expect(parseJsonSnapshot('{"a":"x\\ny"}')).toEqual({ a: 'x\ny' });
  });

  it('rethrows a syntax error that is not a control character', () => {
    expect(() => parseJsonSnapshot('{"a":')).toThrow(SyntaxError);
  });
});

describe('normalizeJsonSnapshot', () => {
  it('unwraps every nested string layer', () => {
    expect(normalizeJsonSnapshot('"{\\"a\\":1}"')).toEqual({ a: 1 });
  });

  it('repairs a control character buried in an inner layer', () => {
    expect(normalizeJsonSnapshot(JSON.stringify('{"a":"x\u0001y"}'))).toEqual({
      a: 'x\u0001y',
    });
  });

  it('rejects a snapshot that is not an object', () => {
    expect(() => normalizeJsonSnapshot('[1,2]')).toThrow(
      'Yorkie document root snapshot is not an object',
    );
  });
});

describe('detachYorkieValue', () => {
  it('drops functions so a proxy’s own toJSON never lands in the snapshot', () => {
    expect(detachYorkieValue(rootProxy('{"a":1}', { a: 1 }))).toEqual({ a: 1 });
  });

  it('degrades a Long to a number while it stays exact', () => {
    expect(detachYorkieValue({ at: BigInt(1786000000000) })).toEqual({
      at: 1786000000000,
    });
  });

  it('keeps an inexact Long as a string rather than rounding it', () => {
    expect(detachYorkieValue({ at: BigInt('9007199254740993') })).toEqual({
      at: '9007199254740993',
    });
  });

  it('recurses through arrays', () => {
    expect(detachYorkieValue({ xs: [{ a: 1 }, 2] })).toEqual({
      xs: [{ a: 1 }, 2],
    });
  });
});

describe('snapshotJsonRoot', () => {
  it('parses the root JSON string Yorkie hands back', () => {
    expect(snapshotJsonRoot({ toJSON: () => '{"a":1}' })).toEqual({ a: 1 });
  });

  it('unwraps a double-encoded root', () => {
    expect(snapshotJsonRoot({ toJSON: () => '"{\\"a\\":1}"' })).toEqual({
      a: 1,
    });
  });

  it('rejects a root that is not an object', () => {
    expect(() => snapshotJsonRoot({ toJSON: () => '[1,2]' })).toThrow(
      'Yorkie document root snapshot is not an object',
    );
  });

  it('repairs the control characters Yorkie leaves unescaped', () => {
    // The failure this whole fallback chain exists for: Yorkie's raw JSON
    // string path does not escape every control character, so a plain
    // `JSON.parse(doc.toJSON())` throws. Repaired in the first tier — no root
    // proxy needed.
    expect(snapshotJsonRoot({ toJSON: () => '{"a":"x\u0001y"}' })).toEqual({
      a: 'x\u0001y',
    });
  });

  it('walks the root proxy when its toJSON string cannot be parsed at all', () => {
    // A *real* proxy, so `JSON.stringify(root)` re-encodes the same broken
    // string and the second tier fails with it. Only the proxy walk gets a
    // snapshot out, which is the point of having a third tier.
    const root = rootProxy('{"a": <truncated>', { a: 'kept' });
    expect(snapshotJsonRoot({ toJSON: root.toJSON, getRoot: () => root })).toEqual(
      { a: 'kept' },
    );
  });

  it('falls back to a root that is already detached plain JSON', () => {
    const root = { a: 1 };
    expect(
      snapshotJsonRoot({ toJSON: () => 'not json', getRoot: () => root }),
    ).toEqual(root);
  });

  it('rethrows when there is no root to fall back to', () => {
    expect(() => snapshotJsonRoot({ toJSON: () => 'not json' })).toThrow(
      SyntaxError,
    );
  });

  it('rethrows when neither the JSON string nor the root parses', () => {
    expect(() =>
      snapshotJsonRoot({
        toJSON: () => 'not json',
        getRoot: () => {
          throw new Error('root unavailable');
        },
      }),
    ).toThrow('root unavailable');
  });
});

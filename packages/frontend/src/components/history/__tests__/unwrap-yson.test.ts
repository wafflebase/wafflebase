import { describe, expect, it } from 'vitest';
import { YSON } from '@yorkie-js/sdk';
import { unwrapYsonScalars } from '../unwrap-yson';

/**
 * The inputs here are produced by `YSON.parse` itself rather than typed out by
 * hand, so the wrapper shapes cannot drift away from the SDK's without this
 * failing. That is the whole lesson of the bug this fixes: a hand-authored
 * approximation of the wire format tested nothing.
 */
const parsed = (yson: string) => YSON.parse<unknown>(yson);

describe('unwrapYsonScalars', () => {
  it('unwraps Int and Long to plain numbers', () => {
    expect(
      unwrapYsonScalars(parsed('{"w":Int(320),"t":Long(1788360894343)}')),
    ).toEqual({ w: 320, t: 1788360894343 });
  });

  it('leaves floats, strings, booleans and null alone', () => {
    expect(
      unwrapYsonScalars(parsed('{"x":1.5,"s":"a","b":true,"n":null}')),
    ).toEqual({ x: 1.5, s: 'a', b: true, n: null });
  });

  it('unwraps through arrays and nesting', () => {
    const out = unwrapYsonScalars<{ els: Array<{ frame: { w: number } }> }>(
      parsed('{"els":[{"frame":{"w":Int(320)}},{"frame":{"w":Int(90)}}]}'),
    );
    expect(out.els.map((e) => e.frame.w)).toEqual([320, 90]);
  });

  it('unwraps BinData to its string and Date to a Date', () => {
    const out = unwrapYsonScalars<{ b: string; d: Date }>(
      parsed('{"b":BinData("YQ=="),"d":Date("2026-09-02T10:00:00.000Z")}'),
    );
    expect(out.b).toBe('YQ==');
    expect(out.d).toBeInstanceOf(Date);
    expect(out.d.toISOString()).toBe('2026-09-02T10:00:00.000Z');
  });

  it('unwraps a Counter to the number it holds', () => {
    expect(unwrapYsonScalars(parsed('{"c":Counter(Int(7))}'))).toEqual({ c: 7 });
    expect(unwrapYsonScalars(parsed('{"c":Counter(Long(7))}'))).toEqual({ c: 7 });
  });

  // `Text` and `Tree` are aggregate CRDTs. Unwrapping one would destroy the
  // note adapter's only input — `YSON.textToString` reads `.nodes`.
  it('passes a Text through by reference so textToString still works', () => {
    const input = parsed('{"content":Text([{"val":"# hi"}])}') as {
      content: YSON.Text;
    };
    const out = unwrapYsonScalars<{ content: YSON.Text }>(input);
    expect(out.content).toBe(input.content);
    expect(YSON.textToString(out.content)).toBe('# hi');
  });

  it('passes a Tree through by reference', () => {
    const input = parsed('{"t":Tree({"type":"doc","children":[]})}') as {
      t: unknown;
    };
    expect(unwrapYsonScalars<{ t: unknown }>(input).t).toBe(input.t);
  });

  // Every slides `Element` carries a `type` field, and so do cell comments and
  // data-validation rules. Keying only on `type === 'Int'` would be enough to
  // never collide, but the key set is matched exactly so that a model object
  // literally shaped `{type, value}` — a data-validation rule, say — is safe
  // too, unless its `type` is a CRDT tag name.
  it('does not mistake a model object with a type field for a wrapper', () => {
    const doc = {
      elements: [{ id: 'a', type: 'shape', data: {}, frame: { w: 1 } }],
      rule: { type: 'list', value: ['a', 'b'] },
      styled: { type: 'Int', value: 4, note: 'has a third key' },
    };
    expect(unwrapYsonScalars(doc)).toEqual(doc);
  });

  it('leaves a malformed wrapper as the object it is rather than dropping it', () => {
    const doc = { w: { type: 'Int', value: 'not a number' } };
    expect(unwrapYsonScalars(doc)).toEqual(doc);
  });
});

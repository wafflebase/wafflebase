/*
 * The generator's job is to get a component PAST its first property read so it paints.
 * These pin the shapes that actually appear in the analysed set — measured, not imagined:
 * `Array<NavItem>`, `Document[]`, `User`, `string | undefined`, `(accept: string) => void`.
 */
import { describe, it, expect } from 'vitest';
import { mockValueFor, mockPropsFor, noopPropsFor } from '../../src/client/mock-props.ts';

const p = (name: string, type: string, optional = false) => ({ name, type, optional });

describe('mockValueFor', () => {
  it('gives an array for both array spellings, because `.map` is what throws', () => {
    expect(mockValueFor('items', 'Array<NavItem>')).toEqual([]);
    expect(mockValueFor('data', 'Document[]')).toEqual([]);
    expect(mockValueFor('rows', 'readonly Row[]')).toEqual([]);
  });

  it('gives an object for a named type, so a property read survives', () => {
    // `NavUser` reads `user.username`; `{}` returns undefined rather than throwing.
    expect(mockValueFor('user', 'User')).toEqual({});
    expect(mockValueFor('column', 'Column<TData, unknown>')).toEqual({});
  });

  it('uses the prop NAME for a string, which reads better than a placeholder', () => {
    expect(mockValueFor('title', 'string')).toBe('title');
    expect(mockValueFor('value', 'string | undefined')).toBe('value');
  });

  it('refuses a function, because JSON cannot carry one', () => {
    expect(mockValueFor('onCreate', '(payload: { title: string }) => void')).toBeUndefined();
    expect(mockValueFor('onImport', '() => void')).toBeUndefined();
  });

  it('does not read an array as an object just because it is generic', () => {
    // `Array<T>` matched the named-type branch in an earlier draft and produced `{}`,
    // which throws on `.map` — the exact error this exists to prevent.
    expect(mockValueFor('items', 'Array<NavItem>')).not.toEqual({});
  });
});

describe('mockPropsFor', () => {
  it('covers only what is required', () => {
    expect(mockPropsFor([p('items', 'Array<NavItem>'), p('className', 'string', true)])).toEqual({
      items: [],
    });
  });

  it('leaves functions out of the editable set', () => {
    const props = [p('onImport', '(accept: string) => void'), p('title', 'string')];
    expect(mockPropsFor(props)).toEqual({ title: 'title' });
    expect(noopPropsFor(props)).toEqual(['onImport']);
  });
});

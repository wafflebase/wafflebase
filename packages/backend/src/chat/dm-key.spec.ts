import { dmKey } from './dm-key';

describe('dmKey', () => {
  it('is insensitive to member order', () => {
    expect(dmKey('ws', [3, 1, 2])).toBe(dmKey('ws', [2, 3, 1]));
  });

  it('is insensitive to duplicate ids', () => {
    expect(dmKey('ws', [1, 2, 2, 1])).toBe(dmKey('ws', [1, 2]));
  });

  it('sorts numerically, not as strings', () => {
    expect(dmKey('ws', [10, 9, 2])).toBe('ws:2,9,10');
  });

  it('is scoped to the workspace', () => {
    expect(dmKey('a', [1, 2])).not.toBe(dmKey('b', [1, 2]));
  });
});

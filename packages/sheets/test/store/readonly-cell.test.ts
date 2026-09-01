import { describe, expect, it } from 'vitest';
import { toCell } from '../../src/store/readonly';

describe('toCell', () => {
  it('serializes nested BigInt and binary values safely', () => {
    expect(
      toCell({
        ids: [1n, 2n],
        payload: new Uint8Array([171, 205]),
      }),
    ).toBe('{"ids":["1","2"],"payload":"0xabcd"}');
  });
});

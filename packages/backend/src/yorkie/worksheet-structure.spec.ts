import { BadRequestException } from '@nestjs/common';
import { parseClearRange } from './worksheet-structure';

describe('parseClearRange', () => {
  it('parses a range string', () => {
    const range = parseClearRange({ range: 'A1:B3' });
    expect(range[0]).toMatchObject({ r: 1, c: 1 });
    expect(range[1]).toMatchObject({ r: 3, c: 2 });
  });

  it('treats a single cell as a 1x1 range', () => {
    const range = parseClearRange({ range: 'C2' });
    expect(range[0]).toMatchObject({ r: 2, c: 3 });
    expect(range[1]).toMatchObject({ r: 2, c: 3 });
  });

  it('rejects a missing or non-string range', () => {
    expect(() => parseClearRange({})).toThrow(BadRequestException);
    expect(() => parseClearRange({ range: 5 })).toThrow(BadRequestException);
  });

  it('rejects a malformed range', () => {
    expect(() => parseClearRange({ range: '123' })).toThrow(BadRequestException);
  });
});

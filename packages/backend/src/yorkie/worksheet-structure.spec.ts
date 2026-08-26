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
    expect(() => parseClearRange({ range: '123' })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a range outside the grid', () => {
    expect(() => parseClearRange({ range: 'A1:ZZZZ99999999' })).toThrow(
      /outside the grid/,
    );
    expect(() => parseClearRange({ range: 'A0:B2' })).toThrow(
      BadRequestException,
    );
  });

  it('rejects an in-grid range above the area cap', () => {
    // Inside the grid (ZZ is column 702, 1000000 is the last row), but 7e8
    // cells: the loop that would walk it blocks the process for minutes.
    expect(() => parseClearRange({ range: 'A1:ZZ1000000' })).toThrow(
      /covers 702000000 cells, above the 1000000 limit/,
    );
  });

  it('normalizes a reversed range before checking it', () => {
    const range = parseClearRange({ range: 'C3:A1' });
    expect(range[0]).toMatchObject({ r: 1, c: 1 });
    expect(range[1]).toMatchObject({ r: 3, c: 3 });
  });

  it('rejects a reversed range whose far corner is outside the grid', () => {
    expect(() => parseClearRange({ range: 'ZZZZ99999999:A1' })).toThrow(
      /outside the grid/,
    );
  });
});

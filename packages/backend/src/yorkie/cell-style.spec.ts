import { BadRequestException } from '@nestjs/common';
import { parseCellStyle } from './cell-style';

describe('parseCellStyle', () => {
  it('returns known valid fields (booleans, strings, enums, number)', () => {
    expect(
      parseCellStyle({
        b: true,
        i: false,
        tc: '#ff0000',
        bg: '#00ff00',
        al: 'center',
        va: 'middle',
        nf: 'currency',
        cu: 'USD',
        dp: 2,
      }),
    ).toEqual({
      b: true,
      i: false,
      tc: '#ff0000',
      bg: '#00ff00',
      al: 'center',
      va: 'middle',
      nf: 'currency',
      cu: 'USD',
      dp: 2,
    });
  });

  it('rejects an unknown field', () => {
    expect(() => parseCellStyle({ bogus: 1 })).toThrow(BadRequestException);
  });

  it('rejects a wrong-typed boolean', () => {
    expect(() => parseCellStyle({ b: 'yes' })).toThrow(BadRequestException);
  });

  it('rejects a value outside an enum (al accepts left/center/right, not middle)', () => {
    expect(() => parseCellStyle({ al: 'middle' })).toThrow(BadRequestException);
  });

  it('rejects a non-numeric dp', () => {
    expect(() => parseCellStyle({ dp: '2' })).toThrow(BadRequestException);
  });

  it('rejects a non-object', () => {
    expect(() => parseCellStyle('x')).toThrow(BadRequestException);
    expect(() => parseCellStyle(null)).toThrow(BadRequestException);
    expect(() => parseCellStyle([])).toThrow(BadRequestException);
  });
});

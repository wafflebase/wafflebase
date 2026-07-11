import { describe, it, expect } from 'vitest';
import { createWorksheet } from './worksheet-document';

describe('createWorksheet dataValidations seed', () => {
  it('seeds dataValidations to an empty array', () => {
    expect(createWorksheet().dataValidations).toEqual([]);
  });

  it('lets an override replace the seeded array', () => {
    const ws = createWorksheet({
      dataValidations: [
        {
          id: 'a',
          kind: 'checkbox',
          ranges: [
            [
              { r: 1, c: 1 },
              { r: 1, c: 1 },
            ],
          ],
        },
      ],
    });
    expect(ws.dataValidations).toHaveLength(1);
  });

  it('round-trips a list rule with its options', () => {
    const ws = createWorksheet({
      dataValidations: [
        {
          id: 'l',
          kind: 'list',
          ranges: [
            [
              { r: 1, c: 1 },
              { r: 3, c: 1 },
            ],
          ],
          list: ['Red', 'Green', 'Blue'],
          showArrow: true,
          onInvalid: 'reject',
        },
      ],
    });
    expect(ws.dataValidations).toHaveLength(1);
    expect(ws.dataValidations![0].list).toEqual(['Red', 'Green', 'Blue']);
    expect(ws.dataValidations![0].onInvalid).toBe('reject');
  });
});

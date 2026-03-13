import type { Sref } from '../../src/model/types.ts';

export type ConcurrencyOp =
  | {
      kind: 'set-data';
      ref: Sref;
      value: string;
    }
  | {
      kind: 'insert-rows';
      index: number;
      count?: number;
    }
  | {
      kind: 'delete-rows';
      index: number;
      count?: number;
    }
  | {
      kind: 'insert-columns';
      index: number;
      count?: number;
    }
  | {
      kind: 'delete-columns';
      index: number;
      count?: number;
    };

export type ObservedCellSnapshot = {
  input: string;
  display: string;
};

export type ConcurrencySnapshot = {
  cells: Record<Sref, ObservedCellSnapshot>;
};

export type ConcurrencyCase = {
  name: string;
  relation:
    | 'same-cell'
    | 'same-row-band'
    | 'same-column-band'
    | 'shift-affected'
    | 'structure-structure';
  seed?: ConcurrencyOp[];
  userA: ConcurrencyOp;
  userB: ConcurrencyOp;
  observe: {
    refs: Sref[];
  };
  expect: {
    aThenB: ConcurrencySnapshot;
    bThenA: ConcurrencySnapshot;
  };
};

export const concurrencyCases: ConcurrencyCase[] = [
  {
    name: 'value edit vs row insert above shifted target',
    relation: 'shift-affected',
    seed: [{ kind: 'set-data', ref: 'A2', value: '10' }],
    userA: { kind: 'insert-rows', index: 2, count: 1 },
    userB: { kind: 'set-data', ref: 'A2', value: '20' },
    observe: { refs: ['A2', 'A3'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '20', display: '20' },
          A3: { input: '10', display: '10' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '', display: '' },
          A3: { input: '20', display: '20' },
        },
      },
    },
  },
  {
    name: 'value edit vs row delete at target',
    relation: 'shift-affected',
    seed: [
      { kind: 'set-data', ref: 'A2', value: '10' },
      { kind: 'set-data', ref: 'A3', value: '30' },
    ],
    userA: { kind: 'delete-rows', index: 2, count: 1 },
    userB: { kind: 'set-data', ref: 'A2', value: '20' },
    observe: { refs: ['A2', 'A3'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '20', display: '20' },
          A3: { input: '', display: '' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '30', display: '30' },
          A3: { input: '', display: '' },
        },
      },
    },
  },
  {
    name: 'value edit vs column insert left of shifted target',
    relation: 'shift-affected',
    seed: [{ kind: 'set-data', ref: 'B1', value: '10' }],
    userA: { kind: 'insert-columns', index: 2, count: 1 },
    userB: { kind: 'set-data', ref: 'B1', value: '20' },
    observe: { refs: ['B1', 'C1'] },
    expect: {
      aThenB: {
        cells: {
          B1: { input: '20', display: '20' },
          C1: { input: '10', display: '10' },
        },
      },
      bThenA: {
        cells: {
          B1: { input: '', display: '' },
          C1: { input: '20', display: '20' },
        },
      },
    },
  },
  {
    name: 'value edit vs column delete at target',
    relation: 'shift-affected',
    seed: [
      { kind: 'set-data', ref: 'B1', value: '10' },
      { kind: 'set-data', ref: 'C1', value: '30' },
    ],
    userA: { kind: 'delete-columns', index: 2, count: 1 },
    userB: { kind: 'set-data', ref: 'B1', value: '20' },
    observe: { refs: ['B1', 'C1'] },
    expect: {
      aThenB: {
        cells: {
          B1: { input: '20', display: '20' },
          C1: { input: '', display: '' },
        },
      },
      bThenA: {
        cells: {
          B1: { input: '30', display: '30' },
          C1: { input: '', display: '' },
        },
      },
    },
  },
  {
    name: 'formula chain vs row insert above referenced cell',
    relation: 'shift-affected',
    seed: [
      { kind: 'set-data', ref: 'A1', value: '5' },
      { kind: 'set-data', ref: 'A2', value: '10' },
      { kind: 'set-data', ref: 'B3', value: '=A1+A2' },
    ],
    userA: { kind: 'insert-rows', index: 2, count: 1 },
    userB: { kind: 'set-data', ref: 'A2', value: '20' },
    observe: { refs: ['A2', 'A3', 'B4'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '20', display: '20' },
          A3: { input: '10', display: '10' },
          B4: { input: '=A1+A3', display: '15' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '', display: '' },
          A3: { input: '20', display: '20' },
          B4: { input: '=A1+A3', display: '25' },
        },
      },
    },
  },
  {
    name: 'row insert vs row insert at same index',
    relation: 'structure-structure',
    seed: [{ kind: 'set-data', ref: 'A2', value: '10' }],
    userA: { kind: 'insert-rows', index: 2, count: 1 },
    userB: { kind: 'insert-rows', index: 2, count: 1 },
    observe: { refs: ['A2', 'A3', 'A4'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '', display: '' },
          A3: { input: '', display: '' },
          A4: { input: '10', display: '10' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '', display: '' },
          A3: { input: '', display: '' },
          A4: { input: '10', display: '10' },
        },
      },
    },
  },
  {
    name: 'row insert vs row delete at same index',
    relation: 'structure-structure',
    seed: [
      { kind: 'set-data', ref: 'A2', value: '10' },
      { kind: 'set-data', ref: 'A3', value: '30' },
    ],
    userA: { kind: 'insert-rows', index: 2, count: 1 },
    userB: { kind: 'delete-rows', index: 2, count: 1 },
    observe: { refs: ['A2', 'A3'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '10', display: '10' },
          A3: { input: '30', display: '30' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '', display: '' },
          A3: { input: '30', display: '30' },
        },
      },
    },
  },
  {
    name: 'column insert vs column insert at same index',
    relation: 'structure-structure',
    seed: [{ kind: 'set-data', ref: 'B1', value: '10' }],
    userA: { kind: 'insert-columns', index: 2, count: 1 },
    userB: { kind: 'insert-columns', index: 2, count: 1 },
    observe: { refs: ['B1', 'C1', 'D1'] },
    expect: {
      aThenB: {
        cells: {
          B1: { input: '', display: '' },
          C1: { input: '', display: '' },
          D1: { input: '10', display: '10' },
        },
      },
      bThenA: {
        cells: {
          B1: { input: '', display: '' },
          C1: { input: '', display: '' },
          D1: { input: '10', display: '10' },
        },
      },
    },
  },
  {
    name: 'column insert vs column delete at same index',
    relation: 'structure-structure',
    seed: [
      { kind: 'set-data', ref: 'B1', value: '10' },
      { kind: 'set-data', ref: 'C1', value: '30' },
    ],
    userA: { kind: 'insert-columns', index: 2, count: 1 },
    userB: { kind: 'delete-columns', index: 2, count: 1 },
    observe: { refs: ['B1', 'C1'] },
    expect: {
      aThenB: {
        cells: {
          B1: { input: '10', display: '10' },
          C1: { input: '30', display: '30' },
        },
      },
      bThenA: {
        cells: {
          B1: { input: '', display: '' },
          C1: { input: '30', display: '30' },
        },
      },
    },
  },
  {
    name: 'column delete vs column delete at same index',
    relation: 'structure-structure',
    seed: [
      { kind: 'set-data', ref: 'B1', value: '10' },
      { kind: 'set-data', ref: 'C1', value: '30' },
      { kind: 'set-data', ref: 'D1', value: '40' },
    ],
    userA: { kind: 'delete-columns', index: 2, count: 1 },
    userB: { kind: 'delete-columns', index: 2, count: 1 },
    observe: { refs: ['B1', 'C1', 'D1'] },
    expect: {
      aThenB: {
        cells: {
          B1: { input: '40', display: '40' },
          C1: { input: '', display: '' },
          D1: { input: '', display: '' },
        },
      },
      bThenA: {
        cells: {
          B1: { input: '40', display: '40' },
          C1: { input: '', display: '' },
          D1: { input: '', display: '' },
        },
      },
    },
  },
  {
    name: 'row delete vs row delete at same index',
    relation: 'structure-structure',
    seed: [
      { kind: 'set-data', ref: 'A2', value: '10' },
      { kind: 'set-data', ref: 'A3', value: '30' },
      { kind: 'set-data', ref: 'A4', value: '40' },
    ],
    userA: { kind: 'delete-rows', index: 2, count: 1 },
    userB: { kind: 'delete-rows', index: 2, count: 1 },
    observe: { refs: ['A2', 'A3', 'A4'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '40', display: '40' },
          A3: { input: '', display: '' },
          A4: { input: '', display: '' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '40', display: '40' },
          A3: { input: '', display: '' },
          A4: { input: '', display: '' },
        },
      },
    },
  },
  {
    name: 'row insert vs row insert at adjacent indexes',
    relation: 'structure-structure',
    seed: [{ kind: 'set-data', ref: 'A2', value: '10' }],
    userA: { kind: 'insert-rows', index: 2, count: 1 },
    userB: { kind: 'insert-rows', index: 3, count: 1 },
    observe: { refs: ['A2', 'A3', 'A4'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '', display: '' },
          A3: { input: '', display: '' },
          A4: { input: '10', display: '10' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '', display: '' },
          A3: { input: '10', display: '10' },
          A4: { input: '', display: '' },
        },
      },
    },
  },
  {
    name: 'row delete vs row insert at adjacent indexes',
    relation: 'structure-structure',
    seed: [
      { kind: 'set-data', ref: 'A2', value: '10' },
      { kind: 'set-data', ref: 'A3', value: '30' },
      { kind: 'set-data', ref: 'A4', value: '40' },
    ],
    userA: { kind: 'delete-rows', index: 2, count: 1 },
    userB: { kind: 'insert-rows', index: 3, count: 1 },
    observe: { refs: ['A2', 'A3', 'A4'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '30', display: '30' },
          A3: { input: '', display: '' },
          A4: { input: '40', display: '40' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '', display: '' },
          A3: { input: '30', display: '30' },
          A4: { input: '40', display: '40' },
        },
      },
    },
  },
];

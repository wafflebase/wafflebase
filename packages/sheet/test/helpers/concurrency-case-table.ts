import type { Sref } from '../../src/model/core/types.ts';

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
    }
  | {
      kind: 'set-row-height';
      index: number;
      height: number;
    }
  | {
      kind: 'set-column-width';
      index: number;
      width: number;
    }
  | {
      kind: 'move-rows';
      src: number;
      count: number;
      dst: number;
    }
  | {
      kind: 'move-columns';
      src: number;
      count: number;
      dst: number;
    };

export type ObservedCellSnapshot = {
  input: string;
  display: string;
};

export type ConcurrencySnapshot = {
  cells: Record<Sref, ObservedCellSnapshot>;
  dimensions?: {
    rowHeights?: Record<string, number>;
    colWidths?: Record<string, number>;
  };
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
    dimensions?: Array<'row' | 'column'>;
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

  // --- Same-cell cases ---
  {
    name: 'same-cell concurrent value edit',
    relation: 'same-cell',
    userA: { kind: 'set-data', ref: 'A1', value: 'alice' },
    userB: { kind: 'set-data', ref: 'A1', value: 'bob' },
    observe: { refs: ['A1'] },
    expect: {
      aThenB: {
        cells: {
          A1: { input: 'bob', display: 'bob' },
        },
      },
      bThenA: {
        cells: {
          A1: { input: 'alice', display: 'alice' },
        },
      },
    },
  },
  {
    name: 'same-cell formula vs value edit',
    relation: 'same-cell',
    seed: [{ kind: 'set-data', ref: 'B1', value: '10' }],
    userA: { kind: 'set-data', ref: 'A1', value: '=B1+1' },
    userB: { kind: 'set-data', ref: 'A1', value: '99' },
    observe: { refs: ['A1'] },
    expect: {
      aThenB: {
        cells: {
          A1: { input: '99', display: '99' },
        },
      },
      bThenA: {
        cells: {
          A1: { input: '=B1+1', display: '11' },
        },
      },
    },
  },

  // --- Same-row / same-column band cases ---
  {
    name: 'same-row different-column concurrent edits',
    relation: 'same-row-band',
    userA: { kind: 'set-data', ref: 'A1', value: 'left' },
    userB: { kind: 'set-data', ref: 'B1', value: 'right' },
    observe: { refs: ['A1', 'B1'] },
    expect: {
      aThenB: {
        cells: {
          A1: { input: 'left', display: 'left' },
          B1: { input: 'right', display: 'right' },
        },
      },
      bThenA: {
        cells: {
          A1: { input: 'left', display: 'left' },
          B1: { input: 'right', display: 'right' },
        },
      },
    },
  },
  {
    name: 'same-column different-row concurrent edits',
    relation: 'same-column-band',
    userA: { kind: 'set-data', ref: 'A1', value: 'top' },
    userB: { kind: 'set-data', ref: 'A2', value: 'bottom' },
    observe: { refs: ['A1', 'A2'] },
    expect: {
      aThenB: {
        cells: {
          A1: { input: 'top', display: 'top' },
          A2: { input: 'bottom', display: 'bottom' },
        },
      },
      bThenA: {
        cells: {
          A1: { input: 'top', display: 'top' },
          A2: { input: 'bottom', display: 'bottom' },
        },
      },
    },
  },

  // --- Multi-count structural cases ---
  {
    name: 'value edit vs bulk row insert (count=2)',
    relation: 'shift-affected',
    seed: [{ kind: 'set-data', ref: 'A3', value: '20' }],
    userA: { kind: 'insert-rows', index: 2, count: 2 },
    userB: { kind: 'set-data', ref: 'A3', value: '99' },
    observe: { refs: ['A3', 'A4', 'A5'] },
    expect: {
      aThenB: {
        cells: {
          A3: { input: '99', display: '99' },
          A4: { input: '', display: '' },
          A5: { input: '20', display: '20' },
        },
      },
      bThenA: {
        cells: {
          A3: { input: '', display: '' },
          A4: { input: '', display: '' },
          A5: { input: '99', display: '99' },
        },
      },
    },
  },
  {
    name: 'value edit vs bulk row delete (count=2)',
    relation: 'shift-affected',
    seed: [
      { kind: 'set-data', ref: 'A2', value: '10' },
      { kind: 'set-data', ref: 'A3', value: '20' },
      { kind: 'set-data', ref: 'A4', value: '30' },
    ],
    userA: { kind: 'delete-rows', index: 2, count: 2 },
    userB: { kind: 'set-data', ref: 'A2', value: '99' },
    observe: { refs: ['A2', 'A3', 'A4'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '99', display: '99' },
          A3: { input: '', display: '' },
          A4: { input: '', display: '' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '30', display: '30' },
          A3: { input: '', display: '' },
          A4: { input: '', display: '' },
        },
      },
    },
  },
  {
    name: 'bulk insert vs bulk insert (count=2)',
    relation: 'structure-structure',
    seed: [{ kind: 'set-data', ref: 'A2', value: '10' }],
    userA: { kind: 'insert-rows', index: 2, count: 2 },
    userB: { kind: 'insert-rows', index: 2, count: 2 },
    observe: { refs: ['A2', 'A3', 'A4', 'A5', 'A6'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '', display: '' },
          A3: { input: '', display: '' },
          A4: { input: '', display: '' },
          A5: { input: '', display: '' },
          A6: { input: '10', display: '10' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '', display: '' },
          A3: { input: '', display: '' },
          A4: { input: '', display: '' },
          A5: { input: '', display: '' },
          A6: { input: '10', display: '10' },
        },
      },
    },
  },

  // --- Metadata + structure interaction cases ---
  {
    name: 'row height vs row insert at same index',
    relation: 'shift-affected',
    seed: [{ kind: 'set-data', ref: 'A2', value: '10' }],
    userA: { kind: 'insert-rows', index: 2, count: 1 },
    userB: { kind: 'set-row-height', index: 2, height: 60 },
    observe: { refs: ['A2', 'A3'], dimensions: ['row'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '', display: '' },
          A3: { input: '10', display: '10' },
        },
        dimensions: {
          rowHeights: { '2': 60 },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '', display: '' },
          A3: { input: '10', display: '10' },
        },
        dimensions: {
          rowHeights: { '3': 60 },
        },
      },
    },
  },
  {
    name: 'column width vs column delete at same index',
    relation: 'shift-affected',
    seed: [
      { kind: 'set-data', ref: 'B1', value: '10' },
      { kind: 'set-data', ref: 'C1', value: '30' },
    ],
    userA: { kind: 'delete-columns', index: 2, count: 1 },
    userB: { kind: 'set-column-width', index: 2, width: 200 },
    observe: { refs: ['B1', 'C1'], dimensions: ['column'] },
    expect: {
      aThenB: {
        cells: {
          B1: { input: '30', display: '30' },
          C1: { input: '', display: '' },
        },
        dimensions: {
          colWidths: { '2': 200 },
        },
      },
      bThenA: {
        cells: {
          B1: { input: '30', display: '30' },
          C1: { input: '', display: '' },
        },
        dimensions: {
          colWidths: {},
        },
      },
    },
  },
  {
    name: 'concurrent row height edits on same row',
    relation: 'same-row-band',
    userA: { kind: 'set-row-height', index: 3, height: 50 },
    userB: { kind: 'set-row-height', index: 3, height: 80 },
    observe: { refs: [], dimensions: ['row'] },
    expect: {
      aThenB: {
        cells: {},
        dimensions: {
          rowHeights: { '3': 80 },
        },
      },
      bThenA: {
        cells: {},
        dimensions: {
          rowHeights: { '3': 50 },
        },
      },
    },
  },

  // --- Move concurrency cases ---
  {
    name: 'value edit vs row move forward (cell in moved range)',
    relation: 'shift-affected',
    seed: [
      { kind: 'set-data', ref: 'A2', value: '10' },
      { kind: 'set-data', ref: 'A3', value: '20' },
      { kind: 'set-data', ref: 'A4', value: '30' },
    ],
    userA: { kind: 'move-rows', src: 2, count: 1, dst: 5 },
    userB: { kind: 'set-data', ref: 'A2', value: '99' },
    observe: { refs: ['A2', 'A3', 'A4'] },
    expect: {
      // placeholder — will be corrected after first test run
      aThenB: {
        cells: {
          A2: { input: '99', display: '99' },
          A3: { input: '30', display: '30' },
          A4: { input: '10', display: '10' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '20', display: '20' },
          A3: { input: '30', display: '30' },
          A4: { input: '99', display: '99' },
        },
      },
    },
  },
  {
    name: 'value edit vs row move backward (cell in moved range)',
    relation: 'shift-affected',
    seed: [
      { kind: 'set-data', ref: 'A2', value: '10' },
      { kind: 'set-data', ref: 'A3', value: '20' },
      { kind: 'set-data', ref: 'A4', value: '30' },
    ],
    userA: { kind: 'move-rows', src: 4, count: 1, dst: 2 },
    userB: { kind: 'set-data', ref: 'A4', value: '99' },
    observe: { refs: ['A2', 'A3', 'A4'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '30', display: '30' },
          A3: { input: '10', display: '10' },
          A4: { input: '99', display: '99' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '99', display: '99' },
          A3: { input: '10', display: '10' },
          A4: { input: '20', display: '20' },
        },
      },
    },
  },
  {
    name: 'value edit vs column move forward',
    relation: 'shift-affected',
    seed: [
      { kind: 'set-data', ref: 'B1', value: '10' },
      { kind: 'set-data', ref: 'C1', value: '20' },
      { kind: 'set-data', ref: 'D1', value: '30' },
    ],
    userA: { kind: 'move-columns', src: 2, count: 1, dst: 5 },
    userB: { kind: 'set-data', ref: 'B1', value: '99' },
    observe: { refs: ['B1', 'C1', 'D1'] },
    expect: {
      aThenB: {
        cells: {
          B1: { input: '99', display: '99' },
          C1: { input: '30', display: '30' },
          D1: { input: '10', display: '10' },
        },
      },
      bThenA: {
        cells: {
          B1: { input: '20', display: '20' },
          C1: { input: '30', display: '30' },
          D1: { input: '99', display: '99' },
        },
      },
    },
  },
  {
    name: 'row move vs row insert at same index',
    relation: 'structure-structure',
    seed: [
      { kind: 'set-data', ref: 'A2', value: '10' },
      { kind: 'set-data', ref: 'A3', value: '20' },
      { kind: 'set-data', ref: 'A4', value: '30' },
    ],
    userA: { kind: 'move-rows', src: 2, count: 1, dst: 5 },
    userB: { kind: 'insert-rows', index: 2, count: 1 },
    observe: { refs: ['A2', 'A3', 'A4', 'A5'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '', display: '' },
          A3: { input: '20', display: '20' },
          A4: { input: '30', display: '30' },
          A5: { input: '10', display: '10' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '10', display: '10' },
          A3: { input: '20', display: '20' },
          A4: { input: '', display: '' },
          A5: { input: '30', display: '30' },
        },
      },
    },
  },
  {
    name: 'row move vs row delete at source',
    relation: 'structure-structure',
    seed: [
      { kind: 'set-data', ref: 'A2', value: '10' },
      { kind: 'set-data', ref: 'A3', value: '20' },
      { kind: 'set-data', ref: 'A4', value: '30' },
    ],
    userA: { kind: 'move-rows', src: 2, count: 1, dst: 5 },
    userB: { kind: 'delete-rows', index: 2, count: 1 },
    observe: { refs: ['A2', 'A3', 'A4'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '30', display: '30' },
          A3: { input: '10', display: '10' },
          A4: { input: '', display: '' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '30', display: '30' },
          A3: { input: '', display: '' },
          A4: { input: '20', display: '20' },
        },
      },
    },
  },
  {
    name: 'row move vs row move (different rows)',
    relation: 'structure-structure',
    seed: [
      { kind: 'set-data', ref: 'A1', value: '10' },
      { kind: 'set-data', ref: 'A2', value: '20' },
      { kind: 'set-data', ref: 'A3', value: '30' },
      { kind: 'set-data', ref: 'A4', value: '40' },
    ],
    userA: { kind: 'move-rows', src: 2, count: 1, dst: 5 },
    userB: { kind: 'move-rows', src: 4, count: 1, dst: 1 },
    observe: { refs: ['A1', 'A2', 'A3', 'A4'] },
    expect: {
      aThenB: {
        cells: {
          A1: { input: '20', display: '20' },
          A2: { input: '10', display: '10' },
          A3: { input: '30', display: '30' },
          A4: { input: '40', display: '40' },
        },
      },
      bThenA: {
        cells: {
          A1: { input: '40', display: '40' },
          A2: { input: '20', display: '20' },
          A3: { input: '30', display: '30' },
          A4: { input: '10', display: '10' },
        },
      },
    },
  },
  {
    name: 'column move vs column insert at same index',
    relation: 'structure-structure',
    seed: [
      { kind: 'set-data', ref: 'B1', value: '10' },
      { kind: 'set-data', ref: 'C1', value: '20' },
      { kind: 'set-data', ref: 'D1', value: '30' },
    ],
    userA: { kind: 'move-columns', src: 2, count: 1, dst: 5 },
    userB: { kind: 'insert-columns', index: 2, count: 1 },
    observe: { refs: ['B1', 'C1', 'D1', 'E1'] },
    expect: {
      aThenB: {
        cells: {
          B1: { input: '', display: '' },
          C1: { input: '20', display: '20' },
          D1: { input: '30', display: '30' },
          E1: { input: '10', display: '10' },
        },
      },
      bThenA: {
        cells: {
          B1: { input: '10', display: '10' },
          C1: { input: '20', display: '20' },
          D1: { input: '', display: '' },
          E1: { input: '30', display: '30' },
        },
      },
    },
  },
  {
    name: 'formula reference vs row move',
    relation: 'shift-affected',
    seed: [
      { kind: 'set-data', ref: 'A1', value: '5' },
      { kind: 'set-data', ref: 'A2', value: '10' },
      { kind: 'set-data', ref: 'B3', value: '=A1+A2' },
    ],
    userA: { kind: 'move-rows', src: 2, count: 1, dst: 4 },
    userB: { kind: 'set-data', ref: 'A2', value: '20' },
    observe: { refs: ['A2', 'A3', 'B2'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '20', display: '20' },
          A3: { input: '10', display: '10' },
          B2: { input: '=A1+A3', display: '15' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '', display: '' },
          A3: { input: '20', display: '20' },
          B2: { input: '=A1+A3', display: '25' },
        },
      },
    },
  },

  // --- Column-symmetric and gap-coverage cases ---
  {
    name: 'column insert vs column insert at adjacent indexes',
    relation: 'structure-structure',
    seed: [{ kind: 'set-data', ref: 'B1', value: '10' }],
    userA: { kind: 'insert-columns', index: 2, count: 1 },
    userB: { kind: 'insert-columns', index: 3, count: 1 },
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
          C1: { input: '10', display: '10' },
          D1: { input: '', display: '' },
        },
      },
    },
  },
  {
    name: 'row delete vs row delete at different indexes',
    relation: 'structure-structure',
    seed: [
      { kind: 'set-data', ref: 'A2', value: '10' },
      { kind: 'set-data', ref: 'A3', value: '20' },
      { kind: 'set-data', ref: 'A4', value: '30' },
      { kind: 'set-data', ref: 'A5', value: '40' },
    ],
    userA: { kind: 'delete-rows', index: 2, count: 1 },
    userB: { kind: 'delete-rows', index: 4, count: 1 },
    observe: { refs: ['A2', 'A3', 'A4', 'A5'] },
    expect: {
      aThenB: {
        cells: {
          A2: { input: '20', display: '20' },
          A3: { input: '30', display: '30' },
          A4: { input: '', display: '' },
          A5: { input: '', display: '' },
        },
      },
      bThenA: {
        cells: {
          A2: { input: '20', display: '20' },
          A3: { input: '40', display: '40' },
          A4: { input: '', display: '' },
          A5: { input: '', display: '' },
        },
      },
    },
  },
  {
    name: 'column delete vs column insert at adjacent indexes',
    relation: 'structure-structure',
    seed: [
      { kind: 'set-data', ref: 'B1', value: '10' },
      { kind: 'set-data', ref: 'C1', value: '20' },
      { kind: 'set-data', ref: 'D1', value: '30' },
    ],
    userA: { kind: 'delete-columns', index: 2, count: 1 },
    userB: { kind: 'insert-columns', index: 3, count: 1 },
    observe: { refs: ['B1', 'C1', 'D1'] },
    expect: {
      aThenB: {
        cells: {
          B1: { input: '20', display: '20' },
          C1: { input: '', display: '' },
          D1: { input: '30', display: '30' },
        },
      },
      bThenA: {
        cells: {
          B1: { input: '', display: '' },
          C1: { input: '20', display: '20' },
          D1: { input: '30', display: '30' },
        },
      },
    },
  },
];

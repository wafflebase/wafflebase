import { parseRef, toRef } from '../../sheet/coordinates';
import { Ref, Cell, Grid } from '../../sheet/types';
import workerUrl from './worker?worker&url';
import { ResMessage } from './worker';

export async function createWorkerIDBStore(
  key: string,
): Promise<WorkerIDBStore> {
  const worker = new Worker(workerUrl, { type: 'module' });
  worker.postMessage({ method: 'init', args: [key] });

  return new Promise((resolve, reject) => {
    worker.onmessage = (event) => {
      if (event.data.result === 'created') {
        resolve(new WorkerIDBStore(worker));
        return;
      }

      reject(event.data.error);
    };
  });
}

/**
 * `Pending` is a promise that is pending.
 */
type Pending = {
  resolve: (value?: unknown) => void;
  reject: (reason?: any) => void;
};

export class WorkerIDBStore {
  private worker: Worker;

  private requestID = 0;
  private pendings: Map<number, Pending>;

  constructor(worker: Worker) {
    this.worker = worker;
    this.pendings = new Map();

    this.worker.onmessage = (event: MessageEvent<ResMessage>) => {
      const { id, error, result } = event.data;
      const request = this.pendings.get(id);
      if (!request) {
        return;
      }

      if (error) {
        request.reject(error);
      } else {
        request.resolve(result);
      }

      this.pendings.delete(id);
    };
  }

  set(ref: Ref, cell: Cell): Promise<void> {
    return this.postMessage('set', [ref, cell]);
  }

  get(ref: Ref): Promise<Cell | undefined> {
    return this.postMessage('get', [ref]);
  }

  has(ref: Ref): Promise<boolean> {
    return this.postMessage('has', [ref]);
  }

  delete(ref: Ref): Promise<boolean> {
    return this.postMessage('delete', [ref]);
  }

  setGrid(grid: Grid): Promise<void> {
    return this.postMessage('setGrid', [grid]);
  }

  range(from: Ref, to: Ref): AsyncIterable<[Ref, Cell]> {
    // TODO(hackerwins): This is a temporary implementation.
    const fromID = parseRef(from);
    const toID = parseRef(to);
    const that = this;
    return {
      [Symbol.asyncIterator]: async function* () {
        for (let row = fromID.row; row <= toID.row; row++) {
          for (let col = fromID.col; col <= toID.col; col++) {
            const ref = toRef({ row, col });
            const cell = await that.get(ref);
            if (cell !== undefined) {
              yield [ref, cell];
            }
          }
        }
      },
    };
  }

  [Symbol.asyncIterator](): AsyncIterator<[Ref, Cell]> {
    // TODO(hackerwins): This is a temporary implementation.
    return this.range('A1', 'ZZ1000')[Symbol.asyncIterator]();
  }

  private postMessage(method: string, args: any): Promise<any> {
    const id = this.requestID++;
    this.worker.postMessage({ id, method, args });
    return new Promise((resolve, reject) => {
      this.pendings.set(id, { resolve, reject });
    });
  }
}

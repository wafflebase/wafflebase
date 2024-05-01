import { Cell, Grid, Ref, Range, Sref } from '../../sheet/types';
import workerUrl from './worker?worker&url';
import { ResMessage } from './worker';

/**
 * `createWorkerIDBStore` creates a new `WorkerIDBStore` instance.
 */
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

/**
 * `WorkerIDBStore` is a store that communicates with a worker.
 */
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

  async getGrid(range: Range): Promise<Grid> {
    return (await this.postMessage('getGrid', [range])) as Grid;
  }

  async buildDependantsMap(
    srefs: Iterable<Sref>,
  ): Promise<Map<Sref, Set<Sref>>> {
    return (await this.postMessage('buildDependantsMap', [srefs])) as Map<
      Sref,
      Set<Sref>
    >;
  }

  private postMessage(method: string, args: any): Promise<any> {
    const id = this.requestID++;
    this.worker.postMessage({ id, method, args });
    return new Promise((resolve, reject) => {
      console.log(
        `IndexedDB: ${method} ${JSON.stringify(args)} ${this.pendings.size}`,
      );
      this.pendings.set(id, { resolve, reject });
    });
  }
}

import { Cell, Grid, Ref, Range } from '../../sheet/types';
import { IDBStore, createIDBStore } from './idb';

/**
 * `ReqMessage` is a message that is sent to the worker.
 */
export type ReqMessage =
  | {
      id: number;
      method: 'init';
      args: [string];
    }
  | {
      id: number;
      method: 'get';
      args: [Ref];
    }
  | {
      id: number;
      method: 'set';
      args: [Ref, Cell];
    }
  | {
      id: number;
      method: 'has';
      args: [Ref];
    }
  | {
      id: number;
      method: 'delete';
      args: [Ref];
    }
  | {
      id: number;
      method: 'setGrid';
      args: [Grid];
    }
  | {
      id: number;
      method: 'getGrid';
      args: [Range];
    };

/**
 * `ResMessage` is a message that is sent from the worker.
 */
export type ResMessage = {
  id: number;
  result: any;
  error?: string;
};

let store: IDBStore;
onmessage = async (event: MessageEvent<ReqMessage>) => {
  try {
    if (event.data.method === 'init') {
      const key = event.data.args[0];
      store = await createIDBStore(key);
      postMessage({ id: event.data.id, result: 'created' });
    } else if (event.data.method === 'get') {
      const ref = event.data.args[0];
      const cell = await store.get(ref);
      postMessage({ id: event.data.id, result: cell });
    } else if (event.data.method === 'set') {
      const ref = event.data.args[0];
      const cell = event.data.args[1];
      await store.set(ref, cell);
      postMessage({ id: event.data.id });
    } else if (event.data.method === 'has') {
      const ref = event.data.args[0];
      const has = await store.has(ref);
      postMessage({ id: event.data.id, result: has });
    } else if (event.data.method === 'delete') {
      const ref = event.data.args[0];
      const deleted = await store.delete(ref);
      postMessage({ id: event.data.id, result: deleted });
    } else if (event.data.method === 'setGrid') {
      const grid = event.data.args[0];
      await store.setGrid(grid);
      postMessage({ id: event.data.id });
    } else if (event.data.method === 'getGrid') {
      const range = event.data.args[0];
      const grid = await store.getGrid(range);
      postMessage({ id: event.data.id, result: grid });
    } else {
      postMessage({
        error: `Unknown Method: ${event.data}`,
      });
    }
  } catch (error) {
    postMessage({ error: error });
  }
};

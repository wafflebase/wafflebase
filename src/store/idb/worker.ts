import { Cell, Grid, Ref, Range, Sref } from '../../sheet/types';
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
    }
  | {
      id: number;
      method: 'buildDependantsMap';
      args: [Iterable<Sref>];
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
      const [key] = event.data.args;
      store = await createIDBStore(key);
      postMessage({ id: event.data.id, result: 'created' });
    } else if (event.data.method === 'get') {
      const [ref] = event.data.args;
      const cell = await store.get(ref);
      postMessage({ id: event.data.id, result: cell });
    } else if (event.data.method === 'set') {
      const [ref, cell] = event.data.args;
      await store.set(ref, cell);
      postMessage({ id: event.data.id });
    } else if (event.data.method === 'has') {
      const [ref] = event.data.args;
      const has = await store.has(ref);
      postMessage({ id: event.data.id, result: has });
    } else if (event.data.method === 'delete') {
      const [ref] = event.data.args;
      const deleted = await store.delete(ref);
      postMessage({ id: event.data.id, result: deleted });
    } else if (event.data.method === 'setGrid') {
      const [grid] = event.data.args;
      await store.setGrid(grid);
      postMessage({ id: event.data.id });
    } else if (event.data.method === 'getGrid') {
      const [range] = event.data.args;
      const grid = await store.getGrid(range);
      postMessage({ id: event.data.id, result: grid });
    } else if (event.data.method === 'buildDependantsMap') {
      const [srefs] = event.data.args;
      const dependantsMap = await store.buildDependantsMap(srefs);
      postMessage({ id: event.data.id, result: dependantsMap });
    } else {
      postMessage({
        error: `Unknown Method: ${event.data}`,
      });
    }
  } catch (error) {
    postMessage({ error: error });
  }
};

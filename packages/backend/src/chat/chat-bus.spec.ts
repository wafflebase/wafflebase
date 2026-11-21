import { Client } from 'pg';
import { PrismaService } from '../database/prisma.service';
import {
  CHAT_NOTIFY_CHANNEL,
  ChatBus,
  memPayload,
  parsePayload,
} from './chat-bus';

jest.mock('pg', () => {
  const { EventEmitter } =
    jest.requireActual<typeof import('events')>('events');
  class FakeClient extends EventEmitter {
    connect = jest.fn(() => Promise.resolve());
    query = jest.fn(() => Promise.resolve());
    end = jest.fn(() => Promise.resolve());
  }
  return { Client: jest.fn(() => new FakeClient()) };
});

describe('ChatBus', () => {
  const prisma = {
    $executeRaw: jest.fn(() => Promise.resolve(0)),
  } as unknown as PrismaService;

  it('bounds the listener connect and LISTEN with finite timeouts', async () => {
    const bus = new ChatBus(prisma);
    await bus.onModuleInit();
    await bus.onModuleDestroy();

    const options = (Client as unknown as jest.Mock<unknown, [unknown]>).mock
      .calls[0][0] as {
      connectionTimeoutMillis?: number;
      query_timeout?: number;
    };
    // pg waits forever on a handshake unless these are set.
    expect(options.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(Number.isFinite(options.connectionTimeoutMillis)).toBe(true);
    expect(options.query_timeout).toBeGreaterThan(0);
    expect(Number.isFinite(options.query_timeout)).toBe(true);
  });

  it('announces a reset on every connection, the first included', async () => {
    const bus = new ChatBus(prisma);
    const resets = jest.fn();
    bus.resets$.subscribe(resets);
    await bus.onModuleInit();
    await bus.onModuleDestroy();

    expect(resets).toHaveBeenCalledTimes(1);
  });
});

describe('parsePayload', () => {
  const msg = { t: 'msg', c: 'c1', w: 'w1', s: 3, r: null, a: 7, i: false };
  const upd = { t: 'upd', c: 'c1', w: 'w1', id: 'm1', r: 'root' };
  const json = (v: unknown) => JSON.stringify(v);

  it('accepts each well-formed event', () => {
    expect(parsePayload(json(msg))).toEqual(msg);
    expect(parsePayload(json({ ...msg, r: 'root', a: null, i: true }))).toEqual(
      { ...msg, r: 'root', a: null, i: true },
    );
    expect(parsePayload(json(upd))).toEqual(upd);
    expect(parsePayload(json({ t: 'mem', c: 'c1' }))).toEqual({
      t: 'mem',
      c: 'c1',
    });
    expect(parsePayload(json({ t: 'probe', id: 'p1' }))).toEqual({
      probe: 'p1',
    });
  });

  it('drops only the fields it knows', () => {
    expect(parsePayload(json({ ...msg, body: 'secret' }))).toEqual(msg);
  });

  it.each([
    ['nothing', undefined],
    ['an empty string', ''],
    ['non-JSON', '{not json'],
    ['a JSON string', json('msg')],
    ['a JSON number', '42'],
    ['null', 'null'],
    ['an array', json([msg])],
    ['a missing channel', json({ ...msg, c: undefined })],
    ['a numeric channel', json({ ...msg, c: 1 })],
    ['a mem with no channel', json({ t: 'mem' })],
    ['an unknown type', json({ ...msg, t: 'del' })],
    ['no type', json({ ...msg, t: undefined })],
    ['msg with a string seq', json({ ...msg, s: '3' })],
    ['msg with no workspace', json({ ...msg, w: undefined })],
    ['msg with a numeric workspace', json({ ...msg, w: 1 })],
    ['msg with a numeric thread root', json({ ...msg, r: 5 })],
    ['msg with a missing thread root', json({ ...msg, r: undefined })],
    ['msg with a string author', json({ ...msg, a: '7' })],
    ['msg with a missing author', json({ ...msg, a: undefined })],
    ['msg with a string alsoInChannel', json({ ...msg, i: 'true' })],
    ['msg with no alsoInChannel', json({ ...msg, i: undefined })],
    ['upd with a numeric id', json({ ...upd, id: 1 })],
    ['upd with no id', json({ ...upd, id: undefined })],
    ['upd with no workspace', json({ ...upd, w: undefined })],
    ['upd with a numeric thread root', json({ ...upd, r: 1 })],
    ['a probe with a numeric id', json({ t: 'probe', id: 1 })],
    ['a probe with no id', json({ t: 'probe' })],
  ])('rejects %s', (_label, raw) => {
    expect(parsePayload(raw)).toBeNull();
  });

  it('round-trips the membership payload other modules send', () => {
    expect(CHAT_NOTIFY_CHANNEL).toBe('chat');
    expect(parsePayload(memPayload('c9'))).toEqual({ t: 'mem', c: 'c9' });
  });
});

describe('ChatBus retry timer', () => {
  const prisma = {
    $executeRaw: jest.fn(() => Promise.resolve(0)),
  } as unknown as PrismaService;

  it('does not hold the process open while it waits to reconnect', async () => {
    const unref = jest.fn();
    const realSetTimeout = global.setTimeout;
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      const t = realSetTimeout(fn, ms);
      const original = t.unref.bind(t);
      t.unref = () => {
        unref();
        return original();
      };
      return t;
    }) as unknown as typeof setTimeout);
    (Client as unknown as jest.Mock).mockImplementationOnce(() => {
      const { EventEmitter } =
        jest.requireActual<typeof import('events')>('events');
      const client = new EventEmitter() as InstanceType<typeof EventEmitter> & {
        connect: jest.Mock;
        query: jest.Mock;
        end: jest.Mock;
      };
      client.connect = jest.fn(() => Promise.reject(new Error('refused')));
      client.query = jest.fn(() => Promise.resolve());
      client.end = jest.fn(() => Promise.resolve());
      return client;
    });
    const bus = new ChatBus(prisma);
    try {
      await bus.onModuleInit();
      expect(unref).toHaveBeenCalled();
    } finally {
      await bus.onModuleDestroy();
      spy.mockRestore();
    }
  });
});

describe('ChatBus reconnection', () => {
  const prisma = {
    $executeRaw: jest.fn(() => Promise.resolve(0)),
  } as unknown as PrismaService;
  const clientMock = Client as unknown as jest.Mock;

  type Fake = InstanceType<typeof import('events').EventEmitter> & {
    connect: jest.Mock;
    end: jest.Mock;
  };
  /** Every client the bus has constructed, oldest first. */
  const made = (): Fake[] =>
    clientMock.mock.results.map((r) => r.value as Fake);

  beforeEach(() => {
    jest.useFakeTimers();
    clientMock.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ['an error', (c: Fake) => c.emit('error', new Error('reset by peer'))],
    ['an end', (c: Fake) => c.emit('end')],
  ])(
    'reconnects after %s with backoff and announces a second reset',
    async (_label, kill) => {
      const bus = new ChatBus(prisma);
      const resets = jest.fn();
      bus.resets$.subscribe(resets);
      try {
        await bus.onModuleInit();
        expect(made()).toHaveLength(1);
        expect(resets).toHaveBeenCalledTimes(1);

        const first = made()[0];
        kill(first);
        // The broken client is torn down, and nothing reconnects before the
        // backoff elapses.
        expect(first.end).toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(999);
        expect(made()).toHaveLength(1);

        await jest.advanceTimersByTimeAsync(1);
        expect(made()).toHaveLength(2);
        expect(made()[1].connect).toHaveBeenCalled();
        // Events NOTIFYed while it was down are lost, so consumers must be
        // told to drop caches and catch up.
        expect(resets).toHaveBeenCalledTimes(2);
      } finally {
        await bus.onModuleDestroy();
      }
    },
  );

  it('a failed connect that also emits error schedules one reconnect', async () => {
    // pg both rejects `connect()` and emits `error` when a handshake fails,
    // so the catch and the error handler each see the same failure.
    clientMock.mockImplementationOnce(() => {
      const { EventEmitter } =
        jest.requireActual<typeof import('events')>('events');
      const client = new EventEmitter() as Fake & { query: jest.Mock };
      client.connect = jest.fn(() => {
        client.emit('error', new Error('refused'));
        return Promise.reject(new Error('refused'));
      });
      client.query = jest.fn(() => Promise.resolve());
      client.end = jest.fn(() => Promise.resolve());
      return client;
    });
    const bus = new ChatBus(prisma);
    const resets = jest.fn();
    bus.resets$.subscribe(resets);
    try {
      await bus.onModuleInit();
      expect(resets).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(10_000);
      expect(made()).toHaveLength(2);
      expect(resets).toHaveBeenCalledTimes(1);
    } finally {
      await bus.onModuleDestroy();
    }
  });

  it('schedules one reconnect however many times the client fails', async () => {
    const bus = new ChatBus(prisma);
    const resets = jest.fn();
    bus.resets$.subscribe(resets);
    try {
      await bus.onModuleInit();
      const first = made()[0];
      first.emit('error', new Error('one'));
      first.emit('error', new Error('two'));
      first.emit('end');

      await jest.advanceTimersByTimeAsync(10_000);
      // One replacement client, one more reset — not one per event.
      expect(made()).toHaveLength(2);
      expect(resets).toHaveBeenCalledTimes(2);
    } finally {
      await bus.onModuleDestroy();
    }
  });
});

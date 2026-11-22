import { Client } from 'pg';
import { PgBus, sharedPgBus } from './pg-bus';

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

type Fake = InstanceType<typeof import('events').EventEmitter> & {
  connect: jest.Mock;
  query: jest.Mock;
  end: jest.Mock;
};

const clientMock = Client as unknown as jest.Mock;
const made = (): Fake[] => clientMock.mock.results.map((r) => r.value as Fake);
const queries = (c: Fake): string[] =>
  (c.query.mock.calls as unknown[][]).map((call) => String(call[0]));

describe('PgBus', () => {
  beforeEach(() => clientMock.mockClear());

  it('opens nothing until somebody listens', () => {
    new PgBus();
    expect(made()).toHaveLength(0);
  });

  it('shares one client between channels and routes by channel', async () => {
    const bus = new PgBus();
    const chat = jest.fn();
    const webhook = jest.fn();
    const offChat = await bus.listen('chat', { onNotify: chat });
    const offWebhook = await bus.listen('webhook', { onNotify: webhook });

    expect(made()).toHaveLength(1);
    expect(queries(made()[0])).toEqual(['LISTEN chat', 'LISTEN webhook']);

    made()[0].emit('notification', { channel: 'webhook', payload: 'w1' });
    made()[0].emit('notification', { channel: 'chat', payload: 'c1' });
    made()[0].emit('notification', { channel: 'other', payload: 'x' });
    expect(webhook).toHaveBeenCalledWith('w1');
    expect(chat).toHaveBeenCalledWith('c1');
    expect(chat).toHaveBeenCalledTimes(1);

    await offChat();
    expect(queries(made()[0])).toContain('UNLISTEN chat');
    expect(made()[0].end).not.toHaveBeenCalled();
    await offWebhook();
    // The last subscriber leaving closes the connection.
    expect(made()[0].end).toHaveBeenCalled();
    expect(bus.size).toBe(0);
  });

  it('fires onConnect for a subscriber that joins a live connection', async () => {
    const bus = new PgBus();
    const first = jest.fn();
    const second = jest.fn();
    const off1 = await bus.listen('chat', {
      onNotify: jest.fn(),
      onConnect: first,
    });
    const off2 = await bus.listen('chat', {
      onNotify: jest.fn(),
      onConnect: second,
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    // A second subscriber on a channel already listened needs no LISTEN.
    expect(queries(made()[0])).toEqual(['LISTEN chat']);
    await off1();
    await off2();
  });

  it('keeps delivering when one handler throws', async () => {
    const bus = new PgBus();
    const good = jest.fn();
    const off1 = await bus.listen('chat', {
      onNotify: () => {
        throw new Error('boom');
      },
    });
    const off2 = await bus.listen('chat', { onNotify: good });
    made()[0].emit('notification', { channel: 'chat', payload: 'p' });
    expect(good).toHaveBeenCalledWith('p');
    await off1();
    await off2();
  });

  it('refuses a channel name it would have to quote', async () => {
    const bus = new PgBus();
    await expect(
      bus.listen('chat; DROP TABLE x', { onNotify: jest.fn() }),
    ).rejects.toThrow('invalid LISTEN channel name');
    expect(made()).toHaveLength(0);
  });

  it('reconnects with every channel and tells every subscriber', async () => {
    jest.useFakeTimers();
    const bus = new PgBus();
    const chat = jest.fn();
    const webhook = jest.fn();
    try {
      const off1 = await bus.listen('chat', {
        onNotify: jest.fn(),
        onConnect: chat,
      });
      const off2 = await bus.listen('webhook', {
        onNotify: jest.fn(),
        onConnect: webhook,
      });
      made()[0].emit('error', new Error('reset by peer'));
      expect(made()[0].end).toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1_000);
      expect(made()).toHaveLength(2);
      expect(queries(made()[1])).toEqual(['LISTEN chat', 'LISTEN webhook']);
      expect(chat).toHaveBeenCalledTimes(2);
      expect(webhook).toHaveBeenCalledTimes(2);
      await off1();
      await off2();
    } finally {
      jest.useRealTimers();
    }
  });

  it('restarts cleanly after everyone left', async () => {
    const bus = new PgBus();
    const off = await bus.listen('chat', { onNotify: jest.fn() });
    await off();
    const onConnect = jest.fn();
    const again = await bus.listen('chat', { onNotify: jest.fn(), onConnect });
    expect(made()).toHaveLength(2);
    expect(onConnect).toHaveBeenCalledTimes(1);
    await again();
  });

  it('honours CHAT_LISTEN_DATABASE_URL over DATABASE_URL', async () => {
    const saved = {
      listen: process.env.CHAT_LISTEN_DATABASE_URL,
      db: process.env.DATABASE_URL,
    };
    process.env.CHAT_LISTEN_DATABASE_URL = 'postgresql://direct/db';
    process.env.DATABASE_URL = 'postgresql://pooler/db';
    try {
      const bus = new PgBus();
      const off = await bus.listen('webhook', { onNotify: jest.fn() });
      const options = (clientMock.mock.calls as unknown[][])[0][0] as {
        connectionString: string;
      };
      expect(options.connectionString).toBe('postgresql://direct/db');
      await off();
    } finally {
      if (saved.listen === undefined)
        delete process.env.CHAT_LISTEN_DATABASE_URL;
      else process.env.CHAT_LISTEN_DATABASE_URL = saved.listen;
      if (saved.db === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved.db;
    }
  });

  it('hands out one process-wide instance', () => {
    expect(sharedPgBus()).toBe(sharedPgBus());
  });
});

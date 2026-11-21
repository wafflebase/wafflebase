import { Client } from 'pg';
import { PrismaService } from '../database/prisma.service';
import { ChatBus } from './chat-bus';

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

  it('bounds the listener connect and LISTEN so a stalled server reaches retry', async () => {
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

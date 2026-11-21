import { firstValueFrom, filter, timeout } from 'rxjs';
import { PrismaService } from 'src/database/prisma.service';
import { ChatBus } from 'src/chat/chat-bus';
import { ChatBusEvent } from 'src/chat/chat.types';
import {
  describeDb,
  setIntegrationEnvDefaults,
} from './helpers/integration-helpers';

/**
 * The multi-replica claim: two buses on one database — standing in for two
 * backend replicas — hear each other's NOTIFY. Writes no rows, so it needs no
 * `clearDatabase` and can run beside suites that do.
 */
describeDb('ChatBus LISTEN/NOTIFY integration', () => {
  let prismaA: PrismaService;
  let prismaB: PrismaService;
  let busA: ChatBus;
  let busB: ChatBus;

  beforeAll(async () => {
    setIntegrationEnvDefaults();
    prismaA = new PrismaService();
    prismaB = new PrismaService();
    await Promise.all([prismaA.$connect(), prismaB.$connect()]);
    busA = new ChatBus(prismaA);
    busB = new ChatBus(prismaB);
    await Promise.all([busA.onModuleInit(), busB.onModuleInit()]);
  });

  afterAll(async () => {
    await Promise.all([busA?.onModuleDestroy(), busB?.onModuleDestroy()]);
    await Promise.all([prismaA?.$disconnect(), prismaB?.$disconnect()]);
  });

  function next(bus: ChatBus, channelId: string): Promise<ChatBusEvent> {
    return firstValueFrom(
      bus.events$.pipe(
        filter((e) => e.c === channelId),
        timeout(5_000),
      ),
    );
  }

  it("two ChatBus instances on one database receive each other's notify", async () => {
    const channelId = `bus-e2e-${Date.now()}`;
    const event = {
      t: 'msg' as const,
      c: channelId,
      w: 'w-e2e',
      s: 42,
      r: null,
      a: 7,
    };

    const atA = next(busA, channelId);
    const atB = next(busB, channelId);
    await busA.notifyMessage(event);

    expect(await atB).toEqual(event);
    expect(await atA).toEqual(event);

    const memAtA = next(busA, `${channelId}-mem`);
    await busB.notifyMembership(`${channelId}-mem`);
    expect(await memAtA).toEqual({ t: 'mem', c: `${channelId}-mem` });

    const upd = {
      t: 'upd' as const,
      c: `${channelId}-upd`,
      w: 'w-e2e',
      id: 'm-e2e',
      r: 'root-e2e',
    };
    const updAtB = next(busB, upd.c);
    await busA.notifyUpdate(upd);
    expect(await updAtB).toEqual(upd);
  });
});

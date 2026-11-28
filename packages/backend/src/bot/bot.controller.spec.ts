import { BotController, BotPairingController } from './bot.controller';
import type { AuthenticatedRequest } from '../auth/auth.types';

const REQ = { user: { id: '7' } } as unknown as AuthenticatedRequest;

function harness() {
  const botService = {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 50 }),
    remove: jest.fn().mockResolvedValue(undefined),
    createPairingCode: jest
      .fn()
      .mockResolvedValue({ code: 'ABCD-EFGH', expiresAt: 'later' }),
    pair: jest.fn().mockResolvedValue({ botId: 50 }),
  };
  return {
    botService,
    controller: new BotController(botService as never),
    pairing: new BotPairingController(botService as never),
  };
}

describe('BotController', () => {
  it('passes the caller as a number and the workspace as given', async () => {
    const { controller, botService } = harness();

    await controller.list('team', REQ);
    await controller.create('team', REQ, { name: 'deck-bot' });
    await controller.remove('team', 50, REQ);
    await controller.createPairingCode('team', 50, REQ);

    expect(botService.list).toHaveBeenCalledWith('team', 7);
    expect(botService.create).toHaveBeenCalledWith('team', 7, 'deck-bot');
    expect(botService.remove).toHaveBeenCalledWith('team', 7, 50);
    expect(botService.createPairingCode).toHaveBeenCalledWith('team', 7, 50);
  });
});

describe('BotPairingController', () => {
  it('exchanges the code for the host', async () => {
    const { pairing, botService } = harness();

    await expect(
      pairing.pair({ code: 'ABCD-EFGH', hostName: 'MacBook' }),
    ).resolves.toEqual({ botId: 50 });
    expect(botService.pair).toHaveBeenCalledWith('ABCD-EFGH', 'MacBook');
  });
});

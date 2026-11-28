import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  createBot,
  createPairingCode,
  deleteBot,
  fetchBots,
  type BotDto,
} from '@/api/bots';
import { BotsSection } from '../bots-section';
import { hostStatus } from '../bot-status';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/api/bots', () => ({
  fetchBots: vi.fn(),
  createBot: vi.fn(),
  deleteBot: vi.fn(),
  createPairingCode: vi.fn(),
}));

const NOW = new Date('2026-11-28T12:00:00.000Z').getTime();
const ME = 1;

function bot(
  id: number,
  username: string,
  lastSeenAt: string | null,
  ownerId = ME,
): BotDto {
  return {
    id,
    username,
    photo: null,
    invokers: 'owner',
    owner: { id: ownerId, username: ownerId === ME ? 'me' : 'someone' },
    createdAt: '2026-11-01T00:00:00.000Z',
    lastSeenAt,
    hosts: [],
  };
}

const NEVER = bot(10, 'drafter', null);
const LISTENING = bot(11, 'reviewer', new Date(NOW - 20_000).toISOString());
const OFFLINE = bot(12, 'triager', new Date(NOW - 5 * 60_000).toISOString());
const SOMEONE_ELSES = bot(13, 'theirs', null, 2);

function renderSection(bots: BotDto[], isOwner = false) {
  vi.mocked(fetchBots).mockResolvedValue(bots);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BotsSection workspaceId="ws-1" meId={ME} isOwner={isOwner} />
    </QueryClientProvider>,
  );
}

function botRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest('tr');
  if (!row) throw new Error(`No bot row for ${name}`);
  return row;
}

describe('hostStatus', () => {
  it('reads lastSeenAt against a 60 s window', () => {
    expect(hostStatus(null, NOW)).toEqual({
      state: 'none',
      text: 'Not connected',
    });
    expect(hostStatus(new Date(NOW - 59_000).toISOString(), NOW)).toEqual({
      state: 'listening',
      text: 'Listening',
    });
    expect(hostStatus(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toEqual({
      state: 'offline',
      text: 'Offline · last seen 5 min ago',
    });
  });
});

describe('BotsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists bots with their host status as text', async () => {
    renderSection([NEVER, LISTENING, OFFLINE]);

    await screen.findByText('drafter');
    expect(within(botRow('drafter')).getByText('Not connected')).toBeTruthy();
    expect(within(botRow('reviewer')).getByText('Listening')).toBeTruthy();
    expect(
      within(botRow('triager')).getByText('Offline · last seen 5 min ago'),
    ).toBeTruthy();
    // The status is announced as it changes.
    expect(
      within(botRow('reviewer'))
        .getByText('Listening')
        .closest("[aria-live='polite']"),
    ).toBeTruthy();
    expect(within(botRow('drafter')).getByText('Bot')).toBeTruthy();
  });

  // `User.botOwnerId` is `onDelete: SetNull`: a bot whose owner's account
  // was deleted comes back with no owner, and the table must still render.
  it('renders a bot whose owner is gone', async () => {
    renderSection([{ ...NEVER, owner: null }]);
    await screen.findByText('drafter');
    expect(within(botRow('drafter')).getByText('—')).toBeTruthy();
    expect(
      within(botRow('drafter')).queryByRole('button', { name: /delete/i }),
    ).toBeNull();
  });

  it('says so when there are no bots', async () => {
    renderSection([]);
    expect(await screen.findByText(/No bots yet/)).toBeTruthy();
  });

  it('creates a bot, then shows its pairing code and both ways to use it', async () => {
    vi.mocked(createBot).mockResolvedValue(bot(20, 'helper', null));
    vi.mocked(createPairingCode).mockResolvedValue({
      code: 'ABCD-EFGH',
      expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
    });
    renderSection([]);

    await userEvent.click(
      await screen.findByRole('button', { name: /New bot/ }),
    );
    const dialog = await screen.findByRole('dialog');
    // Only "Just me" is available in this release.
    expect(
      within(dialog)
        .getByRole('radio', { name: /Just me/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      within(dialog).getByRole('radio', { name: /Any member/ }),
    ).toHaveProperty('disabled', true);
    expect(within(dialog).getByText('Available with team bots')).toBeTruthy();

    await userEvent.type(within(dialog).getByLabelText('Bot name'), 'helper');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Create' }),
    );

    await waitFor(() =>
      expect(vi.mocked(createBot)).toHaveBeenCalledWith('ws-1', 'helper'),
    );
    await waitFor(() =>
      expect(vi.mocked(createPairingCode)).toHaveBeenCalledWith('ws-1', 20),
    );

    const connect = await screen.findByRole('dialog', {
      name: /Connect helper/,
    });
    expect(within(connect).getByText('ABCD-EFGH')).toBeTruthy();
    expect(
      within(connect).getByText('/wafflebase:listen ABCD-EFGH'),
    ).toBeTruthy();
    expect(
      within(connect).getByText(
        /wafflebase( --server \S+)? agent pair ABCD-EFGH/,
      ),
    ).toBeTruthy();
    expect(within(connect).getByText(/Expires/)).toBeTruthy();
    expect(
      within(connect)
        .getByText('Not connected')
        .closest("[aria-live='polite']"),
    ).toBeTruthy();

    vi.mocked(createPairingCode).mockResolvedValue({
      code: 'WXYZ-2345',
      expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
    });
    await userEvent.click(
      within(connect).getByRole('button', { name: 'New code' }),
    );
    expect(await within(connect).findByText('WXYZ-2345')).toBeTruthy();
  });

  it('refuses a name the server would', async () => {
    renderSection([]);
    await userEvent.click(
      await screen.findByRole('button', { name: /New bot/ }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(
      within(dialog).getByLabelText('Bot name'),
      'Helper Bot',
    );
    expect(
      within(dialog).getByRole('button', { name: 'Create' }),
    ).toHaveProperty('disabled', true);
  });

  it('asks before deleting, naming the bot', async () => {
    vi.mocked(deleteBot).mockResolvedValue(undefined);
    renderSection([NEVER]);

    await userEvent.click(
      within(await waitFor(() => botRow('drafter'))).getByRole('button', {
        name: 'Delete drafter',
      }),
    );
    expect(vi.mocked(deleteBot)).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', {
      name: /Delete drafter/,
    });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() =>
      expect(vi.mocked(deleteBot)).toHaveBeenCalledWith('ws-1', NEVER.id),
    );
  });

  it('offers Connect and Delete only for bots the viewer manages', async () => {
    renderSection([NEVER, SOMEONE_ELSES]);
    await screen.findByText('theirs');
    expect(
      within(botRow('theirs')).queryByRole('button', { name: /Delete/ }),
    ).toBeNull();
    expect(
      within(botRow('drafter')).getByRole('button', { name: /Delete/ }),
    ).toBeTruthy();
  });

  it('lets a workspace owner manage every bot', async () => {
    renderSection([SOMEONE_ELSES], true);
    await screen.findByText('theirs');
    expect(
      within(botRow('theirs')).getByRole('button', { name: 'Delete theirs' }),
    ).toBeTruthy();
  });
});

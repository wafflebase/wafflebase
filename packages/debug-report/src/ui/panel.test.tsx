import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createSession,
  createStore,
  memoryBlobs,
  memoryMeta,
  type DebugItem,
  type Environment,
  type HostAdapter,
} from '../index';
import { DebugPanel } from './panel';

const env: Environment = {
  route: '/s/:id',
  viewport: { w: 1280, h: 800 },
  dpr: 2,
  theme: 'light',
  userAgent: 'test',
};

const draft = (itemId: string, kind = 'spacing') => ({
  itemId,
  title: `Give ${itemId} room to breathe`,
  body: 'The icon row has no gap.',
  severity: 'minor',
  kind,
  labels: ['ui'],
});

function host(overrides: Partial<HostAdapter> = {}): HostAdapter {
  return {
    route: () => '/s/:id',
    buildSha: () => 'abc123',
    theme: () => 'light',
    environment: () => env,
    locate: async () => undefined,
    draft: async () => ({ drafts: [], proposedGroups: [] }),
    send: async () => ({ ok: true, ref: '.wb-reports/s1' }),
    ...overrides,
  };
}

function seededSession(notes: string[]) {
  let n = 0;
  const session = createSession({ newId: () => `i${++n}` });
  for (const note of notes) {
    session.add({ note, target: { kind: 'viewport', rect: { x: 0, y: 0, w: 10, h: 10 } } });
  }
  return session;
}

function renderPanel(options: {
  notes?: string[];
  host?: HostAdapter;
  onClose?: () => void;
} = {}) {
  const session = seededSession(options.notes ?? ['toolbar is cramped', 'undo goes one short']);
  const store = createStore({ blobs: memoryBlobs(), meta: memoryMeta() });
  const view = render(
    <DebugPanel
      session={session}
      store={store}
      host={options.host ?? host()}
      sessionId="s1"
      onClose={options.onClose ?? (() => {})}
    />,
  );
  return { session, store, view };
}

describe('DebugPanel', () => {
  it('shows every collected sentence, editable', async () => {
    const { session } = renderPanel();
    expect(screen.getAllByLabelText('What is wrong?').map((el) => (el as HTMLTextAreaElement).value))
      .toEqual(['toolbar is cramped', 'undo goes one short']);

    // TYPED SHORT, AND WITH NO KEYSTROKE DELAY, because this test was 25% away
    // from failing. Every character re-renders the panel and re-runs the
    // drafting effect: the original 29-character sentence measured 3.7s on an
    // idle machine against vitest's 5s default, and timed out under load. Short
    // it measures ~1.1s. What the test has to prove is that a keystroke reaches
    // the session, and three characters prove that exactly as well as
    // twenty-nine.
    const typist = userEvent.setup({ delay: null });
    const first = screen.getAllByLabelText('What is wrong?')[0];
    await typist.clear(first);
    await typist.type(first, 'gap');
    expect(session.items()[0].note).toBe('gap');
  });

  it('renders the agent’s issue text next to the reporter’s sentence, and lets them edit it', async () => {
    // The reporter is the author: a draft that quietly replaced the observation
    // would be the one failure this feature cannot survive.
    renderPanel({
      host: host({
        draft: async () => ({
          drafts: [draft('i1'), draft('i2')],
          proposedGroups: [
            { id: 'g1', kind: 'spacing', itemIds: ['i1', 'i2'], prTitle: 'Room to breathe' },
          ],
        }),
      }),
    });
    await waitFor(() =>
      expect(screen.getAllByLabelText('Issue title')).toHaveLength(2),
    );
    const title = screen.getAllByLabelText('Issue title')[0];
    expect(title).toHaveProperty('value', 'Give i1 room to breathe');
    // And the sentence is still on screen next to it.
    expect(screen.getAllByLabelText('What is wrong?')[0]).toHaveProperty(
      'value',
      'toolbar is cramped',
    );
    await userEvent.type(title, '!');
    expect(screen.getAllByLabelText('Issue title')[0]).toHaveProperty(
      'value',
      'Give i1 room to breathe!',
    );
  });

  it('says drafting is unavailable, and still lets the batch go', async () => {
    renderPanel({
      host: host({
        draft: async () => {
          throw new Error('not-configured: no model credential');
        },
      }),
    });
    const note = await screen.findByTestId('debug-draft-note');
    expect(note.textContent).toMatch(/No model credential/);
    // One PR per item is the degraded shape, and the button still works.
    await waitFor(() => expect(screen.getAllByTestId('debug-group')).toHaveLength(2));
    expect(screen.getByRole('button', { name: /hand over 2 report/i })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('drops an item from the batch without deleting it', async () => {
    const { session } = renderPanel();
    const first = screen.getAllByTestId('debug-item')[0];
    await userEvent.click(within(first).getByRole('button', { name: 'Drop' }));
    expect(session.items()[0].disposition).toBe('discard');
    expect(session.count()).toBe(2);
    expect(screen.getByRole('button', { name: /hand over 1 report/i })).toBeTruthy();
  });

  it('deletes an item outright', async () => {
    const { session } = renderPanel();
    const first = screen.getAllByTestId('debug-item')[0];
    await userEvent.click(within(first).getByRole('button', { name: 'Delete' }));
    expect(session.count()).toBe(1);
  });

  it('records the agent:candidate intent', async () => {
    const { session } = renderPanel({ notes: ['one'] });
    await userEvent.click(screen.getByRole('checkbox'));
    expect(session.items()[0].agentCandidate).toBe(true);
  });

  describe('the three operations on a PR', () => {
    const grouped = () =>
      renderPanel({
        host: host({
          draft: async () => ({
            drafts: [draft('i1'), draft('i2')],
            proposedGroups: [
              { id: 'g1', kind: 'spacing', itemIds: ['i1', 'i2'], prTitle: 'Room to breathe' },
            ],
          }),
        }),
      });

    it('detaches an item into its own PR', async () => {
      grouped();
      await waitFor(() => expect(screen.getAllByTestId('debug-group')).toHaveLength(1));
      await userEvent.click(screen.getAllByRole('button', { name: 'Detach' })[0]);
      expect(screen.getAllByTestId('debug-group')).toHaveLength(2);
    });

    it('splits a PR into one per item', async () => {
      grouped();
      await waitFor(() => expect(screen.getAllByTestId('debug-group')).toHaveLength(1));
      await userEvent.click(screen.getByRole('button', { name: 'Split' }));
      expect(screen.getAllByTestId('debug-group')).toHaveLength(2);
    });

    it('merges two PRs and warns when they are different kinds', async () => {
      // Warned, never blocked: the reporter knows things the rules do not.
      renderPanel({
        host: host({
          draft: async () => ({
            drafts: [draft('i1'), draft('i2', 'logic')],
            proposedGroups: [],
          }),
        }),
      });
      await waitFor(() => expect(screen.getAllByTestId('debug-group')).toHaveLength(2));
      const [first, second] = screen.getAllByTestId('debug-group');
      await userEvent.click(within(first).getByRole('button', { name: /merge with/i }));
      await userEvent.click(within(second).getByRole('button', { name: /merge with/i }));
      expect(screen.getAllByTestId('debug-group')).toHaveLength(1);
      expect(screen.getByTestId('debug-panel-warning').textContent).toMatch(/different kinds/);
    });
  });

  describe('handing over', () => {
    it('sends what was confirmed and reports where it went', async () => {
      const send = vi.fn(async () => ({ ok: true as const, ref: '.wb-reports/s1' }));
      const { session } = renderPanel({ host: host({ send }) });
      await userEvent.click(screen.getByRole('button', { name: /hand over/i }));
      await waitFor(() => expect(send).toHaveBeenCalledOnce());
      expect(screen.getByTestId('debug-panel-report').textContent).toContain('.wb-reports/s1');
      // A successful handover empties the basket.
      await waitFor(() => expect(session.count()).toBe(0));
    });

    it('KEEPS the batch when the send fails', async () => {
      // Emptying the basket on a failed send would lose the batch it failed to
      // deliver.
      const { session } = renderPanel({
        host: host({ send: async () => ({ ok: false, error: 'the dev server did not answer' }) }),
      });
      await userEvent.click(screen.getByRole('button', { name: /hand over/i }));
      await waitFor(() =>
        expect(screen.getByTestId('debug-panel-report').textContent).toMatch(/^Nothing was sent/),
      );
      expect(session.count()).toBe(2);
    });

    it('KEEPS the batch when the send THROWS, and says so', async () => {
      // `handOver` reports a refused send in its result, but it can still throw
      // — reading a capture out of IndexedDB, or the adapter itself. Without a
      // catch the rejection was unhandled, the button re-enabled, and the click
      // did nothing visible: the one outcome a consent gate may not produce.
      const { session } = renderPanel({
        host: host({
          send: async () => {
            throw new Error('IndexedDB is closing');
          },
        }),
      });
      await userEvent.click(screen.getByRole('button', { name: /hand over/i }));
      await waitFor(() =>
        expect(screen.getByTestId('debug-panel-report').textContent).toMatch(
          /Nothing was sent.*IndexedDB is closing/,
        ),
      );
      expect(session.count()).toBe(2);
      // Re-enabled, so the reporter can retry rather than reload.
      expect(
        (screen.getByRole('button', { name: /hand over/i }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    it('says the shape is not a promise about the PR count', async () => {
      renderPanel({
        host: host({
          draft: async () => ({ drafts: [draft('i1')], proposedGroups: [] }),
        }),
      });
      await waitFor(() => expect(screen.getAllByTestId('debug-group').length).toBeGreaterThan(0));
      expect(screen.getByText(/merged on the repository side/i)).toBeTruthy();
    });

    it('cannot hand over an empty batch', () => {
      renderPanel({ notes: [] });
      expect(screen.getByRole('button', { name: /hand over 0 report/i })).toHaveProperty(
        'disabled',
        true,
      );
    });
  });

  it('shows the image that would leave, which is the consent gate', async () => {
    const session = seededSession([]);
    const store = createStore({ blobs: memoryBlobs(), meta: memoryMeta() });
    const put = await store.putCapture({
      dataUrl: `data:image/jpeg;base64,${'A'.repeat(64)}`,
      w: 40,
      h: 20,
      layers: 1,
    });
    if (!put.ok) throw new Error('setup failed');
    const item: DebugItem = {
      id: 'i1',
      createdAt: 1,
      note: 'the border is broken',
      target: { kind: 'canvas', surface: 'sheet', address: 'Sheet1!C7', rect: { x: 0, y: 0, w: 1, h: 1 } },
      capture: put.capture,
      disposition: 'verify',
      agentCandidate: false,
    };
    session.replaceAll([item]);
    render(
      <DebugPanel
        session={session}
        store={store}
        host={host()}
        sessionId="s1"
        onClose={() => {}}
      />,
    );
    const img = await screen.findByAltText('capture for the border is broken');
    expect(img.getAttribute('src')).toMatch(/^data:image\/jpeg/);
    expect(screen.getByText(/Sheet1!C7/)).toBeTruthy();
  });
});

describe('DebugPanel · what a successful handover leaves behind', () => {
  it('refuses to send a report whose sentence was cleared', async () => {
    // `parseBundle` rejects an empty note, so sending one would mean the reporter
    // is told it went, the session is emptied, and intake destroys it.
    const send = vi.fn(async () => ({ ok: true as const, ref: 'ref' }));
    renderPanel({ notes: ['will be cleared'], host: host({ send }) });
    await userEvent.clear(screen.getAllByLabelText('What is wrong?')[0]);
    expect(screen.getByTestId('debug-blank-note').textContent).toMatch(/empty sentence/);
    expect(screen.getByRole('button', { name: /hand over/i })).toHaveProperty('disabled', true);
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps the reports the cap held back instead of clearing them away', async () => {
    // The reporter is told they "stayed queued"; clearing the session would
    // destroy exactly those.
    const notes = Array.from({ length: 7 }, (_, i) => `report ${i}`);
    const { session } = renderPanel({
      notes,
      host: host({
        draft: async () => ({
          drafts: notes.map((_, i) => draft(`i${i + 1}`)),
          proposedGroups: notes.map((_, i) => ({
            id: `g${i}`,
            kind: 'spacing',
            itemIds: [`i${i + 1}`],
            prTitle: `P${i}`,
          })),
        }),
      }),
    });
    await waitFor(() => expect(screen.getAllByTestId('debug-group')).toHaveLength(7));
    await userEvent.click(screen.getByRole('button', { name: /hand over/i }));
    await waitFor(() =>
      expect(screen.getByTestId('debug-panel-report').textContent).toMatch(/stayed queued/),
    );
    expect(session.items().map((i) => i.note)).toEqual(['report 5', 'report 6']);
  });

  it('sweeps the blobs the sent batch left behind', async () => {
    // Orphan images otherwise fill the eviction budget, and the next capture
    // evicts a LIVE one from the current batch.
    const session = seededSession(['one']);
    const store = createStore({ blobs: memoryBlobs(), meta: memoryMeta() });
    const sweep = vi.spyOn(store, 'sweep');
    render(
      <DebugPanel
        session={session}
        store={store}
        host={host()}
        sessionId="s1"
        onClose={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /hand over/i }));
    await waitFor(() => expect(sweep).toHaveBeenCalled());
  });
});

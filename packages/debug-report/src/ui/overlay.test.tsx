import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { debugSession, type HostAdapter } from '../index';
import { DebugOverlay } from './overlay';

/**
 * Lets one test make the capture REJECT, through the boundary the overlay
 * actually calls. Pass-through by default, so nothing else here is affected.
 */
const captureFailure = vi.hoisted(() => ({ message: '' }));
vi.mock('./capture-item', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./capture-item')>();
  return {
    ...actual,
    captureAtPoint: (...args: Parameters<typeof actual.captureAtPoint>) =>
      captureFailure.message
        ? Promise.reject(new Error(captureFailure.message))
        : actual.captureAtPoint(...args),
  };
});

/**
 * These tests are the regression net for the two findings that reshaped this
 * component (`docs/design/debug-report.md`, findings 5 and 8):
 *
 *   - the overlay must not take the pointer, because the state being reported
 *     is often a hover or a drag that the taking would destroy;
 *   - nothing may be dropped in silence.
 *
 * The session is a process singleton by design (a report lost to a remount is
 * lost for good), so it is reset here rather than injected — which also means
 * these exercise the real wiring the app uses.
 */
beforeEach(() => {
  debugSession.clear();
  debugSession.setMode('off');
  localStorage.clear();
});

afterEach(() => {
  debugSession.clear();
  debugSession.setMode('off');
});

const toggle = { key: 'Y', ctrlKey: true, shiftKey: true, bubbles: true };

/**
 * Dispatched on `document`, as a real key press arrives: the overlay listens on
 * `window` in the CAPTURE phase, so it sees the event first and can stop it
 * before a document-level app listener would — which is the behaviour several
 * of these tests are about.
 */
const press = (init: KeyboardEventInit) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });

const moveMouse = (x: number, y: number) =>
  act(() => {
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }),
    );
  });

/**
 * A host that answers, so the review path is exercised rather than crashing into
 * a swallowed TypeError. `draft` returns nothing useful on purpose: these tests
 * are about the overlay, and the panel's own suite covers drafting.
 */
const testHost = (): HostAdapter => ({
  route: () => '/s/:id',
  buildSha: () => undefined,
  theme: () => 'light',
  environment: () => ({
    route: '/s/:id',
    viewport: { w: 1280, h: 800 },
    dpr: 1,
    theme: 'light',
    userAgent: 'test',
  }),
  locate: async () => undefined,
  draft: async () => ({ drafts: [], proposedGroups: [] }),
  send: async () => ({ ok: true, ref: '.wb-reports/test' }),
});

const renderOverlay = () =>
  render(<DebugOverlay route="/s/:id" host={testHost()} sessionId="test" />);

describe('DebugOverlay', () => {
  it('renders nothing until the hotkey is pressed', async () => {
    renderOverlay();
    expect(screen.queryByTestId('debug-badge')).toBeNull();
    await press(toggle);
    expect(screen.getByTestId('debug-badge')).toBeTruthy();
    expect(screen.getByTestId('debug-overlay').dataset.debugMode).toBe('idle');
  });

  it('leaves the app its own pointer events while aiming', async () => {
    // The whole reason capture is a key: a hover tooltip or a drag in progress
    // has to survive being reported, and it cannot if this component calls
    // `preventDefault` on the events the app needs.
    const appSaw: MouseEvent[] = [];
    const listener = (e: Event) => appSaw.push(e as MouseEvent);
    document.addEventListener('mousemove', listener);
    renderOverlay();
    await press(toggle);
    moveMouse(120, 240);
    document.removeEventListener('mousemove', listener);

    expect(appSaw).toHaveLength(1);
    expect(appSaw[0].defaultPrevented).toBe(false);
  });

  it('captures what is under the cursor on a keypress, with no click', async () => {
    renderOverlay();
    await press(toggle);
    moveMouse(50, 60);
    await press({ key: 'c' });
    await waitFor(() => expect(screen.getByTestId('debug-note-form')).toBeTruthy());
    expect(screen.getByTestId('debug-overlay').dataset.debugMode).toBe('describing');
  });

  it('keeps the app from seeing the capture key while debug mode is live', async () => {
    // `c` is a letter: the sheet underneath would otherwise start editing a cell.
    const appSaw: string[] = [];
    const listener = (e: Event) => appSaw.push((e as KeyboardEvent).key);
    document.addEventListener('keydown', listener);
    renderOverlay();
    await press(toggle);
    await press({ key: 'r' });
    document.removeEventListener('keydown', listener);
    expect(appSaw).toEqual([]);
  });

  it('lets the app have its keys back when debug mode is off', async () => {
    const appSaw: string[] = [];
    const listener = (e: Event) => appSaw.push((e as KeyboardEvent).key);
    document.addEventListener('keydown', listener);
    renderOverlay();
    await press({ key: 'r' });
    document.removeEventListener('keydown', listener);
    expect(appSaw).toEqual(['r']);
  });

  describe('nothing is dropped in silence', () => {
    const startDescribing = async () => {
      renderOverlay();
      await press(toggle);
      moveMouse(50, 60);
      await press({ key: 'c' });
      await waitFor(() => expect(screen.getByTestId('debug-note-form')).toBeTruthy());
    };

    it('refuses an empty note visibly instead of accepting and discarding it', async () => {
      await startDescribing();
      const save = screen.getByRole('button', { name: /save/i });
      expect(save).toHaveProperty('disabled', true);
      expect(screen.getByText(/a sentence is required/i)).toBeTruthy();

      await userEvent.type(screen.getByLabelText('What is wrong?'), '{Enter}');
      // Still in hand, still nothing collected — and the reporter can see why.
      expect(screen.getByTestId('debug-note-form')).toBeTruthy();
      expect(debugSession.count()).toBe(0);
    });

    it('drops the item on Escape and stays in debug mode', async () => {
      await startDescribing();
      await press({ key: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('debug-note-form')).toBeNull());
      // The prompt this replaced turned debug mode OFF here, so cancelling once
      // made the whole overlay vanish with no reason given.
      expect(screen.getByTestId('debug-badge')).toBeTruthy();
      expect(debugSession.mode()).not.toBe('off');
      expect(debugSession.count()).toBe(0);
    });

    it('leaves debug mode on Escape only when nothing is in hand', async () => {
      renderOverlay();
      await press(toggle);
      await press({ key: 'Escape' });
      expect(screen.queryByTestId('debug-badge')).toBeNull();
    });

    it('keeps the sentence when it is committed', async () => {
      await startDescribing();
      await userEvent.type(
        screen.getByLabelText('What is wrong?'),
        'the merged border looks broken{Enter}',
      );
      await waitFor(() => expect(debugSession.count()).toBe(1));
      expect(debugSession.items()[0].note).toBe('the merged border looks broken');
      expect(screen.queryByTestId('debug-note-form')).toBeNull();
      expect(screen.getByTestId('debug-badge').textContent).toContain('1 item');
    });

    it('treats mode keys as letters while the sentence is being typed', async () => {
      await startDescribing();
      await userEvent.type(screen.getByLabelText('What is wrong?'), 'rp');
      expect(screen.getByLabelText('What is wrong?')).toHaveProperty('value', 'rp');
      // Still describing: `r` did not switch to region mode underneath.
      expect(screen.getByTestId('debug-overlay').dataset.debugMode).toBe('describing');
    });

    it('says so when the browser refuses persistent storage', async () => {
      // jsdom has no IndexedDB, which is also what a locked-down profile looks
      // like — reporting still works, images just will not survive a reload.
      renderOverlay();
      await press(toggle);
      expect(screen.getByTestId('debug-badge').textContent).toContain(
        'refused persistent storage',
      );
    });
  });

  it('collects several items in one session', async () => {
    renderOverlay();
    await press(toggle);
    for (const note of ['first', 'second']) {
      moveMouse(10, 10);
      await press({ key: 'c' });
      await waitFor(() => expect(screen.getByTestId('debug-note-form')).toBeTruthy());
      await userEvent.type(screen.getByLabelText('What is wrong?'), `${note}{Enter}`);
      await waitFor(() => expect(screen.queryByTestId('debug-note-form')).toBeNull());
    }
    expect(debugSession.items().map((i) => i.note)).toEqual(['first', 'second']);
  });

  it('shows the anonymised route it was told, not a document id', () => {
    render(<DebugOverlay route="/s/:id" host={testHost()} sessionId="test" />);
    act(() => {
      debugSession.setMode('idle');
    });
    expect(screen.getByTestId('debug-badge').textContent).toContain('/s/:id');
    expect(screen.getByTestId('debug-badge').textContent).not.toMatch(/[0-9a-f]{8}-/);
  });

  it('does not warn about anything while mounting and unmounting', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = renderOverlay();
    await press(toggle);
    view.unmount();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('DebugOverlay · keys the app must keep', () => {
  it('never takes a key from a focused text field, even with nothing in hand', async () => {
    // Debug mode on, nothing pending: typing "chart" into a rename dialog used
    // to deliver "hat" and switch modes twice underneath.
    document.body.insertAdjacentHTML('beforeend', '<input id="app-field" />');
    const field = document.querySelector<HTMLInputElement>('#app-field')!;
    const seen: string[] = [];
    field.addEventListener('keydown', (e) => seen.push(e.key));

    renderOverlay();
    await press(toggle);
    field.focus();
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    });

    expect(seen).toEqual(['c', 'r']);
    // And the mode did not change under the typing.
    expect(screen.getByTestId('debug-overlay').dataset.debugMode).toBe('idle');
    field.remove();
  });
});

describe('DebugOverlay · a drag origin does not outlive its mode', () => {
  it('drops the origin when region mode is left mid-drag', async () => {
    renderOverlay();
    await press(toggle);
    await press({ key: 'r' });
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }),
      );
    });
    // Leave region mode without releasing. The origin used to survive, so
    // `onMove` painted a rubber band anchored to an abandoned point for the rest
    // of the session, and the hover outline never came back.
    //
    // Escape is the way out: region is the one mode with no other exit, so it is
    // a layer Escape peels before it turns debug mode off.
    await press({ key: 'Escape' });
    moveMouse(200, 200);
    expect(screen.getByTestId('debug-overlay').dataset.debugMode).toBe('idle');
    // No note form appeared, and releasing does not now record a phantom region.
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 200, clientY: 200, bubbles: true }),
      );
    });
    await waitFor(() => expect(debugSession.count()).toBe(0));
    expect(screen.queryByTestId('debug-note-form')).toBeNull();
  });
});

describe('DebugOverlay · a failed capture says so', () => {
  // Both entry points used to discard the rejection path, so a refused
  // IndexedDB write — quota, a private window, blocked site data — produced no
  // pending state, no notice, and an unhandled rejection on `window`. The
  // keystroke did nothing and said nothing.
  afterEach(() => {
    captureFailure.message = '';
  });

  it('reports a rejection instead of doing nothing', async () => {
    captureFailure.message = 'site data is blocked';
    renderOverlay();
    await press(toggle);
    await press({ key: 'c' });

    await waitFor(() => {
      expect(screen.getByTestId('debug-notice').textContent).toMatch(/capture failed/i);
    });
    expect(screen.queryByTestId('debug-note-form')).toBeNull();
    expect(debugSession.count()).toBe(0);
  });
});

describe('DebugOverlay · the review panel', () => {
  it('opens on `v` and closes on Escape, keeping debug mode', async () => {
    renderOverlay();
    await press(toggle);
    moveMouse(10, 10);
    await press({ key: 'c' });
    await waitFor(() => expect(screen.getByTestId('debug-note-form')).toBeTruthy());
    await userEvent.type(screen.getByLabelText('What is wrong?'), 'something{Enter}');
    await waitFor(() => expect(debugSession.count()).toBe(1));

    await press({ key: 'v' });
    await waitFor(() => expect(screen.getByTestId('debug-panel')).toBeTruthy());
    await press({ key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('debug-panel')).toBeNull());
    // Still in debug mode: Escape peeled one layer, not three.
    expect(screen.getByTestId('debug-badge')).toBeTruthy();
    expect(debugSession.count()).toBe(1);
  });

  it('leaves the panel’s keys alone — no aiming while reviewing', async () => {
    renderOverlay();
    await press(toggle);
    moveMouse(10, 10);
    await press({ key: 'c' });
    await waitFor(() => expect(screen.getByTestId('debug-note-form')).toBeTruthy());
    await userEvent.type(screen.getByLabelText('What is wrong?'), 'something{Enter}');
    await press({ key: 'v' });
    await waitFor(() => expect(screen.getByTestId('debug-panel')).toBeTruthy());

    const appSaw: string[] = [];
    const listener = (e: Event) => appSaw.push((e as KeyboardEvent).key);
    document.addEventListener('keydown', listener);
    await press({ key: 'Enter' });
    await press({ key: 'c' });
    document.removeEventListener('keydown', listener);

    // Both reach the page: the panel's buttons need Enter, and `c` must not
    // start a capture behind a panel the reporter is reading.
    expect(appSaw).toEqual(['Enter', 'c']);
    expect(screen.queryByTestId('debug-note-form')).toBeNull();
    expect(screen.getByTestId('debug-panel')).toBeTruthy();
  });
});

describe('DebugOverlay · the panel cannot outlive debug mode', () => {
  it('does not reopen the panel on the next toggle', async () => {
    // `reviewing` is view-local, so turning the mode off with the panel open
    // left it set and turning it back on reopened the panel unasked.
    renderOverlay();
    await press(toggle);
    debugSession.add({
      note: 'something',
      target: { kind: 'viewport', rect: { x: 0, y: 0, w: 10, h: 10 } },
    });
    await press({ key: 'v' });
    expect(screen.getByTestId('debug-panel')).toBeTruthy();

    await press(toggle);
    expect(screen.queryByTestId('debug-badge')).toBeNull();
    await press(toggle);
    expect(screen.getByTestId('debug-badge')).toBeTruthy();
    expect(screen.queryByTestId('debug-panel')).toBeNull();
  });
});

describe('DebugOverlay · aiming needs no mode', () => {
  // `p` used to enter a "pick" mode whose only effect was this outline. It could
  // never produce an item — `c` was always the key that did, in any mode — so it
  // read as a third action beside `c` and `r` and did nothing a reporter could
  // see. Meanwhile `c` in every other mode fired blind.
  it('outlines what a capture would record, with no mode key pressed', async () => {
    renderOverlay();
    await press(toggle);
    expect(screen.getByTestId('debug-overlay').dataset.debugMode).toBe('idle');
    expect(screen.queryByTestId('debug-outline')).toBeNull();

    moveMouse(120, 240);
    await waitFor(() => expect(screen.queryByTestId('debug-outline')).not.toBeNull());
  });

  it('leaves `p` to the app', async () => {
    // An unbound letter must reach the page: this tool may not take a key it has
    // no use for. `actionFor` returns undefined, so nothing calls preventDefault.
    renderOverlay();
    await press(toggle);

    const seen: string[] = [];
    const listener = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener('keydown', listener);
    await press({ key: 'p' });
    window.removeEventListener('keydown', listener);

    expect(seen).toContain('p');
    expect(screen.getByTestId('debug-overlay').dataset.debugMode).toBe('idle');
  });
});

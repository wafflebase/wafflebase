// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReviewApproveModal } from '../../../src/shell/panels/ReviewApproveModal.tsx';
import type { BridgeClient } from '../../../src/client/bridge.ts';

/**
 * The modal that writes files, driven through its `bridge` PROP — which exists as a prop
 * so a test can reach this surface without a dev server.
 *
 * The case that matters here is the one the `status` field was added for: `/commit` is
 * all-or-nothing and answers a REFUSAL with a 409 and `ok: false`, which is the same shape
 * a dead server produces. Reporting both as transport told the user to restart a dev server
 * that was running, and set `error` on every row — which flips `bridgeDown` and locks the
 * button at "Bridge offline" until the modal is reopened.
 */

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const PLAN = [
  {
    intent: { kind: 'class', file: 'app/x.tsx', id: 'x#C:0', from: 'p-1', to: 'p-2' },
    label: 'padding',
    mode: 'apply' as const,
    map: 'classEdits' as never,
    key: 'k',
  },
] as never;

function mount(commit: () => Promise<unknown>, over: Record<string, unknown> = {}) {
  const notify = vi.fn();
  const bridge = {
    mutate: async () => ({ ok: true, status: 200, diff: '- p-1\n+ p-2', files: ['app/x.tsx'] }),
    commit,
  } as unknown as BridgeClient;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <ReviewApproveModal
        open
        onOpenChange={() => {}}
        dark={false}
        plan={PLAN}
        classEdits={[]}
        tokenEdits={[]}
        tokenAdds={[]}
        rebinds={[]}
        paletteEdits={[]}
        tokens={null}
        bridge={bridge}
        allComponents={[]}
        onApproved={() => {}}
        onDiscard={() => {}}
        notify={notify}
        {...(over as object)}
      />,
    );
  });
  return { host, notify };
}

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};

const approve = async () => {
  // Searched on document, not the mount host: the dialog portals to body.
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /Approve/i.test(b.textContent ?? ''),
  );
  if (!btn) throw new Error(`no Approve button; saw: ${[...document.querySelectorAll('button')].map((b) => b.textContent).join(' | ')}`);
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
};

describe('a refused commit is not a dead bridge', () => {
  it('a 409 refusal reports the refusal, not "restart your dev server"', async () => {
    const { notify } = mount(async () => ({
      ok: false,
      status: 409,
      error: 'a file changed under this edit',
    }));
    await settle();
    await approve();

    const titles = notify.mock.calls.map((c) => c[1]);
    expect(titles).not.toContain('Mutation bridge unreachable');
    expect(titles).toContain('Nothing was written');
    // And the modal must not present itself as offline: that disables the button.
    expect(document.body.textContent).not.toContain('Bridge offline');
  });

  it('a request that never got a response still reports the bridge as unreachable', async () => {
    // No `status` = no response arrived. This is the case the old code assumed for all.
    const { notify } = mount(async () => ({ ok: false, error: 'fetch failed' }));
    await settle();
    await approve();

    expect(notify.mock.calls.map((c) => c[1])).toContain('Mutation bridge unreachable');
    expect(document.body.textContent).toContain('Bridge offline');
  });
});

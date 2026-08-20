// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReviewApproveModal } from '../../../src/shell/panels/ReviewApproveModal.tsx';
import type { BridgeClient, PendingLayoutEdit } from '../../../src/client/index.ts';

/**
 * The review modal, at the one place the port left disconnected.
 *
 * The card builder handled the five token/class maps. The floating class editor stages
 * `layoutEdits`, so a class edit made in the frame produced ZERO cards: the header said
 * "1 file change staged", the diff list showed the real change, and the card area said
 * "No changes to review." Measured against a wafflebase scene, and invisible to every other
 * lane — the staging path and this modal were built in separate PRs and never met.
 */

let root: Root | null = null;

function render(ui: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(ui));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const layoutEdit = (over: Partial<PendingLayoutEdit> = {}): PendingLayoutEdit =>
  ({
    key: 'layoutEdits|k',
    op: 'props',
    sceneId: 'documents',
    anchor: {
      file: 'packages/frontend/src/components/app-sidebar.tsx',
      component: 'AppSidebar',
      path: [0, 1],
      tag: 'div',
      fp: 'fp1',
    },
    label: 'class edit',
    scopeLabel: 'static',
    classOps: { additions: ['flex-col'], removals: ['flex-row'] },
    ...over,
  }) as PendingLayoutEdit;

const bridge = () =>
  ({
    // Every intent previews as located with no diff: this suite is about the CARD, and the
    // diff list is a separate region driven by the plan.
    mutate: async () => ({ ok: true, status: 200, files: ['x.tsx'], diff: '' }),
    commit: async () => ({ ok: true, status: 200, results: [] }),
  }) as unknown as BridgeClient;

const props = (over: Record<string, unknown> = {}) => ({
  open: true,
  onOpenChange: () => {},
  dark: false,
  plan: [],
  classEdits: [],
  tokenEdits: [],
  tokenAdds: [],
  rebinds: [],
  paletteEdits: [],
  layoutEdits: [],
  tokens: null,
  bridge: bridge(),
  allComponents: [],
  onApproved: () => {},
  onDiscard: () => {},
  notify: vi.fn(),
  ...over,
});

describe('ReviewApproveModal — layout edits', () => {
  it('shows a card for a staged class edit instead of "No changes to review"', () => {
    const host = render(<ReviewApproveModal {...props({ layoutEdits: [layoutEdit()] })} />);
    const text = (host.textContent ?? '') + (document.body.textContent ?? '');
    expect(text).not.toContain('No changes to review');
    // The node, so the reviewer knows WHAT is being changed…
    expect(text).toContain('<div>');
    expect(text).toContain('AppSidebar');
    // …the file, because a class rewrite lands in source…
    expect(text).toContain('app-sidebar.tsx');
    // …and both sides of the class change, which is the substance.
    expect(text).toContain('flex-row');
    expect(text).toContain('flex-col');
  });

  it('shows both sides of a replacement-only edit', () => {
    // `classOps` carries `replacements` beside `additions`/`removals`, and the card read only
    // the latter two — so the ordinary "change this class to that one" edit rendered two empty
    // lists under the false subtitle "no class change staged".
    render(
      <ReviewApproveModal
        {...props({
          layoutEdits: [
            layoutEdit({ classOps: { replacements: [{ from: 'p-2', to: 'p-4' }] } }),
          ],
        })}
      />,
    );
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('no class change staged');
    expect(text).toContain('p-2');
    expect(text).toContain('p-4');
  });

  it('names the path, including the root case', () => {
    render(<ReviewApproveModal {...props({ layoutEdits: [layoutEdit({ anchor: { ...layoutEdit().anchor, path: [] } })] })} />);
    expect(document.body.textContent).toContain('(root)');
  });

  it('says so when a layout edit stages no class change', () => {
    // `props` with only `sets` is reachable once the prop controls exist. A card with two empty
    // class lists would read as a change that does nothing.
    render(
      <ReviewApproveModal
        {...props({ layoutEdits: [layoutEdit({ classOps: undefined, sets: [{ name: 'id', from: null, to: 'x' }] })] })}
      />,
    );
    expect(document.body.textContent).toContain('no class change staged');
  });

  it('still says "No changes to review" when nothing is staged', () => {
    // The empty state is correct and must survive: the fix is a missing card, not a missing
    // empty state.
    render(<ReviewApproveModal {...props()} />);
    expect(document.body.textContent).toContain('No changes to review');
  });
});

// ---------------------------------------------------------------------------
// The commit path. `/commit` is all-or-nothing and answers a REFUSAL with a 409 and
// `ok: false` — the same shape a dead server produces, which is why `status` exists.
// Reporting both as transport told the user to restart a dev server that was running and
// set `error` on every row, which flips `bridgeDown` and locks the button at
// "Bridge offline" until the modal is reopened.

const PLAN = [
  {
    intent: { kind: 'class', file: 'app/x.tsx', id: 'x#C:0', from: 'p-1', to: 'p-2' },
    label: 'padding',
    mode: 'apply' as const,
    map: 'classEdits' as never,
    key: 'k',
  },
] as never;

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
  if (!btn) throw new Error('no Approve button rendered');
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
};

const commitBridge = (commit: () => Promise<unknown>) =>
  ({
    mutate: async () => ({ ok: true, status: 200, diff: '- p-1\n+ p-2', files: ['app/x.tsx'] }),
    commit,
  }) as unknown as BridgeClient;

describe('ReviewApproveModal — a refused commit is not a dead bridge', () => {
  it('a 409 refusal reports the refusal, not "restart your dev server"', async () => {
    const notify = vi.fn();
    render(
      <ReviewApproveModal
        {...props({
          plan: PLAN,
          notify,
          bridge: commitBridge(async () => ({
            ok: false,
            status: 409,
            error: 'a file changed under this edit',
          })),
        })}
      />,
    );
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
    const notify = vi.fn();
    render(
      <ReviewApproveModal
        {...props({ plan: PLAN, notify, bridge: commitBridge(async () => ({ ok: false, error: 'fetch failed' })) })}
      />,
    );
    await settle();
    await approve();

    expect(notify.mock.calls.map((c) => c[1])).toContain('Mutation bridge unreachable');
    expect(document.body.textContent).toContain('Bridge offline');
  });
});

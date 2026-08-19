// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  App,
  editableClasses,
  effectiveClasses,
  nextLayoutEdit,
} from '../../src/shell/App.tsx';
import type { BridgeClient, PendingLayoutEdit } from '../../src/client/index.ts';
import type { Analysis, SceneNodeMeta } from '../../src/types.ts';

/**
 * The layout, and the three class-list rules it owns.
 *
 * THE RULES ARE TESTED DIRECTLY because each of them, when wrong, produces a WRITE
 * that is wrong rather than a screen that looks wrong: `nextLayoutEdit` diffing
 * against the staged state instead of the baseline emits compounding ops that the
 * injector then applies, and `editableClasses` returning `[]` where it should return
 * `null` offers a control whose save the server refuses.
 *
 * The component is driven through a STUB BRIDGE, which is what the injected `bridge`
 * prop is for.
 *
 * NOT COVERED, and it is the gap that matters: the SAVE PATH end to end. Reaching it
 * needs a staged edit, staging needs the floating class editor, and that needs a
 * measured selection rect — which arrives from the frame over `postMessage` after the
 * iframe loads a real scene. jsdom loads no iframe, so nothing here can stage an edit
 * and no test below asserts that a failed `commit()` leaves the baseline alone. The
 * baseline rule itself is covered at the history level (`history.test.tsx`), and the
 * wiring between them is only exercised by `pnpm verify:frame` in a real browser.
 */

const analysis = (): Analysis => ({
  tokensUsed: [],
  colorBindings: [],
  scaleBindings: [],
  antiPatterns: {
    hardcodedPaletteColors: [],
    hardcodedNamedColors: [],
    hexLiterals: [],
    rgbHslLiterals: [],
    arbitraryPx: [],
  },
});

const node = (over: Partial<SceneNodeMeta> = {}): SceneNodeMeta => ({
  path: [0],
  tag: 'div',
  attrs: [],
  className: 'p-2 flex',
  classNameExpr: null,
  identity: {},
  text: null,
  fp: 'fp1',
  fpx: 'fp1x',
  analysis: analysis(),
  scope: 'static',
  structuralEditable: true,
  repeated: false,
  clickSelectable: true,
  children: [],
  ...over,
});

const anchor: PendingLayoutEdit['anchor'] = {
  file: 'app/a.tsx',
  component: 'Page',
  path: [0],
  tag: 'div',
  fp: 'fp1',
};
const seed = { anchor, scopeLabel: 'Page', sceneId: 's1' };

describe('editableClasses', () => {
  it('splits a literal', () => {
    expect(editableClasses(node())).toEqual(['p-2', 'flex']);
  });

  it('returns an EMPTY list for a node with no className attribute', () => {
    // A thin `.map()` row wrapper has none, and it is still a perfectly good edit
    // target — the injector creates the attribute on the first real edit. Refusing
    // here would make most table rows uneditable.
    expect(editableClasses(node({ className: null, classNameExpr: null }))).toEqual([]);
    expect(editableClasses(node({ className: '' }))).toEqual([]);
  });

  it('REFUSES an expression the injector will not rewrite', () => {
    // `[]` here would offer a control whose save the server rejects — a promise the
    // tool cannot keep, and the user only finds out after pressing Save.
    expect(editableClasses(node({ className: null, classNameExpr: 'cn("p-2", x)' }))).toBeNull();
  });

  it('collapses whitespace rather than emitting empty tokens', () => {
    expect(editableClasses(node({ className: '  p-2   flex  ' }))).toEqual(['p-2', 'flex']);
  });
});

describe('effectiveClasses', () => {
  it('is the baseline when nothing is staged', () => {
    const base = ['p-2'];
    expect(effectiveClasses(base)).toBe(base);
  });

  it('applies removals then additions', () => {
    expect(effectiveClasses(['p-2', 'flex'], { removals: ['flex'], additions: ['grid'] })).toEqual([
      'p-2',
      'grid',
    ]);
  });

  it('does not duplicate an addition that is already there', () => {
    expect(effectiveClasses(['p-2'], { additions: ['p-2'] })).toEqual(['p-2']);
  });

  it('does not mutate the baseline it was given', () => {
    // The baseline comes from the node metadata; mutating it would corrupt the tree
    // every later diff is taken against.
    const base = ['p-2'];
    effectiveClasses(base, { additions: ['flex'] });
    expect(base).toEqual(['p-2']);
  });
});

describe('nextLayoutEdit — the diff is against the BASELINE, always', () => {
  it('stages the first change', () => {
    const e = nextLayoutEdit(undefined, seed, ['p-2'], ['p-2', 'flex'])!;
    expect(e.classOps).toEqual({ additions: ['flex'], removals: [] });
    expect(e.op).toBe('props');
    expect(e.sceneId).toBe('s1');
  });

  it('REPLACES rather than compounds on a second change to the same node', () => {
    // The bug this pins: diffing `['p-2','p-4']` against the previous STAGED list
    // would emit `additions: ['p-4']` and lose `p-2`, or emit both and apply the
    // padding twice. Against the baseline there is exactly one truth.
    const first = nextLayoutEdit(undefined, seed, ['p-2'], ['p-2', 'p-4'])!;
    const second = nextLayoutEdit(first, seed, ['p-2'], ['p-2', 'p-4', 'gap-2'])!;
    expect(second.classOps).toEqual({ additions: ['p-4', 'gap-2'], removals: [] });
  });

  it('a remove-then-restore leaves NEITHER list mentioning the class', () => {
    const removed = nextLayoutEdit(undefined, seed, ['p-2', 'flex'], ['p-2'])!;
    expect(removed.classOps).toEqual({ additions: [], removals: ['flex'] });
    const restored = nextLayoutEdit(removed, seed, ['p-2', 'flex'], ['p-2', 'flex']);
    expect(restored).toBeNull();
  });

  it('drops the edit when the classes are back to the baseline', () => {
    // A no-op left in the plan reads as "there is something to write" forever.
    const e = nextLayoutEdit(undefined, seed, ['p-2'], ['p-2', 'flex'])!;
    expect(nextLayoutEdit(e, seed, ['p-2'], ['p-2'])).toBeNull();
  });

  it('KEEPS the edit when something else is staged on the same node', () => {
    // Dropping it would silently discard a prop or text change the user made
    // through a different control.
    const withProps = {
      ...nextLayoutEdit(undefined, seed, ['p-2'], ['p-2', 'flex'])!,
      sets: [{ name: 'id', from: null, to: 'x' }],
    } as PendingLayoutEdit;
    const back = nextLayoutEdit(withProps, seed, ['p-2'], ['p-2'])!;
    expect(back).not.toBeNull();
    expect(back.sets).toHaveLength(1);
    expect(back.classOps).toBeUndefined();
  });

  it('preserves the original key across a rewrite', () => {
    // Re-keying a staged edit orphans the old entry, leaving two edits for one node.
    const first = nextLayoutEdit(undefined, seed, ['p-2'], ['p-2', 'flex'])!;
    const second = nextLayoutEdit(first, seed, ['p-2'], ['p-2', 'grid'])!;
    expect(second.key).toBe(first.key);
  });
});

// ---------------------------------------------------------------------------

let root: Root | null = null;

const scene = {
  id: 'dash',
  kind: 'dom' as const,
  label: 'Dashboard',
  file: 'app/a.tsx',
  export: 'default',
  component: 'Page',
  mocks: [],
  roots: { Page: node({ tag: '#returns', path: [], children: [node()] }) },
  imports: [],
};

function stubBridge(over: Partial<BridgeClient> = {}): BridgeClient {
  const nope = async () => ({ ok: false, error: 'not stubbed' });
  return {
    health: async () => ({ ok: true, root: '/p', scenes: 'scenes.json', session: 's', tokens: null }),
    metadata: async () => ({ ok: true, metadata: { scenes: [scene], files: [] } }) as never,
    transactions: async () => ({ ok: true, undo: [], redo: [] }),
    commit: nope as never,
    tokens: nope as never,
    previewTokens: nope as never,
    mutate: nope as never,
    validate: nope as never,
    undo: nope as never,
    redo: nope as never,
    candidates: nope as never,
    plan: nope as never,
    ...over,
  } as BridgeClient;
}

/** Mounts and lets the mount-time bridge promises settle. */
async function mount(bridge: BridgeClient) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<App bridge={bridge} />);
  });
  return host;
}

beforeEach(() => window.localStorage.clear());

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.localStorage.clear();
});

describe('the layout', () => {
  it('lists the scenes the bridge reported, not a hardcoded id', () => {
    // The shell is prebuilt and cannot import `virtual:wb-scenes`, so the manifest
    // arriving over HTTP is the only thing that can populate this.
    return mount(stubBridge()).then((host) => {
      expect(host.textContent).toContain('Dashboard');
      expect(host.textContent).toContain('app/a.tsx');
    });
  });

  it('re-decides the scene when the persisted id is gone from this project', async () => {
    // A stored view survives a reload; the project it names may not.
    window.localStorage.setItem('design-editor:view:v1', JSON.stringify({ scene: 'vanished' }));
    const host = await mount(stubBridge());
    const active = [...host.querySelectorAll('button')].find((b) =>
      b.className.includes('bg-wb-accent/15'),
    );
    expect(active?.textContent).toContain('Dashboard');
  });

  it('says the manifest is missing rather than showing an empty list', async () => {
    const host = await mount(
      stubBridge({ metadata: async () => ({ ok: true, metadata: { scenes: [], files: [] } }) as never }),
    );
    expect(host.textContent).toContain('No scenes declared');
  });

  it('surfaces a metadata error instead of an empty tree', async () => {
    const host = await mount(
      stubBridge({ metadata: async () => ({ ok: false, error: 'extract.mjs threw' }) as never }),
    );
    expect(host.textContent).toContain('extract.mjs threw');
  });

  it('reports an unreachable bridge in the header', async () => {
    const host = await mount(stubBridge({ health: async () => ({ ok: false, error: 'ECONNREFUSED' }) }));
    expect(host.textContent).toContain('bridge unreachable');
  });

  it('disables Save while the plan is empty', async () => {
    const host = await mount(stubBridge());
    const save = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Save to Code'),
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.title).toContain('code matches the editor');
  });

  it('reports the write depth from the log itself', async () => {
    const host = await mount(
      stubBridge({
        transactions: async () => ({
          ok: true,
          undo: [{ id: 2, labels: ['class edit'] }, { id: 1, labels: ['token'] }],
          redo: [],
        }) as never,
      }),
    );
    // Queried on the button, not on the page text: '2' appears in enough places that
    // a `textContent` match passes with the count hardcoded to anything.
    const log = [...host.querySelectorAll('button')].find((b) =>
      b.getAttribute('title')?.startsWith('Writes on disk'),
    )!;
    expect(log.textContent).toBe('2');
  });
});

describe('keyboard', () => {
  const press = (key: string, target?: Element, over: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true, ...over });
    act(() => (target ?? window).dispatchEvent(e));
    return e;
  };

  it('swallows ⌘S so the browser’s Save Page dialog never wins', async () => {
    await mount(stubBridge());
    expect(press('s').defaultPrevented).toBe(true);
  });

  it('leaves ⌘Z alone inside a text field', async () => {
    // Otherwise typing in the class editor's input loses its own undo — the field's
    // native history is the one the user means there.
    await mount(stubBridge());
    const input = document.createElement('input');
    document.body.append(input);
    expect(press('z', input).defaultPrevented).toBe(false);
  });

  it('takes ⌘Z outside one', async () => {
    await mount(stubBridge());
    expect(press('z').defaultPrevented).toBe(true);
  });

  it('ignores a bare keypress with no modifier', async () => {
    await mount(stubBridge());
    expect(press('s', undefined, { metaKey: false }).defaultPrevented).toBe(false);
  });
});

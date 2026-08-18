// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEditHistory, normalizeState, type EditHistory } from '../../src/client/history.ts';
import { emptyEditState, type EditState } from '../../src/client/edits.ts';
import type { AnchorRebase } from '../../src/client/anchors.ts';

/**
 * Staged-edit undo/redo.
 *
 * WHAT IS ACTUALLY AT RISK HERE IS THE USER'S WORK, and every failure mode is quiet:
 * a persisted snapshot written before an `EditState` map existed white-screens the
 * editor on the render path; an edit dropped from `present` but left in `baseline`
 * makes the next save try to REVERT it against text that no longer exists, so the
 * editor stays dirty forever with an unsatisfiable plan; a rebase applied to
 * `present` only lets ⌘Z resurrect a stale coordinate. None of those are visible in
 * a happy-path click-through, so they are pinned here.
 *
 * The hook is exercised through a real React root rather than a renderHook helper,
 * matching `test/shell/ui.test.tsx` — and it matters here, because the
 * hydrate-during-first-render / persist-in-effect ordering is the thing under test.
 *
 * NOT COVERED, said rather than implied: `MAX_DEPTH`'s 200-snapshot ceiling (every
 * `.slice(-MAX_DEPTH)`) has no test — reaching it takes 200 staged edits, and the
 * consequence of it being wrong is a longer or shorter undo stack, not lost work or a
 * broken save. The `localStorage` write is also never made to fail, so the
 * quota-exceeded path that silently stops persisting is unexercised.
 */

let root: Root | null = null;
let api: EditHistory;
let renders = 0;

function Harness({ sessionId, onReset }: { sessionId: string | null; onReset?: () => void }) {
  api = useEditHistory(sessionId, onReset);
  renders++;
  return null;
}

function mount(sessionId: string | null = 'sess-1', onReset?: () => void) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  renders = 0;
  act(() => root!.render(<Harness sessionId={sessionId} onReset={onReset} />));
}

/** Re-render with a new sessionId, as the bridge answering `/health` would. */
function setSession(sessionId: string | null) {
  act(() => root!.render(<Harness sessionId={sessionId} />));
}

const KEY = 'design-editor:edit-history:v1';
const stored = () => JSON.parse(window.localStorage.getItem(KEY)!);

/**
 * A staged class edit. Deliberately a STUB rather than a full `PendingClassEdit`:
 * history never reads inside a map value — it moves whole objects between snapshots and
 * hands them to `editStateKey`, which stringifies them — so the extra fields would add
 * noise without adding coverage. The cast records that this is not a real edit.
 */
const withClass = (id: string, to: string) => (prev: EditState) => ({
  ...prev,
  classEdits: { ...prev.classEdits, [id]: { to } as unknown as EditState['classEdits'][string] },
});

/** A staged layout edit carrying an anchor, for the rebase tests. */
const withLayout = (id: string, path: number[], fpx?: string) => (prev: EditState) => ({
  ...prev,
  layoutEdits: {
    ...prev.layoutEdits,
    [id]: {
      key: id,
      op: 'props',
      sceneId: 's',
      label: id,
      scopeLabel: 'static',
      anchor: { file: 'a.tsx', component: 'Page', path, tag: 'div', fp: 'fp1', fpx },
    } as unknown as EditState['layoutEdits'][string],
  },
});

beforeEach(() => window.localStorage.clear());

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.useRealTimers();
});

describe('staging and undo/redo', () => {
  it('pushes a snapshot per change and steps back through them', () => {
    mount();
    act(() => api.update(withClass('a', 'p-1')));
    act(() => api.update(withClass('b', 'p-2')));
    expect(api.undoDepth).toBe(2);

    act(() => api.undo());
    expect(Object.keys(api.state.classEdits)).toEqual(['a']);
    act(() => api.undo());
    expect(api.state.classEdits).toEqual({});
    expect(api.canUndo).toBe(false);

    act(() => api.redo());
    expect(Object.keys(api.state.classEdits)).toEqual(['a']);
  });

  it('ignores an update that changes nothing', () => {
    // Without this a re-render that re-stages the same value fills the undo stack
    // with steps that do nothing when you press ⌘Z.
    mount();
    act(() => api.update(withClass('a', 'p-1')));
    act(() => api.update(withClass('a', 'p-1')));
    expect(api.undoDepth).toBe(1);
  });

  it('drops the redo future once a new edit is staged', () => {
    mount();
    act(() => api.update(withClass('a', 'p-1')));
    act(() => api.undo());
    expect(api.canRedo).toBe(true);
    act(() => api.update(withClass('c', 'p-3')));
    expect(api.canRedo).toBe(false);
  });

  it('collapses keystrokes on one control, and separates distinct ones', () => {
    vi.useFakeTimers();
    mount();
    act(() => api.update(withClass('a', 'p-1'), 'colour:a'));
    act(() => api.update(withClass('a', 'p-2'), 'colour:a'));
    act(() => api.update(withClass('a', 'p-3'), 'colour:a'));
    // One entry, not three: ⌘Z on a colour input should undo the edit, not a
    // character of it.
    expect(api.undoDepth).toBe(1);

    act(() => vi.advanceTimersByTime(800));
    act(() => api.update(withClass('a', 'p-4'), 'colour:a'));
    expect(api.undoDepth).toBe(2); // past the window, so a separate step

    act(() => api.update(withClass('a', 'p-5'), 'radius:a'));
    expect(api.undoDepth).toBe(3); // different control
  });

  it('treats an un-keyed update as discrete even back-to-back', () => {
    mount();
    act(() => api.update(withClass('a', 'p-1')));
    act(() => api.update(withClass('a', 'p-2')));
    expect(api.undoDepth).toBe(2);
  });

  it('breaks coalescing across an undo', () => {
    // The stack has to be deeper than one entry for this to be observable at all:
    // with `past` empty the `past.length > 0` guard already blocks coalescing, so a
    // shallow version of this test passes either way.
    //
    // What goes wrong without the reset: the post-undo edit MERGES into the entry the
    // undo just stepped out of, so the `{x}` state is never pushed back and the next
    // ⌘Z jumps past it to empty — the user silently loses a step.
    vi.useFakeTimers();
    mount();
    act(() => api.update(withClass('x', 'p-0'), 'radius:x'));
    act(() => api.update(withClass('a', 'p-1'), 'colour:a'));
    act(() => api.update(withClass('a', 'p-2'), 'colour:a'));
    expect(api.undoDepth).toBe(2);

    act(() => api.undo());
    act(() => api.update(withClass('a', 'p-9'), 'colour:a'));
    expect(api.undoDepth).toBe(2);
    act(() => api.undo());
    expect(Object.keys(api.state.classEdits)).toEqual(['x']);
  });

  it('clear is an undoable step, and a no-op when already empty', () => {
    mount();
    act(() => api.update(withClass('a', 'p-1')));
    act(() => api.clear());
    expect(api.state.classEdits).toEqual({});
    act(() => api.undo());
    expect(Object.keys(api.state.classEdits)).toEqual(['a']);

    act(() => api.clear());
    act(() => api.clear());
    const depth = api.undoDepth;
    act(() => api.clear());
    expect(api.undoDepth).toBe(depth);
  });
});

describe('dirty is measured against disk, not against a save count', () => {
  it('goes clean on save and DIRTY AGAIN when history steps back past it', () => {
    // The whole reason `baseline` exists. Counting saves would report clean here,
    // and the user's ⌘Z would never reach the file.
    mount();
    act(() => api.update(withClass('a', 'p-1')));
    expect(api.dirty).toBe(true);
    act(() => api.markSaved());
    expect(api.dirty).toBe(false);
    act(() => api.undo());
    expect(api.dirty).toBe(true);
  });

  it('rollbackBaseline steps the baseline back with a reverted commit', () => {
    mount();
    act(() => api.update(withClass('a', 'p-1')));
    act(() => api.markSaved());
    act(() => api.update(withClass('b', 'p-2')));
    act(() => api.markSaved());
    expect(api.dirty).toBe(false);

    act(() => api.rollbackBaseline());
    // Disk went back one commit, so the present is ahead of it again.
    expect(Object.keys(api.baseline.classEdits)).toEqual(['a']);
    expect(api.dirty).toBe(true);

    act(() => api.rollbackBaseline());
    expect(api.baseline.classEdits).toEqual({});
  });

  it('clears a baseline the stack cannot account for', () => {
    // Reachable, and not only in theory: `normalizeStates` yields `[]` for a record
    // written before `baselineStack` existed, so a restored session can hold a
    // non-empty baseline with nothing behind it. Returning `prev` there would leave
    // `baseline` describing a commit that has just been reverted on disk, and every
    // later save would plan against it.
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        sessionId: 'sess-1',
        present: { ...emptyEditState(), classEdits: { a: { to: 'p-1' } } },
        baseline: { ...emptyEditState(), classEdits: { a: { to: 'p-1' } } },
      }),
    );
    mount('sess-1');
    expect(api.dirty).toBe(false);
    act(() => api.rollbackBaseline());
    expect(api.baseline.classEdits).toEqual({});
    expect(api.dirty).toBe(true);
  });
});

describe('dropEdits — the recovery path for an edit that can no longer apply', () => {
  it('removes the edit from the baseline too, or the editor stays permanently dirty', () => {
    // An edit left in `baseline` makes the next save plan a REVERT of it, and that
    // revert needs the same vanished text — an unsatisfiable plan that never clears.
    mount();
    act(() => api.update(withClass('a', 'p-1')));
    act(() => api.markSaved());
    act(() => api.dropEdits([{ map: 'classEdits', key: 'a' }]));
    expect(api.state.classEdits).toEqual({});
    expect(api.baseline.classEdits).toEqual({});
    expect(api.dirty).toBe(false);
  });

  it('purges the undo stack, so ⌘Z cannot resurrect it', () => {
    // ONE undo, not two: undoing to the bottom of the stack lands on the empty state
    // either way, which makes the assertion pass without the stacks being stripped.
    mount();
    act(() => api.update(withClass('a', 'p-1')));
    act(() => api.update(withClass('b', 'p-2')));
    act(() => api.dropEdits([{ map: 'classEdits', key: 'a' }]));
    act(() => api.undo());
    expect(api.state.classEdits).not.toHaveProperty('a');
  });

  it('does nothing for an empty list', () => {
    mount();
    act(() => api.update(withClass('a', 'p-1')));
    const before = renders;
    act(() => api.dropEdits([]));
    expect(renders).toBe(before);
  });
});

describe('rebaseAnchors', () => {
  const move = (over: Partial<AnchorRebase> = {}): AnchorRebase => ({
    map: 'layoutEdits',
    key: 'e1',
    field: 'anchor',
    path: [0, 2],
    fpx: 'newfpx',
    ...over,
  });
  const pathOf = (s: EditState) =>
    (s.layoutEdits.e1 as unknown as { anchor: { path: number[] } } | undefined)?.anchor.path;

  it('rewrites the path in the present, the baseline AND the stacks', () => {
    // A coordinate has to be consistent everywhere: leave one stack snapshot behind
    // and ⌘Z steps into a stale path, whose next save fails.
    mount();
    act(() => api.update(withLayout('e1', [0, 0])));
    act(() => api.markSaved());
    act(() => api.update(withClass('x', 'p-1')));
    act(() => api.rebaseAnchors([move()]));

    expect(pathOf(api.state)).toEqual([0, 2]);
    expect(pathOf(api.baseline)).toEqual([0, 2]);
    act(() => api.undo());
    expect(pathOf(api.state)).toEqual([0, 2]);
  });

  it('does NOT flip dirty — a coordinate correction is not an edit', () => {
    // This is what `editStateKey`'s HINT_KEYS exclusion buys, and it is why a
    // metadata refresh does not light up the Save button on its own.
    mount();
    act(() => api.update(withLayout('e1', [0, 0], 'oldfpx')));
    act(() => api.markSaved());
    act(() => api.rebaseAnchors([move()]));
    expect(pathOf(api.state)).toEqual([0, 2]);
    expect(api.dirty).toBe(false);
  });

  it('is not undoable', () => {
    mount();
    act(() => api.update(withLayout('e1', [0, 0])));
    const depth = api.undoDepth;
    act(() => api.rebaseAnchors([move()]));
    expect(api.undoDepth).toBe(depth);
  });

  it('SKIPS a lost entry instead of writing an undefined path into a live anchor', () => {
    // `planRebase` returns moves and losses in one list. The prototype's narrower
    // parameter type made filtering the caller's job, and a missed filter breaks the
    // very save this function exists to keep working.
    mount();
    act(() => api.update(withLayout('e1', [0, 0])));
    act(() =>
      api.rebaseAnchors([{ map: 'layoutEdits', key: 'e1', field: 'anchor', lost: true }]),
    );
    expect(pathOf(api.state)).toEqual([0, 0]);
  });

  it('ignores a rebase for an edit that is no longer staged', () => {
    mount();
    act(() => api.update(withClass('a', 'p-1')));
    act(() => api.rebaseAnchors([move()]));
    expect(api.state.layoutEdits).toEqual({});
  });
});

describe('persistence', () => {
  it('writes the stack under the session id', () => {
    mount('sess-1');
    act(() => api.update(withClass('a', 'p-1')));
    expect(stored().sessionId).toBe('sess-1');
    expect(stored().present.classEdits.a).toEqual({ to: 'p-1' });
  });

  it('restores on mount, synchronously enough that the persist effect cannot erase it', () => {
    // Hydrating in an effect would land in the same commit as the persist effect,
    // which then writes the still-empty state over the record.
    mount('sess-1');
    act(() => api.update(withClass('a', 'p-1')));
    act(() => root!.unmount());

    mount('sess-1');
    expect(api.restored).toBe(true);
    expect(api.state.classEdits.a).toEqual({ to: 'p-1' });
    expect(stored().present.classEdits.a).toEqual({ to: 'p-1' });
  });

  it('keeps edits made before the bridge answers, then adopts its session', () => {
    mount(null);
    act(() => api.update(withClass('a', 'p-1')));
    expect(stored().sessionId).toBe('unknown');
    setSession('sess-1');
    expect(api.state.classEdits.a).toEqual({ to: 'p-1' });
    expect(stored().sessionId).toBe('sess-1');
  });

  it('drops the stack when the dev server is a different process', () => {
    mount('sess-1');
    act(() => api.update(withClass('a', 'p-1')));
    act(() => root!.unmount());

    const onReset = vi.fn();
    mount('sess-2', onReset);
    expect(api.state.classEdits).toEqual({});
    expect(api.restored).toBe(false);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('restores optimistically while the bridge is still silent', () => {
    // With no server to validate against, losing the work is the worse failure; the
    // reconcile above throws it away if the id turns out to differ.
    mount('sess-1');
    act(() => api.update(withClass('a', 'p-1')));
    act(() => root!.unmount());

    mount(null);
    expect(api.state.classEdits.a).toEqual({ to: 'p-1' });
    expect(api.restored).toBe(true);
  });

  it('survives a corrupt or foreign record rather than throwing on mount', () => {
    window.localStorage.setItem(KEY, '{not json');
    mount('sess-1');
    expect(api.state).toEqual(emptyEditState());
    expect(api.restored).toBe(false);
  });

  it('ignores a record with no session id, even before the bridge answers', () => {
    // `mount(null)` is what makes this observable: with a session id known, the
    // reconcile effect already throws an id-less record away, so the read-time guard
    // only changes the outcome while the bridge is still silent.
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ present: { ...emptyEditState(), classEdits: { a: { to: 'p-1' } } } }),
    );
    mount(null);
    expect(api.restored).toBe(false);
    expect(api.state.classEdits).toEqual({});
  });
});

describe('normalizeState — a stored snapshot is an OLDER SCHEMA', () => {
  it('fills in a map the record was written before', () => {
    // `editStateKey` runs on the render path, so a missing map white-screens the
    // whole editor rather than degrading one panel.
    const { layoutEdits, ...older } = emptyEditState();
    void layoutEdits;
    const out = normalizeState({ ...older, classEdits: { a: { to: 'p-1' } } });
    expect(out.layoutEdits).toEqual({});
    expect(out.classEdits).toEqual({ a: { to: 'p-1' } });
  });

  it('refuses a non-map value from a corrupt record', () => {
    // A null or an array must never become the value `Object.keys` is handed.
    const out = normalizeState({ classEdits: null, tokenEdits: [1], rebinds: 'x' });
    expect(out).toEqual(emptyEditState());
  });

  it('returns an empty state for a non-object', () => {
    expect(normalizeState(null)).toEqual(emptyEditState());
    expect(normalizeState(42)).toEqual(emptyEditState());
  });

  it('migrates the stacks too, not just the present', () => {
    // Stepping back into an un-migrated snapshot hits the same throw a few
    // keystrokes later.
    const { layoutEdits, ...older } = emptyEditState();
    void layoutEdits;
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        sessionId: 'sess-1',
        present: { ...older, classEdits: { b: { to: 'p-2' } } },
        past: [{ ...older }],
        future: [],
        baseline: { ...older },
        baselineStack: [{ ...older }],
      }),
    );
    mount('sess-1');
    act(() => api.undo());
    expect(api.state.layoutEdits).toEqual({});
    expect(api.baseline.layoutEdits).toEqual({});
  });
});

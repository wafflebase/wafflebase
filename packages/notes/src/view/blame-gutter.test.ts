import { describe, it, expect } from 'vitest';
import { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MemNoteStore } from '../store/memory.js';
import type { NoteAuthorSpan } from '../store/store.js';
import { initialize } from './editor.js';
import { ANONYMOUS_AUTHOR, computeBlameLabels } from './blame-gutter.js';

/** Span helper: `[from, to)` written by `author` at `at`. */
function span(
  from: number,
  to: number,
  author: string | null,
  at = 0,
): NoteAuthorSpan {
  return { from, to, author, at };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function gutterLabels(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('.cm-noteBlame .cm-gutterElement'),
  ).map((el) => el.textContent ?? '');
}

describe('computeBlameLabels', () => {
  it('labels each line with the author of its most recent edit', () => {
    const doc = Text.of(['alpha', 'beta']);
    const labels = computeBlameLabels(doc, [
      span(0, 6, 'ann', 10),
      span(6, 10, 'bob', 20),
    ]);
    expect(labels).toEqual(['ann', 'bob']);
  });

  it('collapses consecutive lines by the same author', () => {
    const doc = Text.of(['one', 'two', 'three', 'four']);
    const labels = computeBlameLabels(doc, [
      span(0, 8, 'ann', 10),
      span(8, 14, 'bob', 20),
      span(14, 18, 'ann', 30),
    ]);
    expect(labels).toEqual(['ann', '', 'bob', 'ann']);
  });

  it('leaves lines with no recorded authorship blank', () => {
    const doc = Text.of(['legacy line', 'new line']);
    const labels = computeBlameLabels(doc, [
      span(0, 12, null),
      span(12, 20, 'ann', 5),
    ]);
    expect(labels).toEqual(['', 'ann']);
  });

  it('prefers the newest run when a line has several authors', () => {
    // "hello" written by ann, then bob prepended "## " in front of it.
    const doc = Text.of(['## hello']);
    const labels = computeBlameLabels(doc, [
      span(0, 3, 'bob', 99),
      span(3, 8, 'ann', 5),
    ]);
    expect(labels).toEqual(['bob']);
  });

  it('outranks unattributed text with any real edit on the same line', () => {
    const doc = Text.of(['old new']);
    const labels = computeBlameLabels(doc, [
      span(0, 4, null),
      span(4, 7, 'ann', 1),
    ]);
    expect(labels).toEqual(['ann']);
  });

  it('falls back to Anonymous when the author has no name', () => {
    const doc = Text.of(['written by nobody']);
    const labels = computeBlameLabels(doc, [span(0, 17, '', 7)]);
    expect(labels).toEqual([ANONYMOUS_AUTHOR]);
  });

  it('attributes an empty line to whoever typed the newline ending it', () => {
    const doc = Text.of(['a', '', 'b']);
    // "a\n" by ann, "\n" by bob, "b" by ann.
    const labels = computeBlameLabels(doc, [
      span(0, 2, 'ann', 1),
      span(2, 3, 'bob', 2),
      span(3, 4, 'ann', 3),
    ]);
    expect(labels).toEqual(['ann', 'bob', 'ann']);
  });
});

describe('blame gutter in the editor', () => {
  it('adds no gutter at all unless it is switched on', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const api = initialize(container, new MemNoteStore('a\nb'), 'light');

    expect(api.getShowAuthors()).toBe(false);
    expect(container.querySelector('.cm-noteBlame')).toBeNull();

    api.dispose();
    container.remove();
  });

  it('switches the gutter on after mount, the way the view menu does', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const store = new MemNoteStore();
    store.setLocalAuthor('ann');
    store.editText(0, 0, 'first\nsecond\n');
    store.setLocalAuthor('bob');
    store.editText(13, 13, 'third');

    // The production path never mounts with `showAuthors: true`: the hosts
    // mount with the persisted preference (false by default) and flip it with
    // `setShowAuthors` when the user checks "Show authors" in the view menu.
    const api = initialize(container, store, 'light', false, 'edit');
    await tick();
    expect(container.querySelector('.cm-noteBlame')).toBeNull();

    api.setShowAuthors(true);
    await tick();

    expect(api.getShowAuthors()).toBe(true);
    expect(gutterLabels(container)).toEqual(['ann', '', 'bob']);

    // ...and typing afterwards keeps being attributed, i.e. the tracker the
    // reconfigure installed is live, not a one-shot paint.
    store.setLocalAuthor('cal');
    const view = EditorView.findFromDOM(container)!;
    view.dispatch({
      changes: { from: 18, insert: '\nfourth' },
      userEvent: 'input.type',
    });
    await tick();
    expect(gutterLabels(container)).toEqual(['ann', '', 'bob', 'cal']);

    api.dispose();
    container.remove();
  });

  it('shows author labels once enabled, and removes them again', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const store = new MemNoteStore();
    store.setLocalAuthor('ann');
    store.editText(0, 0, 'first\nsecond\n');
    store.setLocalAuthor('bob');
    store.editText(13, 13, 'third');

    const api = initialize(container, store, 'light', false, 'edit', {
      showAuthors: true,
    });
    await tick();

    expect(api.getShowAuthors()).toBe(true);
    expect(gutterLabels(container)).toEqual(['ann', '', 'bob']);

    api.setShowAuthors(false);
    expect(container.querySelector('.cm-noteBlame')).toBeNull();

    api.dispose();
    container.remove();
  });

  it('attributes text typed in the editor to the local author', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const store = new MemNoteStore('legacy\n');
    store.setLocalAuthor('ann');
    const api = initialize(container, store, 'light', false, 'edit', {
      showAuthors: true,
    });
    await tick();
    // The pre-existing line has no authorship, so it stays blank.
    expect(gutterLabels(container)).toEqual(['', '']);

    const view = EditorView.findFromDOM(container)!;
    view.dispatch({
      changes: { from: 7, insert: 'typed' },
      userEvent: 'input.type',
    });
    // The gutter paints before `noteSync` reaches the store, so the label
    // lands on the repaint the tracker schedules.
    await tick();
    expect(gutterLabels(container)).toEqual(['', 'ann']);

    api.dispose();
    container.remove();
  });
});

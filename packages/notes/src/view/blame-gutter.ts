import * as cmState from '@codemirror/state';
import * as cmView from '@codemirror/view';
import type { NoteAuthorSpan, NoteStore } from '../store/store.js';
import { noteStoreFacet } from './note-sync.js';

/**
 * Blame gutter — who last edited each line (issue #814).
 *
 * Split into two extensions on purpose:
 *
 * - `noteBlameGutter` must be listed BEFORE `basicSetup`, because CodeMirror
 *   renders gutters in `activeGutters` facet order and `basicSetup` is what
 *   contributes `lineNumbers()`. Earlier in the facet = further left.
 * - `noteBlameTracker` must be listed AFTER `noteSync`, because that is the
 *   plugin that pushes a local edit into the store. A tracker running before
 *   it would read the model as it stood one keystroke ago.
 *
 * Both are off unless the host enables the gutter, so a reader who never turns
 * it on gets neither the extra gutter nor the per-edit authorship walk.
 */

/** Label for a run whose author had no name (anonymous editing). */
export const ANONYMOUS_AUTHOR = 'Anonymous';

/**
 * Marks the empty transaction the tracker dispatches to repaint the gutter
 * after it has recomputed the labels. See `NoteBlameTracker.scheduleRepaint`.
 */
const blameRepaint = cmState.Annotation.define<boolean>();

/**
 * The author of the line covering `[from, to)`: the one who wrote the run with
 * the newest timestamp, i.e. the line's most recent edit. Unattributed runs
 * carry `at: 0`, so any real edit outranks them; a line made only of
 * unattributed text yields `null` (rendered blank rather than as a guess).
 */
function authorOfRange(
  spans: NoteAuthorSpan[],
  from: number,
  to: number,
): string | null {
  let best: NoteAuthorSpan | null = null;
  for (const span of spans) {
    if (span.to <= from) continue;
    if (span.from >= to) break;
    // `>=` so that, among runs written in the same millisecond, the later one
    // in the document wins — a stable, document-order tiebreak.
    if (!best || span.at >= best.at) best = span;
  }
  if (!best || best.author === null) return null;
  return best.author.trim() === '' ? ANONYMOUS_AUTHOR : best.author;
}

/**
 * The gutter label for every line of `doc`, indexed by line number - 1.
 * Consecutive lines by the same author collapse: only the first of a run
 * carries the name, the rest are `''` (blank), which keeps the gutter quiet.
 */
export function computeBlameLabels(
  doc: cmState.Text,
  spans: NoteAuthorSpan[],
): string[] {
  const labels: string[] = [];
  let previous: string | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    // An empty line has no characters of its own, so attribute it to whoever
    // typed the newline that ends it — the character at `line.from`.
    const to =
      line.to > line.from ? line.to : Math.min(line.from + 1, doc.length);
    const author = authorOfRange(spans, line.from, to);
    labels.push(author !== null && author !== previous ? author : '');
    previous = author;
  }
  return labels;
}

function sameLabels(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((label, i) => label === b[i]);
}

/**
 * Labels the tracker has computed, per view.
 *
 * The gutter reads them from here rather than through `view.plugin(...)`,
 * which would be a trap: looking a plugin up forces its pending `update()` to
 * run right then. The gutter renders before `noteSync` has pushed the edit to
 * the store, so pulling the tracker in would make it read the model one
 * keystroke stale — and mark itself updated, so its real turn never came.
 */
const labelsByView = new WeakMap<cmView.EditorView, string[]>();

class BlameMarker extends cmView.GutterMarker {
  constructor(readonly label: string) {
    super();
  }

  eq(other: BlameMarker): boolean {
    return other.label === this.label;
  }

  toDOM(): Node {
    const span = document.createElement('span');
    span.className = 'cm-noteBlameLabel';
    span.textContent = this.label;
    // The gutter is narrow and names are elided with an ellipsis, so keep the
    // full name reachable on hover.
    span.title = this.label;
    return span;
  }
}

/**
 * Recomputes the per-line labels from the store and repaints the gutter.
 * Registered after `noteSync` (see the file header) so it always reads a model
 * that already contains the edit being rendered.
 */
class NoteBlameTracker implements cmView.PluginValue {
  private readonly store: NoteStore;
  /** Collapsed display label per line; `''` = blank. */
  private labels: string[] = [];
  private repaintQueued = false;
  private destroyed = false;

  constructor(private readonly view: cmView.EditorView) {
    this.store = view.state.facet(noteStoreFacet);
    this.publish(
      computeBlameLabels(view.state.doc, this.store.getAuthorSpans()),
    );
    // The gutter is built before this plugin exists, so its first paint had no
    // labels at all; repaint once they are known.
    this.scheduleRepaint(view);
  }

  update(update: cmView.ViewUpdate): void {
    if (!update.docChanged) return;
    const next = computeBlameLabels(
      update.state.doc,
      this.store.getAuthorSpans(),
    );
    if (sameLabels(next, this.labels)) return;
    this.publish(next);
    this.scheduleRepaint(update.view);
  }

  destroy(): void {
    this.destroyed = true;
    labelsByView.delete(this.view);
  }

  private publish(labels: string[]): void {
    this.labels = labels;
    labelsByView.set(this.view, labels);
  }

  /**
   * Ask the gutter to repaint with the labels just computed. It cannot be told
   * synchronously: the gutter renders earlier in the same update cycle (it has
   * to, to sit left of the line numbers), so the only way to get fresh labels
   * on screen is one empty transaction afterwards. Coalesced, and skipped
   * entirely when the labels did not change, so an idle editor stays idle.
   */
  private scheduleRepaint(view: cmView.EditorView): void {
    if (this.repaintQueued) return;
    this.repaintQueued = true;
    queueMicrotask(() => {
      this.repaintQueued = false;
      if (this.destroyed) return;
      view.dispatch({ annotations: [blameRepaint.of(true)] });
    });
  }
}

const noteBlameTrackerPlugin = cmView.ViewPlugin.fromClass(NoteBlameTracker);

const noteBlameTheme = cmView.EditorView.baseTheme({
  '.cm-noteBlame': {
    minWidth: '6.5em',
    maxWidth: '6.5em',
    padding: '0 6px 0 8px',
    fontSize: '0.85em',
    opacity: '0.55',
    userSelect: 'none',
  },
  '.cm-noteBlame .cm-gutterElement': {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

/**
 * The gutter itself. List it BEFORE `basicSetup` so it renders to the left of
 * the line numbers.
 */
export const noteBlameGutter: cmState.Extension = [
  cmView.gutter({
    class: 'cm-noteBlame',
    // Most lines are blank (a run of lines by one author shows one label), and
    // an element per line keeps the gutter a plain row-per-line column rather
    // than a sparse one positioned by accumulated margins.
    renderEmptyElements: true,
    lineMarker(view, line) {
      const labels = labelsByView.get(view);
      if (!labels) return null;
      const label = labels[view.state.doc.lineAt(line.from).number - 1];
      return label ? new BlameMarker(label) : null;
    },
    lineMarkerChange: (update) =>
      update.transactions.some(
        (tr) => tr.annotation(blameRepaint) !== undefined,
      ),
  }),
  noteBlameTheme,
];

/**
 * The label source feeding `noteBlameGutter`. List it AFTER `noteSync` so it
 * reads the store once the current edit has reached it.
 */
export const noteBlameTracker: cmState.Extension = noteBlameTrackerPlugin;

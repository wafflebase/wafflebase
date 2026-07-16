import { EditorSelection, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** Inline markdown formats active at the current selection. */
export interface NoteInlineFormats {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  link: boolean;
}

/**
 * Whether the main selection is immediately surrounded by `marker` — either the
 * markers sit just outside the selection, or the selection itself begins and
 * ends with them.
 */
function surroundedBy(state: EditorState, marker: string): boolean {
  const { from, to } = state.selection.main;
  const mlen = marker.length;
  const before = state.sliceDoc(Math.max(0, from - mlen), from);
  const after = state.sliceDoc(to, Math.min(state.doc.length, to + mlen));
  if (before === marker && after === marker) return true;
  const selected = state.sliceDoc(from, to);
  return (
    selected.length >= 2 * mlen &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  );
}

const LINK_RE = /\[[^\]]*\]\([^)]*\)/g;

/** The markdown link `[text](url)` containing the cursor, if any. */
function linkAtCursor(
  state: EditorState,
): { from: number; to: number; text: string } | null {
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(line.text))) {
    const start = line.from + m.index;
    const end = start + m[0].length;
    if (from >= start && from <= end) {
      const label = m[0].match(/^\[([^\]]*)\]/);
      return { from: start, to: end, text: label ? label[1] : '' };
    }
  }
  return null;
}

export function computeActiveFormats(state: EditorState): NoteInlineFormats {
  const bold = surroundedBy(state, '**');
  return {
    bold,
    // A single `*` around the selection means italic — unless it is actually
    // the inner `*` of a `**` bold marker.
    italic: surroundedBy(state, '*') && !bold,
    strikethrough: surroundedBy(state, '~~'),
    link: linkAtCursor(state) !== null,
  };
}

/** Toggle a symmetric inline marker (`**`, `*`, `~~`) around the selection. */
function toggleWrap(view: EditorView, marker: string): void {
  const { state } = view;
  const { from, to } = state.selection.main;
  const mlen = marker.length;
  const before = state.sliceDoc(Math.max(0, from - mlen), from);
  const after = state.sliceDoc(to, Math.min(state.doc.length, to + mlen));
  const selected = state.sliceDoc(from, to);

  if (before === marker && after === marker) {
    // Unwrap markers sitting just outside the selection.
    view.dispatch(
      state.update({
        changes: [
          { from: from - mlen, to: from, insert: '' },
          { from: to, to: to + mlen, insert: '' },
        ],
        selection: EditorSelection.range(from - mlen, to - mlen),
        userEvent: 'delete',
      }),
    );
  } else if (
    selected.length >= 2 * mlen &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    // Unwrap markers inside the selection.
    const inner = selected.slice(mlen, selected.length - mlen);
    view.dispatch(
      state.update({
        changes: { from, to, insert: inner },
        selection: EditorSelection.range(from, from + inner.length),
        userEvent: 'delete',
      }),
    );
  } else {
    // Wrap; place the cursor between the markers for an empty selection.
    view.dispatch(
      state.update({
        changes: { from, to, insert: marker + selected + marker },
        selection:
          from === to
            ? EditorSelection.cursor(from + mlen)
            : EditorSelection.range(from + mlen, to + mlen),
        userEvent: 'input',
      }),
    );
  }
  view.focus();
}

export function toggleBold(view: EditorView): void {
  toggleWrap(view, '**');
}
export function toggleItalic(view: EditorView): void {
  toggleWrap(view, '*');
}
export function toggleStrikethrough(view: EditorView): void {
  toggleWrap(view, '~~');
}

/** Wrap the selection as a link, or unwrap the link under the cursor. */
export function toggleLink(view: EditorView): void {
  const { state } = view;
  const existing = linkAtCursor(state);
  if (existing) {
    view.dispatch(
      state.update({
        changes: { from: existing.from, to: existing.to, insert: existing.text },
        selection: EditorSelection.range(
          existing.from,
          existing.from + existing.text.length,
        ),
        userEvent: 'delete',
      }),
    );
    view.focus();
    return;
  }
  const { from, to } = state.selection.main;
  const text = state.sliceDoc(from, to) || 'text';
  const insert = `[${text}](url)`;
  const urlFrom = from + 1 + text.length + 2; // "[" + text + "]("
  view.dispatch(
    state.update({
      changes: { from, to, insert },
      selection: EditorSelection.range(urlFrom, urlFrom + 3), // select "url"
      userEvent: 'input',
    }),
  );
  view.focus();
}

/**
 * Insert a GFM table skeleton of `rows` × `cols` (the first row is the header,
 * so `rows` counts the header row) on its own line(s). Cells are empty.
 */
export function insertTable(view: EditorView, rows: number, cols: number): void {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const prefix = pos === line.from ? '' : '\n';

  const rowLine = `| ${Array(c).fill('   ').join(' | ')} |`;
  const sepLine = `| ${Array(c).fill('---').join(' | ')} |`;
  const lines = [rowLine, sepLine];
  for (let i = 1; i < r; i++) lines.push(rowLine);
  const table = `${prefix}${lines.join('\n')}\n`;

  const cursor = pos + prefix.length + 2; // just inside the first header cell
  view.dispatch(
    state.update({
      changes: { from: pos, insert: table },
      selection: EditorSelection.cursor(cursor),
      userEvent: 'input',
      scrollIntoView: true,
    }),
  );
  view.focus();
}

import { type EditorState, type Line } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** The kind of markdown list a line belongs to, or `null` for a plain line. */
export type NoteListKind = 'bullet' | 'ordered' | 'task';

/** Block-level list state of the current selection, for the toolbar. */
export interface NoteListState {
  /** The kind shared by every non-blank selected line, else `null`. */
  kind: NoteListKind | null;
  /** Whether the selected list lines can nest one level deeper. */
  canIndent: boolean;
  /** Whether the selected list lines can move one level out. */
  canOutdent: boolean;
}

/** A markdown line split into its list parts. */
interface ParsedLine {
  line: Line;
  /**
   * The blockquote prefix the line opens with (`'> '`, `'> > '`, …), or `''`.
   * It is peeled off before the list marker is parsed and written back by
   * `prefixOf`, so every column below — `indent` above all — is measured
   * *inside* the quote. That is what lets one item nest under another within a
   * blockquote, and what stops an outdent from eating the `> ` itself.
   */
  quote: string;
  /** Leading whitespace after the quote prefix. */
  indent: string;
  /** List marker without its trailing space (`-`, `*`, `1.`), or `''`. */
  marker: string;
  /** Whitespace between the marker and the content. */
  gap: string;
  /** `' '` / `'x'` for a task item, or `null` when there is no checkbox. */
  check: string | null;
  /** Everything after the marker and checkbox. */
  content: string;
}

/**
 * A run of blockquote markers, each optionally followed by one space (`> `,
 * `>> `, `> > `). Only the space directly after a `>` belongs to the prefix —
 * anything further is the quoted line's own indent.
 */
const QUOTE_RE = /^ {0,3}(?:> ?)+/;

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(?:\[([ xX])\]\s)?([\s\S]*)$/;

function parseLine(line: Line): ParsedLine {
  const quote = QUOTE_RE.exec(line.text)?.[0] ?? '';
  const rest = line.text.slice(quote.length);
  const m = LIST_RE.exec(rest);
  if (!m) {
    const indent = /^\s*/.exec(rest)![0];
    return {
      line,
      quote,
      indent,
      marker: '',
      gap: '',
      check: null,
      content: rest.slice(indent.length),
    };
  }
  return {
    line,
    quote,
    indent: m[1],
    marker: m[2],
    gap: m[3],
    check: m[4] === undefined ? null : m[4].toLowerCase(),
    content: m[5],
  };
}

function kindOf(p: ParsedLine): NoteListKind | null {
  if (!p.marker) return null;
  if (p.check !== null) return 'task';
  return /^\d/.test(p.marker) ? 'ordered' : 'bullet';
}

/** Column at which the item's content starts — the nesting width of a child. */
function contentColumn(p: ParsedLine): number {
  return p.indent.length + p.marker.length + p.gap.length;
}

/**
 * The markers in front of the line's content: quote prefix, indent, list
 * marker and checkbox. Only this part is ever rewritten, so a caret sitting in
 * the content keeps its place across a toolbar action.
 */
function prefixOf(p: ParsedLine): string {
  if (!p.marker) return p.quote + p.indent;
  const box = p.check === null ? '' : `[${p.check}] `;
  return p.quote + p.indent + p.marker + p.gap + box;
}

/** Whether the line has nothing but whitespace on it. */
function isBlank(p: ParsedLine): boolean {
  return !p.marker && p.content.trim() === '';
}

/**
 * The lines touched by the main selection, top to bottom. A selection ending
 * exactly at a line start does not include that line — the user dragged to the
 * beginning of it, not into it.
 */
function selectedLines(state: EditorState): ParsedLine[] {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(Math.min(from, to));
  const last = state.doc.lineAt(Math.max(from, to));
  const lastNumber =
    last.number > first.number && last.from === Math.max(from, to)
      ? last.number - 1
      : last.number;
  const out: ParsedLine[] = [];
  for (let n = first.number; n <= lastNumber; n++) {
    out.push(parseLine(state.doc.line(n)));
  }
  return out;
}

/**
 * The lines a list action applies to: the non-blank ones, or — when the
 * selection is nothing but blank lines (typically an empty line the user is
 * about to type into) — the blank ones, so the marker still appears.
 */
function targetLines(lines: ParsedLine[]): ParsedLine[] {
  const nonBlank = lines.filter((p) => !isBlank(p));
  return nonBlank.length > 0 ? nonBlank : lines;
}

function selectedTargets(state: EditorState): ParsedLine[] {
  return targetLines(selectedLines(state));
}

/**
 * The list item directly above `p` that a nesting step would make it a child
 * of: the nearest preceding list line, skipping blank lines (a loose list
 * keeps blank lines between its items) but stopping at any other text.
 *
 * A line at a different quote depth is a different block container, so it ends
 * the walk instead of being read as a sibling — `> - a` is no relation of a
 * `- b` on the line below it.
 */
function itemAbove(state: EditorState, p: ParsedLine): ParsedLine | null {
  for (let n = p.line.number - 1; n >= 1; n--) {
    const prev = parseLine(state.doc.line(n));
    if (prev.quote !== p.quote) return null;
    if (prev.marker) return prev;
    if (!isBlank(prev)) return null;
  }
  return null;
}

/**
 * The nearest preceding list item shallower than `p` — the parent whose level
 * an outdent step returns to. Bounded by the quote depth, as `itemAbove` is.
 */
function parentOf(state: EditorState, p: ParsedLine): ParsedLine | null {
  for (let n = p.line.number - 1; n >= 1; n--) {
    const prev = parseLine(state.doc.line(n));
    if (prev.quote !== p.quote) return null;
    if (prev.marker && prev.indent.length < p.indent.length) return prev;
    if (!prev.marker && !isBlank(prev)) return null;
  }
  return null;
}

/**
 * How far one indent step moves the selected block, or `0` when it cannot
 * move. The whole block shifts by the step computed for its topmost list line,
 * so nesting relationships inside the selection are preserved.
 *
 * Indenting nests under the item above, which is only possible when there is
 * one at the same level or deeper — the first child of an item has no sibling
 * to nest under. The step is that sibling's content column rather than a fixed
 * two spaces, because an ordered item (`1. `) needs three columns to nest.
 */
function indentStep(state: EditorState, lines: ParsedLine[]): number {
  const top = lines.find((p) => p.marker);
  if (!top) return 0;
  const above = itemAbove(state, top);
  if (!above || above.indent.length < top.indent.length) return 0;
  const target =
    above.indent.length === top.indent.length
      ? contentColumn(above)
      : above.indent.length;
  return target > top.indent.length ? target - top.indent.length : 0;
}

/**
 * How far one outdent step moves the selected block (negative), or `0`.
 *
 * `indent` is measured inside the quote prefix, so a top-level item in a
 * blockquote reports `0` here: the `> ` is the floor, and outdenting can never
 * strip it.
 */
function outdentStep(state: EditorState, lines: ParsedLine[]): number {
  const top = lines.find((p) => p.marker);
  if (!top || top.indent.length === 0) return 0;
  const parent = parentOf(state, top);
  return (parent ? parent.indent.length : 0) - top.indent.length;
}

/** List state of the current selection, for toolbar toggles and buttons. */
export function computeListState(state: EditorState): NoteListState {
  const lines = selectedTargets(state);
  const first = kindOf(lines[0]);
  const kind =
    first !== null && lines.every((p) => kindOf(p) === first) ? first : null;
  return {
    kind,
    canIndent: indentStep(state, lines) > 0,
    canOutdent: outdentStep(state, lines) < 0,
  };
}

/**
 * Rewrite the marker prefix of each line with `next`, as one transaction so
 * the whole block is a single undo unit. CodeMirror maps the selection through
 * the changes, so the same lines stay selected.
 */
function replacePrefixes(
  view: EditorView,
  lines: ParsedLine[],
  next: (p: ParsedLine) => string,
): void {
  const changes = [];
  for (const p of lines) {
    const from = p.line.from;
    const to = p.line.to - p.content.length;
    const insert = next(p);
    if (insert !== p.line.text.slice(0, to - from)) {
      changes.push({ from, to, insert });
    }
  }
  if (changes.length > 0) {
    // Map the selection forward (assoc 1), as `toggleQuote` does: a caret
    // sitting exactly at a line start would otherwise stay *before* the
    // marker just written there, so the next keystroke would land ahead of
    // it and break the item apart.
    const changeSet = view.state.changes(changes);
    view.dispatch(
      view.state.update({
        changes: changeSet,
        selection: view.state.selection.map(changeSet, 1),
        userEvent: 'input',
      }),
    );
  }
  view.focus();
}

/**
 * Toggle `kind` over the selected lines: when every line is already of that
 * kind the whole block turns back into plain paragraphs, otherwise every line
 * is converted (an ordered list becomes bullets, a bullet becomes a task, …).
 * Ordered lists are numbered per indent level within the selection — and per
 * quote depth, since a list inside a blockquote is a list of its own and
 * starts at 1 again rather than continuing the one outside it.
 */
function toggleKind(view: EditorView, kind: NoteListKind): void {
  const lines = selectedTargets(view.state);
  const all = lines.every((p) => kindOf(p) === kind);
  const counters = new Map<string, number>();
  replacePrefixes(view, lines, (p) => {
    // Turning a list off drops the indent with the marker. Keeping it would
    // leave a nested item's content indented under the item above, which
    // markdown reads as that item's lazy continuation (or, at four spaces
    // outside a list, as a code block) — the line visually disappears into
    // its former parent instead of becoming the paragraph it now is.
    //
    // The quote prefix stays, though: it says which block the line lives in,
    // not how it is marked up inside it. Dropping it would silently lift the
    // line out of the blockquote the user put it in.
    if (all) return p.quote;
    if (kind === 'ordered') {
      const level = `${p.quote} ${p.indent.length}`;
      const n = (counters.get(level) ?? 0) + 1;
      counters.set(level, n);
      return prefixOf({ ...p, marker: `${n}.`, gap: ' ', check: null });
    }
    return prefixOf({
      ...p,
      marker: '-',
      gap: ' ',
      check: kind === 'task' ? (p.check ?? ' ') : null,
    });
  });
}

export function toggleBulletList(view: EditorView): void {
  toggleKind(view, 'bullet');
}

export function toggleOrderedList(view: EditorView): void {
  toggleKind(view, 'ordered');
}

export function toggleTaskList(view: EditorView): void {
  toggleKind(view, 'task');
}

/** Shift every selected list line by `step` columns (clamped at column 0). */
function shift(view: EditorView, step: number): void {
  replacePrefixes(view, selectedTargets(view.state), (p) => {
    if (!p.marker) return prefixOf(p);
    const width = Math.max(0, p.indent.length + step);
    return prefixOf({ ...p, indent: ' '.repeat(width) });
  });
}

/** Nest the selected list lines one level deeper, if they can nest. */
export function indentList(view: EditorView): void {
  const step = indentStep(view.state, selectedTargets(view.state));
  if (step > 0) shift(view, step);
}

/** Move the selected list lines one level out, if they are nested. */
export function outdentList(view: EditorView): void {
  const step = outdentStep(view.state, selectedTargets(view.state));
  if (step < 0) shift(view, step);
}

/**
 * Flip the checkbox on `lineNumber` (1-based) between `[ ]` and `[x]`, which
 * is what a click in the preview does. A line without a checkbox is left
 * alone: the preview can lag the document by one remote edit, and a stale
 * click must not rewrite whatever now sits on that line.
 */
export function setTaskChecked(
  view: EditorView,
  lineNumber: number,
  checked: boolean,
): void {
  if (lineNumber < 1 || lineNumber > view.state.doc.lines) return;
  const line = view.state.doc.line(lineNumber);
  const p = parseLine(line);
  if (p.check === null) return;
  const insert = prefixOf({ ...p, check: checked ? 'x' : ' ' });
  const to = line.to - p.content.length;
  if (insert === line.text.slice(0, to - line.from)) return;
  view.dispatch(
    view.state.update({
      changes: { from: line.from, to, insert },
      userEvent: 'input',
    }),
  );
}

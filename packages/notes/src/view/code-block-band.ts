import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

/** Line class on every line of a fenced or indented code block. */
export const CODE_BLOCK_LINE_CLASS = 'cm-wb-code-line';

const lineDeco = Decoration.line({ class: CODE_BLOCK_LINE_CLASS });

/**
 * Line decorations for the code blocks inside `ranges` (the visible ones).
 * Exported for tests; the plugin below is what the editor mounts.
 */
export function codeBlockLines(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): DecorationSet {
  const decos: Range<Decoration>[] = [];
  let lastLine = -1;
  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') return;
        const first = state.doc.lineAt(Math.max(node.from, from)).number;
        const last = state.doc.lineAt(Math.min(node.to, to)).number;
        for (let n = Math.max(first, lastLine + 1); n <= last; n++) {
          decos.push(lineDeco.range(state.doc.line(n).from));
          lastLine = n;
        }
        return false;
      },
    });
  }
  return Decoration.set(decos);
}

/**
 * Paints a code block as one full-width band, fence lines included. The
 * monospace token wash alone sits behind each span of text, so a block read
 * as a ragged stack of highlights rather than as a block — the way the
 * preview draws it.
 */
export const codeBlockBand = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = codeBlockLines(view.state, view.visibleRanges);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = codeBlockLines(
          update.state,
          update.view.visibleRanges,
        );
      }
    }
  },
  { decorations: (v) => v.decorations },
);

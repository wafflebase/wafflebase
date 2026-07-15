import * as cmState from '@codemirror/state';
import * as cmView from '@codemirror/view';
import type { NoteStore } from '../store/store.js';
import { noteStoreFacet } from './note-sync.js';

export const noteRemoteSelectionsTheme = cmView.EditorView.baseTheme({
  '.cm-ySelection': {},
  '.cm-ySelectionCaret': {
    position: 'relative',
    borderLeft: '1px solid black',
    borderRight: '1px solid black',
    marginLeft: '-1px',
    marginRight: '-1px',
    boxSizing: 'border-box',
    display: 'inline',
  },
  '.cm-ySelectionCaretDot': {
    borderRadius: '50%',
    position: 'absolute',
    width: '.4em',
    height: '.4em',
    top: '-.2em',
    left: '-.2em',
    backgroundColor: 'inherit',
    boxSizing: 'border-box',
  },
  '.cm-ySelectionInfo': {
    position: 'absolute',
    top: '-1.05em',
    left: '-1px',
    fontSize: '.75em',
    fontFamily: 'serif',
    fontStyle: 'normal',
    fontWeight: 'normal',
    lineHeight: 'normal',
    userSelect: 'none',
    color: 'white',
    paddingLeft: '2px',
    paddingRight: '2px',
    zIndex: '101',
    backgroundColor: 'inherit',
    whiteSpace: 'nowrap',
  },
});

const remoteSelAnnotation: cmState.AnnotationType<Array<number>> =
  cmState.Annotation.define();

class NoteCaretWidget extends cmView.WidgetType {
  constructor(
    readonly color: string,
    readonly name: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-ySelectionCaret';
    span.style.backgroundColor = this.color;
    span.style.borderColor = this.color;
    const dot = document.createElement('div');
    dot.className = 'cm-ySelectionCaretDot';
    const info = document.createElement('div');
    info.className = 'cm-ySelectionInfo';
    info.textContent = this.name;
    span.appendChild(document.createTextNode('⁠'));
    span.appendChild(dot);
    span.appendChild(document.createTextNode('⁠'));
    span.appendChild(info);
    span.appendChild(document.createTextNode('⁠'));
    return span;
  }

  eq(other: NoteCaretWidget): boolean {
    return other.color === this.color && other.name === this.name;
  }

  ignoreEvent(): boolean {
    return true;
  }

  get estimatedHeight(): number {
    return -1;
  }
}

class NoteRemoteSelectionsPluginValue implements cmView.PluginValue {
  private store: NoteStore;
  decorations: cmView.DecorationSet;
  private unsub: () => void;

  constructor(view: cmView.EditorView) {
    this.store = view.state.facet(noteStoreFacet);
    // Compute immediately so peer carets already present (e.g. a note that
    // loads with active co-editors) render on mount, not just after the
    // first transaction — CodeMirror only calls `update()` on transactions
    // that follow the plugin's construction.
    this.decorations = this.buildDecorations(view.state);
    this.unsub = this.store.subscribePresence(() => {
      view.dispatch({ annotations: [remoteSelAnnotation.of([])] });
    });
  }

  destroy(): void {
    this.unsub();
  }

  update(update: cmView.ViewUpdate): void {
    // Publish our local selection to peers.
    const hasFocus =
      update.view.hasFocus && update.view.dom.ownerDocument.hasFocus();
    const sel = hasFocus ? update.state.selection.main : null;
    if (sel) {
      this.store.setLocalSelection(sel.anchor, sel.head);
    } else {
      this.store.setLocalSelection(0, null);
    }

    this.decorations = this.buildDecorations(update.state);
  }

  private buildDecorations(state: cmState.EditorState): cmView.DecorationSet {
    const decorations: Array<cmState.Range<cmView.Decoration>> = [];
    const docLen = state.doc.length;
    for (const peer of this.store.getPeerSelections()) {
      const start = Math.min(peer.from, peer.to);
      const end = Math.max(peer.from, peer.to);
      if (start === end) {
        // caret only
      } else {
        const startLine = state.doc.lineAt(Math.min(start, docLen));
        const endLine = state.doc.lineAt(Math.min(end, docLen));
        const mark = (from: number, to: number) =>
          decorations.push({
            from,
            to,
            value: cmView.Decoration.mark({
              attributes: { style: `background-color: ${peer.color}` },
              class: 'cm-ySelection',
            }),
          });
        if (startLine.number === endLine.number) {
          mark(start, end);
        } else {
          mark(start, startLine.to);
          for (let i = startLine.number + 1; i < endLine.number; i++) {
            const line = state.doc.line(i);
            mark(line.from, line.to);
          }
          mark(endLine.from, end);
        }
      }
      const caretPos = Math.min(peer.to, docLen);
      decorations.push({
        from: caretPos,
        to: caretPos,
        value: cmView.Decoration.widget({
          side: peer.from - peer.to > 0 ? -1 : 1,
          block: false,
          widget: new NoteCaretWidget(peer.color, peer.name),
        }),
      });
    }
    return cmView.Decoration.set(decorations, true);
  }
}

export const noteRemoteSelections = cmView.ViewPlugin.fromClass(
  NoteRemoteSelectionsPluginValue,
  { decorations: (v) => v.decorations },
);

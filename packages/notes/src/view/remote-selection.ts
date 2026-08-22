import * as cmState from '@codemirror/state';
import * as cmView from '@codemirror/view';
import type { NoteStore } from '../store/store.js';
import { sanitizeDisplayName } from '../display-name.js';
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

/**
 * What this application actually produces for a peer color — `hsl(210, 70%,
 * 55%)` (`noteUserColor`) — plus the other shapes a legitimate one could take:
 * a hex color, a bare CSS color keyword, or an `rgb()/rgba()/hsl()/hsla()`
 * function whose arguments are numbers. Nothing else: no quotes, no `url(`, no
 * semicolon, no closing brace.
 */
const SAFE_COLOR_RE =
  /^(?:#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|rgba|hsl|hsla)\((?:\s*[-+]?[0-9]*\.?[0-9]+(?:%|deg|rad|grad|turn)?\s*[,/]?\s*){3,4}\))$/i;

/** Rendered in place of a color that is not recognizably one. */
export const FALLBACK_PEER_COLOR = '#9ca3af';

/**
 * A peer's presence `color` as it is safe to put in a `style` attribute.
 *
 * `color` is self-reported in exactly the way `name` is (see
 * `display-name.ts`): it comes from a peer's own Yorkie presence, which every
 * attached client writes for itself and nothing validates. Unlike a name it is
 * not text content but part of a *style attribute string*, and an attribute
 * value is a declaration LIST — a `color` containing `;` stops being a color
 * and becomes whatever further declarations its author chose (`position:
 * fixed; inset: 0; background-image: url(https://…)` is a full-viewport
 * overlay and an outbound request on every other viewer's screen).
 *
 * So a color is not escaped, it is RECOGNIZED: a value that does not match one
 * of the shapes a real color takes is replaced with a neutral fallback rather
 * than rendered. Escaping would be the wrong tool — there is no character to
 * neutralize here, only a value to refuse.
 */
export function sanitizePeerColor(value: unknown): string {
  if (typeof value !== 'string') return FALLBACK_PEER_COLOR;
  const color = value.trim();
  // Bounded before the regex runs: the pattern has nested quantifiers, and the
  // input is peer-controlled and otherwise unbounded.
  if (color.length === 0 || color.length > 64) return FALLBACK_PEER_COLOR;
  return SAFE_COLOR_RE.test(color) ? color : FALLBACK_PEER_COLOR;
}

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
      // Recognized once per peer, then used for every decoration below — both
      // the style-attribute string and the caret widget — so no raw
      // peer-controlled color reaches the DOM by either route.
      const color = sanitizePeerColor(peer.color);
      // Clamp both endpoints to the local document bounds ONCE, up front.
      // A peer selection can point past `docLen` in a real collaborative
      // race (another client deleted text after the peer recorded its
      // selection); every coordinate handed to CodeMirror below — line
      // lookups, mark() boundaries, and the caret — must derive from these
      // clamped values, not the raw peer.from/peer.to.
      const start = Math.min(Math.max(0, Math.min(peer.from, peer.to)), docLen);
      const end = Math.min(Math.max(0, Math.max(peer.from, peer.to)), docLen);
      if (start === end) {
        // caret only
      } else {
        const startLine = state.doc.lineAt(start);
        const endLine = state.doc.lineAt(end);
        const mark = (from: number, to: number) =>
          decorations.push({
            from,
            to,
            value: cmView.Decoration.mark({
              attributes: { style: `background-color: ${color}` },
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
      const caretPos = peer.from - peer.to > 0 ? start : end;
      decorations.push({
        from: caretPos,
        to: caretPos,
        value: cmView.Decoration.widget({
          side: peer.from - peer.to > 0 ? -1 : 1,
          block: false,
          // Both fields on the widget are a peer's own presence — the same
          // self-reported values the blame gutter shows, and unverified in
          // exactly the same way (see `display-name.ts`). Neither is trusted:
          // a name cannot carry invisible or direction-changing characters and
          // cannot run past the cap, and a color that is not recognizably a
          // color is replaced rather than rendered.
          widget: new NoteCaretWidget(
            color,
            sanitizeDisplayName(peer.name) ?? '',
          ),
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

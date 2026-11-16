import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/**
 * The note source editor's look, drawn from the host app's semantic tokens
 * (`--background`, `--foreground`, `--muted-foreground`, `--border`, `--ring`,
 * `--selected`, `--link`) rather than from a bundled palette, so the pane sits
 * on the same surface as the toolbar above it and follows light/dark with the
 * rest of the chrome. Every `var()` carries a fallback so the engine still
 * renders sensibly mounted outside the app.
 *
 * The rule it follows is the app's One Accent Rule: syrup is the caret and the
 * focus, never markup. Markdown punctuation (`#`, `-`, `**`, `>`, the URL of a
 * link) recedes to the muted foreground and the words it marks up carry the
 * meaning — headings by weight, emphasis by style — so the source reads like
 * the document it describes instead of like a code listing.
 */

const FG = 'var(--foreground, #1c1b19)';
const MUTED = 'var(--muted-foreground, #71717a)';
const BG = 'var(--background, #ffffff)';
const RULE = 'var(--border, rgba(0, 0, 0, 0.08))';
const CARET = 'var(--ring, #b8651a)';
const SELECTED = 'var(--selected, rgba(244, 201, 93, 0.3))';
const LINK = 'var(--link, #1967d2)';
const WASH = 'color-mix(in oklab, var(--muted-foreground, #71717a) 9%, transparent)';

const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

const chrome = (dark: boolean) =>
  EditorView.theme(
    {
      '&': {
        color: FG,
        backgroundColor: BG,
        fontSize: '14px',
      },
      '.cm-scroller': {
        fontFamily: MONO,
        lineHeight: '1.65',
      },
      '.cm-content': {
        padding: '16px 0',
        caretColor: CARET,
      },
      '.cm-line': {
        padding: '0 20px 0 12px',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: CARET,
        borderLeftWidth: '2px',
      },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
        { backgroundColor: SELECTED },
      '.cm-activeLine': { backgroundColor: WASH },
      '.cm-gutters': {
        backgroundColor: BG,
        color: MUTED,
        border: 'none',
        borderRight: `1px solid ${RULE}`,
      },
      '.cm-gutterElement': { opacity: '0.7' },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: FG,
      },
      '.cm-activeLineGutter.cm-gutterElement': { opacity: '1' },
      '.cm-foldPlaceholder': {
        backgroundColor: WASH,
        border: 'none',
        color: MUTED,
        padding: '0 6px',
      },
      '.cm-placeholder': {
        color: MUTED,
        fontStyle: 'normal',
      },
      '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
        backgroundColor: 'transparent',
        outline: `1px solid ${RULE}`,
      },
      '.cm-searchMatch': {
        backgroundColor: SELECTED,
        outline: `1px solid ${RULE}`,
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: SELECTED,
      },
      '.cm-panels': {
        backgroundColor: BG,
        color: FG,
      },
      '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${RULE}` },
      '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${RULE}` },
      '.cm-tooltip': {
        backgroundColor: BG,
        color: FG,
        border: `1px solid ${RULE}`,
      },
    },
    { dark },
  );

const markdownHighlight = HighlightStyle.define([
  // Heading lines: weight, not size, so the monospace column grid holds.
  { tag: t.heading1, fontWeight: '700' },
  { tag: [t.heading2, t.heading3], fontWeight: '650' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  // `#`, `-`, `1.`, `>`, `**`, `` ` ``, `[`, `](` — the punctuation recedes.
  { tag: t.processingInstruction, color: MUTED },
  // `[ ]` / `[x]` task boxes (GFM `TaskMarker`) are markup too.
  { tag: [t.url, t.labelName, t.atom], color: MUTED },
  { tag: t.link, color: LINK },
  { tag: t.quote, color: MUTED, fontStyle: 'italic' },
  { tag: t.monospace, backgroundColor: WASH, borderRadius: '2px' },
  { tag: t.contentSeparator, color: MUTED },
  // HTML in markdown (`<details>`, comments) and embedded code tokens.
  { tag: [t.comment, t.meta], color: MUTED },
  { tag: [t.angleBracket, t.tagName, t.attributeName], color: MUTED },
]);

/**
 * The note editor's theme for `mode`: token-driven chrome + markdown styling.
 * `mode` only sets CodeMirror's own `dark` flag; the colours come from the
 * host's tokens, which flip with its `.dark` class. Outside the app the
 * fallbacks are the light values.
 */
export function noteEditorTheme(mode: 'light' | 'dark'): Extension {
  return [chrome(mode === 'dark'), syntaxHighlighting(markdownHighlight)];
}

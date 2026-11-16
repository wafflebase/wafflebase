import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { styleTags, Tag, tags as t } from '@lezer/highlight';
import { CODE_BLOCK_LINE_CLASS, codeBlockBand } from './code-block-band.js';

/**
 * The note source editor's look, drawn from the host app's semantic tokens
 * (`--background`, `--foreground`, `--muted`, `--muted-foreground`,
 * `--border`, `--ring`, `--selected`, `--link`) rather than from a bundled
 * palette, so it follows light/dark with the rest of the chrome. Every
 * `var()` carries a fallback so the engine still renders sensibly mounted
 * outside the app.
 *
 * Two things keep the source from being mistaken for the preview beside it:
 *
 * - **Its own surface.** The source pane sits on a tinted work surface; the
 *   preview stays on the paper `--background`. Side by side, the edge between
 *   the two is a change of material, not only a hairline.
 * - **Markup has colour.** The markdown syntax carries hues from the same
 *   GitHub code palette the preview's code blocks use (`notes-preview.css`),
 *   so a heading line, a list marker, a quote and a code span each read as
 *   syntax at a glance. Inline punctuation (`**`, `` ` ``, `[`, `](`) stays
 *   muted so prose lines do not turn into a code listing. Syrup remains the
 *   caret and the focus, never markup (One Accent Rule).
 */

const FG = 'var(--foreground, #1c1b19)';
const MUTED = 'var(--muted-foreground, #71717a)';
// The source pane's work surface: two thirds of the way from paper to the
// app's `--muted` wash, so it reads as a different surface in both modes
// without becoming a panel (dark `--muted` alone is far lighter than paper).
export const NOTE_SOURCE_SURFACE =
  'color-mix(in oklab, var(--muted, #f4f4f5) 65%, var(--background, #ffffff))';
const SURFACE = NOTE_SOURCE_SURFACE;
const RULE = 'var(--border, rgba(0, 0, 0, 0.08))';
const CARET = 'var(--ring, #b8651a)';
const SELECTED = 'var(--selected, rgba(244, 201, 93, 0.3))';
const LINK = 'var(--link, #1967d2)';
const WASH = 'color-mix(in oklab, var(--muted-foreground, #71717a) 9%, transparent)';
// A code block's band: paper set into the work surface, the way the preview
// sets a code block off from its text.
const CODE_BAND = 'color-mix(in oklab, var(--muted-foreground, #71717a) 11%, transparent)';

/**
 * Markup hues, from the preview's highlight.js palette (github / github-dark)
 * so the source and the preview speak the same colour language. Each clears
 * 4.5:1 on its mode's work surface; the light red and green are GitHub's
 * deeper shades of the preview's, which measured 4.3:1 on the tint.
 */
const PALETTE = {
  light: {
    heading: '#005cc5',
    mark: '#cb2431',
    quote: '#1a7f37',
    code: '#032f62',
    tag: '#22863a',
    comment: '#6a737d',
  },
  dark: {
    heading: '#79c0ff',
    mark: '#ff7b72',
    quote: '#7ee787',
    code: '#a5d6ff',
    tag: '#7ee787',
    comment: '#8b949e',
  },
} as const;

const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

const chrome = (dark: boolean) =>
  EditorView.theme(
    {
      '&': {
        color: FG,
        backgroundColor: SURFACE,
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
      [`.${CODE_BLOCK_LINE_CLASS}`]: { backgroundColor: CODE_BAND },
      '.cm-gutters': {
        backgroundColor: SURFACE,
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
        backgroundColor: SURFACE,
        color: FG,
      },
      '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${RULE}` },
      '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${RULE}` },
      '.cm-tooltip': {
        backgroundColor: 'var(--background, #ffffff)',
        color: FG,
        border: `1px solid ${RULE}`,
      },
    },
    { dark },
  );

// Markdown marks the default tags lump together as `processingInstruction`.
// Block-level marks (`#`, `-` / `1.`, `>`) get a hue of their own; inline
// punctuation keeps the parent tag and stays muted.
const headerMark = Tag.define(t.processingInstruction);
const listMark = Tag.define(t.processingInstruction);
const quoteMark = Tag.define(t.processingInstruction);
// Fenced and indented code text: the band already marks the block, so the
// inline-code wash must not stack on top of it.
const codeText = Tag.define(t.monospace);

/**
 * Parser extension the editor passes to `markdown({ extensions })`, giving
 * the block marks and code-block text their own highlight tags.
 */
export const noteMarkdownTags = {
  props: [
    styleTags({
      HeaderMark: headerMark,
      ListMark: listMark,
      QuoteMark: quoteMark,
      CodeText: codeText,
    }),
  ],
};

const markdownHighlight = (mode: 'light' | 'dark') => {
  const c = PALETTE[mode];
  return HighlightStyle.define([
    // Heading lines: hue and weight, not size, so the monospace grid holds.
    { tag: t.heading1, color: c.heading, fontWeight: '700' },
    { tag: [t.heading2, t.heading3], color: c.heading, fontWeight: '650' },
    {
      tag: [t.heading4, t.heading5, t.heading6],
      color: c.heading,
      fontWeight: '600',
    },
    { tag: headerMark, color: c.heading },
    { tag: t.strong, fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    // `-`, `*`, `1.` and the GFM `[ ]` / `[x]` task box (`TaskMarker`).
    { tag: [listMark, t.atom], color: c.mark },
    { tag: quoteMark, color: c.quote },
    { tag: t.quote, color: c.quote, fontStyle: 'italic' },
    // `**`, `` ` ``, `[`, `](` — inline punctuation recedes.
    { tag: t.processingInstruction, color: MUTED },
    { tag: [t.url, t.labelName], color: MUTED },
    { tag: t.link, color: LINK },
    { tag: codeText, color: FG },
    {
      tag: t.monospace,
      color: c.code,
      backgroundColor: WASH,
      borderRadius: '2px',
    },
    { tag: t.contentSeparator, color: MUTED },
    // HTML in markdown (`<details>`, comments) and embedded code tokens.
    { tag: [t.comment, t.meta], color: c.comment, fontStyle: 'italic' },
    { tag: [t.angleBracket, t.tagName, t.attributeName], color: c.tag },
  ]);
};

/**
 * The note editor's theme for `mode`: token-driven chrome + markdown styling.
 * `mode` sets CodeMirror's own `dark` flag and picks the markup palette; the
 * surfaces come from the host's tokens, which flip with its `.dark` class.
 * Outside the app the fallbacks are the light values.
 */
export function noteEditorTheme(mode: 'light' | 'dark'): Extension {
  return [
    chrome(mode === 'dark'),
    syntaxHighlighting(markdownHighlight(mode)),
    codeBlockBand,
  ];
}

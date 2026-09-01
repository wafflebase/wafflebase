/**
 * A note's picture for the template gallery
 * (docs/design/template-gallery.md).
 *
 * Every other document type is Canvas-rendered, so its thumbnail is a
 * photograph of the editor. Notes is the one DOM editor — CodeMirror 6 plus a
 * DOM markdown preview — and there is no canvas anywhere in
 * `packages/notes/src` to read pixels from. The usual DOM-to-canvas trick (an
 * SVG `foreignObject` drawn as an image) is a dead end here for the same
 * reason a remote image is: Chrome taints the canvas, so `toBlob` throws.
 *
 * So this **synthesizes** rather than captures: it draws the first lines of
 * the markdown onto a canvas directly, the way a repository card or a note
 * list does. That is a different kind of thing from the other thumbnails —
 * a description of the note rather than a picture of the editor — but it is
 * true to the content, never fails, and beats the one card in the gallery
 * with no image on it.
 */

/** Rendered at 2× and downscaled by the encoder, so text stays sharp. */
const WIDTH = 800;
const HEIGHT = 500;
const PADDING = 48;
const LINE_HEIGHT = 30;
/** Enough to fill the card; the rest of the note is not the thumbnail's job. */
const MAX_LINES = Math.floor((HEIGHT - PADDING * 2) / LINE_HEIGHT);
/** Truncation guard — a minified one-line file must not be measured whole. */
const MAX_CHARS_SCANNED = 20_000;

const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export interface NoteThumbnailTheme {
  background: string;
  heading: string;
  body: string;
}

export const NOTE_THUMBNAIL_THEMES: Record<'light' | 'dark', NoteThumbnailTheme> = {
  light: { background: '#ffffff', heading: '#111827', body: '#4b5563' },
  dark: { background: '#0b0f19', heading: '#f3f4f6', body: '#9ca3af' },
};

/**
 * The lines worth drawing: leading blanks dropped, fences and blank runs
 * skipped, each one tagged as a heading or not so the render can weight it.
 *
 * Exported for its own test — the drawing is untestable in jsdom, the
 * selection is the part with rules in it.
 */
export function outlineOf(markdown: string): Array<{
  text: string;
  heading: boolean;
}> {
  const out: Array<{ text: string; heading: boolean }> = [];
  let fenced = false;
  for (const raw of markdown.slice(0, MAX_CHARS_SCANNED).split('\n')) {
    if (out.length >= MAX_LINES) break;
    const line = raw.trim();
    if (line.startsWith('```')) {
      // Toggle rather than skip-to-end: an unterminated fence would otherwise
      // swallow the whole note and produce an empty thumbnail.
      fenced = !fenced;
      continue;
    }
    if (!line || fenced) continue;

    const heading = /^#{1,6}\s/.test(line);
    // Strip only the markers that would read as noise at thumbnail size. The
    // text stays otherwise verbatim — this is a preview, not a renderer.
    const text = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '• ')
      .replace(/^>\s+/, '')
      .replace(/[*_`]/g, '');
    if (text) out.push({ text, heading });
  }
  return out;
}

/**
 * Draw `markdown` as a note card. `null` when the note is empty — an empty
 * note has nothing to show, and a blank rectangle is worse than the
 * document-type icon it would replace.
 */
export function renderNoteThumbnail(
  markdown: string,
  theme: NoteThumbnailTheme,
): HTMLCanvasElement | null {
  const lines = outlineOf(markdown);
  if (lines.length === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textBaseline = 'top';

  let y = PADDING;
  for (const { text, heading } of lines) {
    ctx.font = heading ? `600 22px ${FONT_STACK}` : `16px ${FONT_STACK}`;
    ctx.fillStyle = heading ? theme.heading : theme.body;
    ctx.fillText(ellipsize(ctx, text, WIDTH - PADDING * 2), PADDING, y);
    y += LINE_HEIGHT;
  }
  return canvas;
}

/** Trim `text` to `maxWidth`, ending in an ellipsis when it had to cut. */
function ellipsize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

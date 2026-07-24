import type MarkdownIt from 'markdown-it';

// `markdown-it`'s `export =` shape means its `MarkdownIt.StateBlock` /
// `MarkdownIt.Token` namespace types aren't reachable through the default
// import (see the same note in `preview.ts`). Derive the types we need from
// the instance shape instead of naming the namespace.
type StateBlock = InstanceType<MarkdownIt['block']['State']>;
type RenderRule = NonNullable<MarkdownIt['renderer']['rules'][string]>;

/**
 * Collapsible sections (`<details>` / `<summary>`) for the notes preview.
 *
 * The preview runs markdown-it with `html: false` on purpose (raw HTML in a
 * collaborator's note is a stored-XSS vector — see the SECURITY note in
 * `preview.ts`). Rather than flip that safety off, this plugin allowlists ONLY
 * the two disclosure tags and turns them into a pair of custom block tokens.
 * Everything else — the summary label, the folded body — is still parsed and
 * rendered through the normal `html: false` pipeline, so no arbitrary HTML is
 * ever emitted. The only attributes we ever produce are a fixed class and the
 * boolean `open`.
 *
 * Supported source shapes (each tag on its own line, GitHub/MDN style):
 *
 *   <details>            or   <details open>
 *   <summary>label</summary>
 *
 *   any **markdown** here, including nested <details>
 *
 *   </details>
 *
 * The summary is optional and, when present, must sit on a single line. The
 * body between the tags is ordinary markdown (fences, lists, nested
 * disclosures all work for free because the normal block parser handles it).
 */

const DETAILS_OPEN_RE = /^<details(\s+open)?\s*>$/i;
const DETAILS_CLOSE_RE = /^<\/details>$/i;
const SUMMARY_RE = /^<summary>([\s\S]*)<\/summary>$/i;

// Per-parse nesting depth so a stray `</details>` with no matching open falls
// through to the paragraph rule and is escaped as literal text rather than
// emitting an orphan close tag. Keyed on the block state's env object, which
// is unique per `md.render()` call.
const depths = new WeakMap<object, number>();

function detailsRule(
  state: StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean,
): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const line = state.src.slice(start, max).trim();

  const openMatch = DETAILS_OPEN_RE.exec(line);
  if (openMatch) {
    if (silent) return true;
    const token = state.push('details_open', 'details', 1);
    token.attrs = openMatch[1] ? [['open', '']] : [];
    token.map = [startLine, startLine + 1];
    token.block = true;
    depths.set(state.env, (depths.get(state.env) ?? 0) + 1);
    state.line = startLine + 1;
    return true;
  }

  if (DETAILS_CLOSE_RE.test(line)) {
    // Only close when we are actually inside a disclosure.
    if ((depths.get(state.env) ?? 0) <= 0) return false;
    if (silent) return true;
    state.push('details_close', 'details', -1);
    depths.set(state.env, (depths.get(state.env) ?? 0) - 1);
    state.line = startLine + 1;
    return true;
  }

  const summaryMatch = SUMMARY_RE.exec(line);
  if (summaryMatch) {
    if (silent) return true;
    const open = state.push('summary_open', 'summary', 1);
    open.map = [startLine, startLine + 1];
    open.block = true;

    const inline = state.push('inline', '', 0);
    inline.content = summaryMatch[1].trim();
    inline.map = [startLine, startLine + 1];
    inline.children = [];

    state.push('summary_close', 'summary', -1);
    state.line = startLine + 1;
    return true;
  }

  return false;
}

/**
 * markdown-it plugin: registers the disclosure block rule (as a paragraph
 * terminator so a `</details>` right after a body line still closes the block)
 * plus the four render rules that emit the safe `<details>`/`<summary>` HTML.
 */
export function detailsPlugin(md: MarkdownIt): void {
  md.block.ruler.before('paragraph', 'details', detailsRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });

  const renderDetailsOpen: RenderRule = (tokens, idx) => {
    const hasOpen = (tokens[idx].attrs ?? []).some(([name]) => name === 'open');
    return `<details class="note-details"${hasOpen ? ' open' : ''}>\n`;
  };
  md.renderer.rules.details_open = renderDetailsOpen;
  md.renderer.rules.details_close = () => '</details>\n';
  md.renderer.rules.summary_open = () => '<summary class="note-summary">';
  md.renderer.rules.summary_close = () => '</summary>\n';
}

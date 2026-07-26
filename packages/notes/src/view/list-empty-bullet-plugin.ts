import type MarkdownIt from 'markdown-it';

// `markdown-it`'s `export =` shape means its `MarkdownIt.StateBlock` namespace
// type isn't reachable through the default import (same note as in
// `details-plugin.ts` / `preview.ts`). Derive it from the instance shape.
type StateBlock = InstanceType<MarkdownIt['block']['State']>;
type BlockRule = (
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
) => boolean;

const DASH = 0x2d; /* - */
const EQUALS = 0x3d; /* = */

// ASCII whitespace trimmed by markdown-it's own `asciiTrim` (space, \t, \n, \v,
// \f, \r). Re-created here so we don't reach into a private markdown-it export.
const ASCII_TRIM_RE =
  /^[\x09\x0a\x0b\x0c\x0d\x20]+|[\x09\x0a\x0b\x0c\x0d\x20]+$/g;
function asciiTrim(str: string): string {
  return str.replace(ASCII_TRIM_RE, '');
}

/**
 * Is the given line an *empty* bullet marker (`-`, `*`, `+` followed only by
 * whitespace) sitting at or beyond the current block indent? That is exactly the
 * shape CommonMark refuses to let interrupt a paragraph, and the shape whose `-`
 * variant `lheading` otherwise swallows as a setext underline.
 */
function isEmptyBulletLine(state: StateBlock, line: number): boolean {
  if (state.sCount[line] < state.blkIndent) return false;

  let pos = state.bMarks[line] + state.tShift[line];
  const max = state.eMarks[line];
  if (pos >= max) return false;

  const marker = state.src.charCodeAt(pos);
  if (marker !== DASH && marker !== 0x2a /* * */ && marker !== 0x2b /* + */) {
    return false;
  }
  pos += 1;

  // A bullet marker is a marker char followed by whitespace or end-of-line.
  if (pos < max && !isSpaceOrTab(state.src.charCodeAt(pos))) return false;

  // Empty item: nothing but whitespace after the marker.
  return state.skipSpaces(pos) >= max;
}

function isSpaceOrTab(code: number): boolean {
  return code === 0x20 || code === 0x09;
}

/**
 * A drop-in replacement for markdown-it's `lheading` (setext heading) rule that
 * declines to treat a **lone single `-`** as a setext underline. That single
 * dash is the shape of an empty bullet (`-` / `- `), so letting `lheading` claim
 * it is what turns
 *
 *   - 1
 *     -
 *
 * into `<li><h2>1</h2></li>` (issue #517). Multi-dash `---` underlines and `=`
 * underlines are untouched, so ordinary setext headings still work.
 *
 * Mirrors the upstream rule (markdown-it 14.x `rules_block/lheading.mjs`) with a
 * single added guard on the dash run length.
 */
const lheadingRule: BlockRule = (state, startLine, endLine) => {
  const terminatorRules = state.md.block.ruler.getRules('paragraph');

  // if it's indented more than 3 spaces, it should be a code block
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;

  const oldParentType = state.parentType;
  state.parentType = 'paragraph'; // use paragraph to match terminatorRules

  let level = 0;
  let marker = 0;
  let nextLine = startLine + 1;

  for (; nextLine < endLine && !state.isEmpty(nextLine); nextLine++) {
    // this would be a code block normally, but after paragraph it's considered
    // a lazy continuation regardless of what's there
    if (state.sCount[nextLine] - state.blkIndent > 3) continue;

    // Check for an underline in a setext header.
    if (state.sCount[nextLine] >= state.blkIndent) {
      let pos = state.bMarks[nextLine] + state.tShift[nextLine];
      const max = state.eMarks[nextLine];

      if (pos < max) {
        marker = state.src.charCodeAt(pos);

        if (marker === DASH || marker === EQUALS) {
          const markerStart = pos;
          pos = state.skipChars(pos, marker);
          const runLength = pos - markerStart;
          pos = state.skipSpaces(pos);

          // #517: a lone single `-` is an empty bullet, not a setext underline.
          // Fall through so the paragraph terminates here and the list rule can
          // start the (empty) nested item instead.
          const isLoneDash = marker === DASH && runLength === 1;

          if (pos >= max && !isLoneDash) {
            level = marker === EQUALS ? 1 : 2;
            break;
          }
        }
      }
    }

    // quirk for blockquotes, this line should already be checked by that rule
    if (state.sCount[nextLine] < 0) continue;

    // Some tags can terminate a paragraph without an empty line.
    let terminate = false;
    for (let i = 0, l = terminatorRules.length; i < l; i++) {
      if (terminatorRules[i](state, nextLine, endLine, true)) {
        terminate = true;
        break;
      }
    }
    if (terminate) break;
  }

  if (!level) {
    state.parentType = oldParentType;
    return false;
  }

  const content = asciiTrim(
    state.getLines(startLine, nextLine, state.blkIndent, false),
  );

  state.line = nextLine + 1;

  const tokenOpen = state.push('heading_open', 'h' + String(level), 1);
  tokenOpen.markup = String.fromCharCode(marker);
  tokenOpen.map = [startLine, state.line];

  const tokenInline = state.push('inline', '', 0);
  tokenInline.content = content;
  tokenInline.map = [startLine, state.line - 1];
  tokenInline.children = [];

  const tokenClose = state.push('heading_close', 'h' + String(level), -1);
  tokenClose.markup = String.fromCharCode(marker);

  state.parentType = oldParentType;

  return true;
};

/**
 * markdown-it plugin (notes preview only) that makes a **lone empty bullet**
 * render as a nested list item instead of accidentally styling the line above it
 * as a Header 2 (issue #517).
 *
 * Two upstream CommonMark guards conspire to produce the `<h2>`:
 *
 *  1. `lheading` treats the lone `-` as a setext heading underline for the
 *     paragraph above it — replaced above so a single dash no longer qualifies.
 *  2. `list` refuses to let an *empty* bullet interrupt a paragraph (it would
 *     otherwise become lazy `1<br>-` text) — relaxed below so, in
 *     paragraph-terminator (silent) mode, an empty bullet ends the paragraph and
 *     the normal non-silent list machinery then builds the empty nested item.
 *
 * This is a deliberate, notes-scoped deviation from CommonMark toward the more
 * intuitive editing behavior. See docs/design/notes/notes.md.
 */
export function listEmptyBulletPlugin(md: MarkdownIt): void {
  md.block.ruler.at('lheading', lheadingRule);

  // Grab the current `list` rule so we can delegate to it for every case other
  // than the empty-bullet-interrupts-a-paragraph one.
  const originalList = getRuleFn(md, 'list');

  const wrappedList: BlockRule = (state, startLine, endLine, silent) => {
    if (
      silent &&
      state.parentType === 'paragraph' &&
      isEmptyBulletLine(state, startLine)
    ) {
      // Signal that this empty bullet terminates the paragraph. The paragraph
      // rule stops here; the list rule then runs non-silently on this line,
      // where the empty-item guard does not apply, and builds the nested list.
      return true;
    }
    return originalList(state, startLine, endLine, silent);
  };

  // `Ruler.at` replaces the rule's `alt` chain, so restore `list`'s original
  // paragraph/reference/blockquote membership or it stops terminating them.
  md.block.ruler.at('list', wrappedList, {
    alt: ['paragraph', 'reference', 'blockquote'],
  });
}

/**
 * Read a block rule's current function by name. markdown-it's Ruler exposes no
 * public getter, so we read its private `__rules__` registry (each entry pairs a
 * rule `name` with its `fn`). Used to delegate to the stock `list` rule.
 */
function getRuleFn(md: MarkdownIt, name: string): BlockRule {
  const ruler = md.block.ruler as unknown as {
    __rules__: Array<{ name: string; fn: BlockRule; enabled: boolean }>;
  };
  const rule = ruler.__rules__.find((r) => r.name === name);
  if (!rule) throw new Error(`markdown-it block rule not found: ${name}`);
  return rule.fn;
}

/**
 * Reading and writing custom-property declarations in a stylesheet.
 *
 * THE ONE PRIMITIVE 8b HAD TO WRITE. Everything else in the token half already
 * existed: `inject.mjs` owns the TypeScript-AST side (`applyTokenValue`,
 * `insertConstMember`, the emitter-array edits) and — measured, not assumed — its
 * `@theme inline` helpers work verbatim on a plain shadcn stylesheet and round-trip
 * exactly. What no module could do was read or write a `:root` / `.dark` block, and
 * that is the whole substance of a CSS-variables token layer. See
 * `design-editor-local-plugin.md` §4: `cssVariables` is the one adapter with no
 * prototype behaviour to diff against, so its primitive is separated out here and
 * tested directly rather than only through the adapter.
 *
 * Deliberately NOT a CSS parser. It is a scanner that finds top-level rule blocks
 * and splits their declarations, which is what this job needs and no more. A real
 * parser would have to round-trip everything it read; this only ever splices the
 * exact span it was asked about, so every byte it does not understand is preserved
 * by construction — the same discipline the JSX injector uses.
 *
 * KNOWN LIMITS, stated rather than implied:
 *
 *   - **Top-level blocks only.** A `:root` nested inside `@media
 *     (prefers-color-scheme: dark)` is invisible here. Verified by probe: such a
 *     block is not returned and its declarations do not leak into `:root`'s. shadcn's
 *     own CLI generates a class-based `.dark`, which is what this targets; a
 *     media-query project reads as having no dark theme rather than as having a
 *     wrong one.
 *   - **No `@supports` / nesting awareness** for the same reason.
 *   - Custom properties only. A `color: red` in a `:root` block is skipped, because
 *     the editor has no vocabulary for a non-token declaration and rewriting one
 *     would be outside anything the user asked for.
 */

/** One custom-property declaration, with the exact offsets needed to splice it. */
export interface CssDecl {
  /** Including the leading `--`. */
  prop: string;
  /** Trimmed, excluding the `;`. */
  value: string;
  /**
   * The declaration's span: `start` is the PROPERTY's own offset, `end` is the `;` and
   * is therefore excluded — or, for a final declaration with no `;`, the block's closing
   * brace.
   *
   * `start` being the property matters to every caller. The scanner tracks a pending
   * declaration from just after the previous `;`, which means leading whitespace and any
   * comment between the two are inside that pending span; both are stripped before this
   * is recorded. A caller that walks back from `start` to a line start is therefore
   * walking over indentation, not over the previous declaration.
   */
  start: number;
  end: number;
  /** The value's own span — what a value edit splices, leaving the rest untouched. */
  valueStart: number;
  valueEnd: number;
}

/** A top-level `selector { … }` rule. */
export interface CssBlock {
  /** Raw selector text, comments included — use `selectorList` for matching. */
  selector: string;
  /** Offset of the `{`. */
  open: number;
  /** Offset of the matching `}`. */
  close: number;
}

export interface CssEditResult {
  located: boolean;
  text: string;
  reason?: string;
}

/**
 * Advance past a comment or a quoted string starting at `i`, or return `i`.
 *
 * Shared by both scanners because both have to be blind to the same things: a `{`,
 * `}` or `;` inside `/* … *\/` or inside `"…"` is content, not structure. The
 * adversarial fixture (`--quoted: "semi; colon { brace }"`) is in the test suite
 * precisely because a scanner that misses this splits a declaration in half.
 */
function skipInert(text: string, i: number): number {
  const c = text[i];
  if (c === '/' && text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return end < 0 ? text.length : end + 2;
  }
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < text.length && text[j] !== c) {
      // A backslash escapes the next character, including the closing quote.
      if (text[j] === '\\') j++;
      j++;
    }
    return j + 1;
  }
  return i;
}

/**
 * Every top-level rule block, in document order.
 *
 * At-rules with bodies (`@theme inline { … }`, `@layer base { … }`) come back too,
 * with their `@…` as the selector text. That is intentional: they are top-level
 * blocks, `selectorList` will simply never match them, and filtering them here would
 * mean this function's result depended on a list of at-rule names to exclude.
 */
export function topLevelBlocks(css: string): CssBlock[] {
  const out: CssBlock[] = [];
  let depth = 0;
  let selStart = 0;
  let open = 0;
  let i = 0;

  while (i < css.length) {
    const skipped = skipInert(css, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const c = css[i];
    if (c === '{') {
      if (depth === 0) open = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        out.push({ selector: css.slice(selStart, open), open, close: i });
        selStart = i + 1;
      }
    } else if (c === ';' && depth === 0) {
      // A bodyless top-level statement (`@import "x";`). The next selector starts
      // after it — without this the whole `@import` block would be glued onto the
      // first real selector, which is how a stylesheet's leading imports would stop
      // `:root` from ever matching.
      selStart = i + 1;
    }
    i++;
  }
  return out;
}

/**
 * A block's selectors, as a list ready for exact matching.
 *
 * Comments are stripped FIRST, and that is not tidying: every generated stylesheet
 * opens with a banner (`/* AUTOGENERATED … *\/`), which the scanner hands back as part
 * of the first block's selector text. Without stripping, `:root` failed to match in
 * `packages/core/dist/tokens.css` — the single most representative fixture there is.
 * Found by probe before this function existed.
 */
export function selectorList(selector: string): string[] {
  return selector
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Exact membership, never a prefix test.
 *
 * `.dark .note-preview` must NOT match `.dark` — it is a descendant rule that
 * happens to start with the same characters, and wafflebase's own `index.css`
 * contains exactly that. A `startsWith` here would have the editor treat a
 * markdown-preview rule as the dark theme's token block.
 */
const matchesSelector = (block: CssBlock, want: string): boolean =>
  selectorList(block.selector).includes(want);

/**
 * Offset just past the last real content in a value — comments and trailing whitespace
 * excluded.
 *
 * Quote-aware, and it tracks the last content position rather than cutting at the first
 * comment: CSS treats a comment as whitespace, so `1px /* a *\/ solid` is a two-part
 * value whose content ends after `solid`, while `1px /* note *\/` ends after `1px`.
 */
function contentEnd(value: string): number {
  let i = 0;
  let end = 0;
  while (i < value.length) {
    const c = value[i];
    if (c === '/' && value[i + 1] === '*') {
      const close = value.indexOf('*/', i + 2);
      i = close < 0 ? value.length : close + 2;
      continue;
    }
    const skipped = skipInert(value, i);
    if (skipped !== i) {
      // A quoted string is content, however much whitespace it holds.
      end = Math.min(skipped, value.length);
      i = skipped;
      continue;
    }
    if (!/\s/.test(c)) end = i + 1;
    i++;
  }
  return end;
}

/**
 * Is this safe to write as a declaration value?
 *
 * A token value reaches here from a web page, and `setDecl` / `insertDecl` splice it in
 * verbatim — so a value containing a bare `;` or `}` does not produce a wrong colour, it
 * produces a structurally different stylesheet (measured: `red; } body { display: none }`
 * was written out intact). The check lives with the CSS writer rather than in the wire
 * layer because it is a property of this storage format: an adapter writing TypeScript
 * needs string escaping instead, which `inject.mjs#quoteLiteral` already does.
 *
 * Depth- and quote-aware, because the delimiters are legitimate inside a function or a
 * string — `url("data:image/svg+xml;base64,…")` carries a semicolon and must pass.
 * Returns `true`, or the reason it was refused.
 */
export function isSafeDeclarationValue(value: string): true | string {
  let depth = 0;
  let i = 0;
  while (i < value.length) {
    const c = value[i];
    if (c === '/' && value[i + 1] === '*') {
      const close = value.indexOf('*/', i + 2);
      // An unterminated comment would swallow every rule that follows it in the file.
      if (close < 0) return 'unterminated comment';
      i = close + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < value.length && value[j] !== c) {
        if (value[j] === '\\') j++;
        j++;
      }
      if (j >= value.length) return 'unterminated string';
      i = j + 1;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth < 0) return 'unbalanced parentheses';
    } else if (depth === 0 && (c === ';' || c === '{' || c === '}')) {
      return `\`${c}\` would end the declaration`;
    }
    i++;
  }
  return depth === 0 ? true : 'unbalanced parentheses';
}

/** Split one block's body into its custom-property declarations. */
function splitDecls(css: string, bodyStart: number, bodyEnd: number): CssDecl[] {
  const out: CssDecl[] = [];
  let start = bodyStart;
  let paren = 0;
  let i = bodyStart;

  const flush = (end: number) => {
    // Captured before `start` advances, so every offset below is derived from the
    // declaration's own beginning rather than from the next one's.
    const pendingStart = start;
    start = end + 1;

    // Skip leading whitespace and comments before parsing.
    //
    // A pending declaration begins right after the previous `;`, so any grouping comment
    // between the two — `/* Brand */`, which is entirely ordinary in a hand-authored
    // stylesheet — lands inside this span. Without stripping it, the comment becomes part
    // of the property name, `prop` no longer starts with `--`, and the declaration is
    // DROPPED: invisible to the editor, and unwritable. Measured, not theorised — a
    // fixture with one grouping comment reported one token where there were two.
    let declStart = pendingStart;
    for (;;) {
      while (declStart < end && /\s/.test(css[declStart])) declStart++;
      if (css.startsWith('/*', declStart)) {
        const close = css.indexOf('*/', declStart + 2);
        if (close < 0 || close >= end) {
          declStart = end;
          break;
        }
        declStart = close + 2;
        continue;
      }
      break;
    }

    const raw = css.slice(declStart, end);
    // The FIRST colon at paren depth 0. Depth matters: `color-mix(in oklab, …)`
    // contains no colon, but `url(data:…)` and `image-set(… type: …)` do, and a
    // naive `indexOf(':')` on the value side would re-split the declaration.
    let depth = 0;
    let colon = -1;
    for (let k = 0; k < raw.length; k++) {
      const ch = raw[k];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ':' && depth === 0) {
        colon = k;
        break;
      }
    }
    if (colon < 0) return;
    const prop = raw.slice(0, colon).trim();
    if (!prop.startsWith('--')) return;

    const rawValue = raw.slice(colon + 1);
    const lead = rawValue.length - rawValue.trimStart().length;
    const valueStart = declStart + colon + 1 + lead;
    // The value span stops at its last real content, so a TRAILING comment is outside
    // it: `--a: 1px /* note */;` has the value `1px`. Without this the comment is part
    // of the value the editor displays, and `setDecl` — which splices the span — would
    // delete the author's comment as a side effect of changing a colour.
    const valueEnd = valueStart + contentEnd(rawValue.slice(lead));
    out.push({
      prop,
      value: css.slice(valueStart, valueEnd),
      start: declStart,
      end,
      valueStart,
      valueEnd,
    });
  };

  while (i < bodyEnd) {
    const skipped = skipInert(css, i);
    if (skipped !== i) {
      i = Math.min(skipped, bodyEnd);
      continue;
    }
    const c = css[i];
    if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === ';' && paren === 0) {
      flush(i);
      i++;
      continue;
    }
    i++;
  }
  // The last declaration in a block may sit against the closing brace with no
  // trailing `;`. `removeThemeMapping` in `inject.mjs` carries the same note for the
  // same reason; a scanner that requires the semicolon silently drops that token.
  if (start < bodyEnd && css.slice(start, bodyEnd).trim()) flush(bodyEnd);
  return out;
}

/**
 * Every declaration under `selector`, across every matching top-level block, in
 * document order.
 *
 * Duplicates are RETURNED, not merged, because the two callers want different
 * things: a read wants the winner (`declMap` folds last-wins, which is the cascade),
 * and a write wants the exact span of the one that is winning. Merging here would
 * make the second impossible.
 */
export function readDecls(css: string, selector: string): CssDecl[] {
  const out: CssDecl[] = [];
  for (const b of topLevelBlocks(css)) {
    if (!matchesSelector(b, selector)) continue;
    out.push(...splitDecls(css, b.open + 1, b.close));
  }
  return out;
}

/**
 * Fold declarations to the value the browser actually uses.
 *
 * Last-wins, because that is the cascade for two declarations of the same property
 * in the same origin. Reading first-wins would show the editor a value the page is
 * not displaying.
 */
export function declMap(decls: CssDecl[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of decls) out[d.prop] = d.value;
  return out;
}

/**
 * Replace a declared property's value in place.
 *
 * Targets the LAST declaration of that property, which is the one in effect. Writing
 * the first would leave a later duplicate overriding it — the write lands in the
 * file, the diff looks right, and the page does not change. Probed on
 * `:root{--a:1px} :root{--a:5px}` before this was written.
 */
export function setDecl(css: string, selector: string, prop: string, value: string): CssEditResult {
  const matches = readDecls(css, selector).filter((d) => d.prop === prop);
  const target = matches[matches.length - 1];
  if (!target) {
    return { located: false, text: css, reason: `${prop} is not declared in ${selector}` };
  }
  return {
    located: true,
    text: css.slice(0, target.valueStart) + value + css.slice(target.valueEnd),
  };
}

/**
 * Add a property to the last block matching `selector`.
 *
 * The LAST block again, and for the same cascade reason: appending to an earlier
 * duplicate would be overridden by the later one.
 */
export function insertDecl(
  css: string,
  selector: string,
  prop: string,
  value: string,
): CssEditResult {
  const blocks = topLevelBlocks(css).filter((b) => matchesSelector(b, selector));
  const block = blocks[blocks.length - 1];
  if (!block) return { located: false, text: css, reason: `no ${selector} block found` };

  // Checked across EVERY matching block, not just the one being written to — the same
  // set `readDecls`, `setDecl` and `removeDecl` work over. Inspecting only the target
  // block let `insertDecl` add a property already declared in an earlier duplicate
  // block, so the file ended up declaring it twice.
  const all = readDecls(css, selector);
  if (all.some((d) => d.prop === prop)) {
    return { located: false, text: css, reason: `${prop} is already declared in ${selector}` };
  }
  // The target block's own declarations, reusing the scan above rather than a second one.
  const decls = all.filter((d) => d.start > block.open && d.end <= block.close);

  const nl = css.includes('\r\n') ? '\r\n' : '\n';
  // Match the indentation of the block's own declarations rather than assuming two
  // spaces, so the write does not reformat a project that indents differently.
  // Measured from the text BEFORE the last declaration, by walking back to its line
  // start — `start` points at the property itself, so the indent is not inside the span.
  // Anything other than whitespace on that line means the declaration does not begin the
  // line, and a default is safer than copying a fragment of code as indentation.
  const last = decls[decls.length - 1];
  let indent = '  ';
  if (last) {
    let ls = last.start;
    while (ls > 0 && css[ls - 1] !== '\n') ls--;
    const prefix = css.slice(ls, last.start);
    if (/^[ \t]*$/.test(prefix)) indent = prefix;
  }

  // Insert at the start of the closing brace's line, so the new declaration becomes
  // the block's last and the brace itself does not move.
  let ls = block.close;
  while (ls > 0 && css[ls - 1] !== '\n') ls--;

  // ONE-LINE BLOCK. The walk-back found no newline inside the block, so "the start of
  // the brace's line" is at or before the `{` — and splicing there put the declaration
  // in FRONT of the selector, producing `  --b: 2px;\n:root { --a: 1px; }`: broken CSS
  // that `readDecls` could not see and `removeDecl` could not undo. Insert just inside
  // the brace instead, keeping the block on its one line.
  if (ls <= block.open) {
    const pad = /\s/.test(css[block.close - 1] ?? '') ? '' : ' ';
    return {
      located: true,
      text: `${css.slice(0, block.close)}${pad}${prop}: ${value}; ${css.slice(block.close)}`,
    };
  }

  return {
    located: true,
    text: `${css.slice(0, ls)}${indent}${prop}: ${value};${nl}${css.slice(ls)}`,
  };
}

/**
 * Delete a declaration, including its whole line.
 *
 * Every occurrence, not just the last: a remove that left an earlier duplicate
 * behind would look like it had failed, because the property would still resolve.
 * Applied back-to-front so each splice cannot move the offsets of the ones not yet
 * applied.
 */
export function removeDecl(css: string, selector: string, prop: string): CssEditResult {
  const matches = readDecls(css, selector).filter((d) => d.prop === prop);
  if (!matches.length) {
    return { located: false, text: css, reason: `${prop} is not declared in ${selector}` };
  }
  let text = css;
  for (const d of [...matches].reverse()) {
    // `start` is the PROPERTY's offset, which is what makes this walk-back safe. It was
    // not always: while the span began right after the previous `;`, walking back from it
    // to find a line start walked through the whole PREVIOUS declaration and deleted that
    // too (measured: removing `--primary` also removed `--background`). Anything on the
    // line before the property — a comment, another declaration — is deliberately left
    // where it is.
    let from = d.start;
    while (from > 0 && text[from - 1] !== '\n') from--;
    // Only whitespace may be absorbed. On a one-line block the walk-back reaches
    // `:root { ` and would take the selector and brace with it, leaving unparseable CSS;
    // a same-line comment or a preceding declaration is likewise the author's.
    const ownsLine = /^[ \t]*$/.test(text.slice(from, d.start));
    if (!ownsLine) from = d.start;

    // `d.end` is the `;` when there is one. A final declaration without one ends at the
    // block's closing brace instead, so stepping past `d.end` unconditionally would
    // consume the `}` and destroy the block.
    let to = d.end + (text[d.end] === ';' ? 1 : 0);
    // Take the trailing newline only when the declaration OWNED its line — then removing
    // it leaves no blank line behind. When it shared the line, keeping the newline is what
    // stops the closing brace being pulled up onto the neighbour it shared with.
    if (ownsLine) {
      let j = to;
      while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
      if (text[j] === '\r') j++;
      if (text[j] === '\n') to = j + 1;
    } else if (text[to] === ' ' || text[to] === '\t') {
      // Shared line: take the ONE separator that followed it, so `{ --a: 1px; --b: 2px; }`
      // does not collapse to a double space. Exactly one, so the neighbour's own spacing is
      // left as the author wrote it.
      to += 1;
    }

    text = text.slice(0, from) + text.slice(to);
  }
  return { located: true, text };
}

// @ts-check
/**
 * inject.mjs — AST-guided source mutation.
 *
 * Every edit is "locate an exact node with the TypeScript compiler API, replace
 * only its text span, write the result back". Because edits are anchored on a
 * specific node — never a text search — no unrelated occurrence in the file is
 * ever touched. Runs in Node inside the consumer's Vite dev middleware.
 *
 * THE FIRST MODULE HERE THAT WRITES. `jsx-nodes.mjs`, `extract.mjs` and
 * `stamp.mjs` only read; a mistake in them shows the designer something wrong.
 * A mistake here corrupts a file in someone's working tree. That asymmetry is
 * why every op returns `{located, text}` rather than throwing, why nothing is
 * written unless at least one operation applied, and why `renderAttribute`
 * refuses any value it cannot prove is inert.
 *
 * THIS FILE LANDS IN TWO PARTS.
 *
 *   - LAYOUT MUTATION (below) — arbitrary JSX nodes in a scene file, addressed
 *     by `NodeAnchor`. The half that consumes `jsx-nodes.mjs`.
 *   - TOKEN MUTATION (banner further down) — CVA class rewrites, token values,
 *     semantic-token creation, `@theme inline` aliases. Addressed by names that
 *     exist in the source (`cvaName`, `constName`), so it never touches the node
 *     model. Lands in the following PR.
 *
 * The shared helpers sit above both, because both need them: a `layout-props`
 * class edit and a `class-rewrite` are the same user-visible operation, and two
 * definitions of class-token semantics would drift into behaving differently.
 */
import {
  childrenOf,
  classLiteralOf,
  findJsxRoots,
  parse,
  resolveNode,
  ts,
} from './jsx-nodes.mjs';

/**
 * @typedef {import('./jsx-nodes.mjs').JsxRootNode} JsxRootNode
 * @typedef {import('./jsx-nodes.mjs').Scope} Scope
 */

/**
 * How a caller addresses one JSX node. The `path` is a HINT and the `fp` is the
 * TRUTH — see `resolveNode`, which owns the resolution order.
 *
 * @typedef {{component: string, path: number[], tag: string, fp: string,
 *            fpx?: string}} NodeAnchor
 */

/**
 * Every op's result. `located: false` means nothing was written and `text` is
 * the input unchanged — callers can apply the result unconditionally.
 *
 * @typedef {{located: boolean, text: string, reason?: string}} InjectResult
 */

// ---------------------------------------------------------------------------
// Shared helpers — used by BOTH halves.
// ---------------------------------------------------------------------------

/**
 * Splice `replacement` into `text` over the `[start, end)` character span.
 *
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {string} replacement
 */
function spliceSpan(text, start, end, replacement) {
  return text.slice(0, start) + replacement + text.slice(end);
}

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A bare JS identifier — the only shape safe to concatenate into a binding
 * position (an import specifier, a default binding).
 *
 * @param {string} s
 */
const isIdent = (s) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s);

/**
 * Does this source text parse cleanly?
 *
 * `parseDiagnostics` is internal to the compiler's `SourceFile`, so it is read
 * through a cast rather than the public type. There is no public API that
 * reports syntax errors for a file parsed without a `Program`, and building one
 * would mean a filesystem-backed compilation for what is a local question.
 *
 * @param {ts.SourceFile} sf
 */
const parsesCleanly = (sf) =>
  (/** @type {{parseDiagnostics?: readonly unknown[]}} */ (/** @type {unknown} */ (sf))
    .parseDiagnostics ?? []
  ).length === 0;

/**
 * Token-boundary matcher: whitespace or the literal's own quote on both sides.
 *
 * The lookbehind/lookahead is what keeps `bg-primary` from matching inside
 * `bg-primary-foreground`. A plain substring replace here would silently
 * corrupt a neighbouring class on every rewrite.
 *
 * @param {string} token
 * @param {string} [flags]
 */
const tokenRe = (token, flags = '') =>
  new RegExp(`(?<=[\\s"'\`])${escapeRe(token)}(?=[\\s"'\`])`, flags);

/**
 * Is `token` safe to splice into a class literal delimited by `quote`?
 *
 * The alphabet comes from the SPLICE CONTEXT, and the context is **not one
 * context**. `classLiteralOf` returns a `StringLiteral` OR a
 * `NoSubstitutionTemplateLiteral`, and those two have different escapes:
 *
 *   - `"…"` / `'…'` — every other character is inert. Checked against the
 *     parser rather than assumed: `className="a{b}c"` parses with zero errors
 *     as a StringLiteral whose `.text` is `a{b}c`. Only the quote escapes.
 *   - `` `…` `` — `${` opens a SUBSTITUTION. A token of `${alert(1)}` turns the
 *     literal into a live `TemplateExpression` at zero parse errors, which the
 *     dev server then executes.
 *
 * An earlier version of this took the alphabet from the double-quoted case and
 * applied it everywhere, which left the template-literal path wide open. Hence
 * `quote`: it is required, not optional, so a caller cannot reintroduce the
 * same hole by forgetting which delimiter it is splicing into.
 *
 * Always rejected:
 *
 *   - `"` — closes the literal. `x" onMouseOver={fetch(...)} y="` then parses as
 *     a REAL event handler (verified: 0 parse errors, `kind=JsxExpression`).
 *     This module writes to disk and the dev server executes what lands there,
 *     so that is code execution, not cosmetic corruption. It is the same hole
 *     `renderAttribute` already refuses; the class path simply bypassed it.
 *   - `'` and a backtick — `tokenRe`'s boundary class. A token carrying one
 *     matches at boundaries the caller never meant.
 *   - whitespace — one "token" holding several smuggles the extras past every
 *     per-token check, this one included.
 *   - `\` — never legitimate here, and the escape lead-in for anything that
 *     re-quotes this text downstream.
 *
 * Rejected only inside a template literal:
 *
 *   - `$` — the substitution lead-in. Rejecting the whole character rather than
 *     the `${` pair costs nothing real (no Tailwind class contains `$`) and
 *     leaves no adjacency to reason about.
 *
 * Everything else is ALLOWED, deliberately. `[&>svg]:size-4`,
 * `[&:not(:first-child)]:border-t` and `[&::-webkit-scrollbar]:hidden` are real
 * classes in this repo. A rule that also rejected `<`, `>` or braces would be
 * safe and useless: it would block the commonest shadcn utilities while leaving
 * the actual holes — the quote and the substitution — open.
 *
 * @param {string} token
 * @param {string} quote  The literal's delimiter: `"`, `'` or a backtick.
 */
const isSafeClassToken = (token, quote) =>
  token.length > 0 &&
  !/["'`\\\s]/.test(token) &&
  !(quote === '`' && token.includes('$'));

/**
 * Delete one class token from a quoted class literal, collapsing exactly one
 * adjacent space so the result never grows a double space or a space just
 * inside the quotes. Returns null when the token isn't present.
 *
 * @param {string} text
 * @param {string} token
 * @returns {string | null}
 */
function removeClassToken(text, token) {
  const m = tokenRe(token).exec(text);
  if (!m) return null;
  let start = m.index;
  let end = start + token.length;
  if (/\s/.test(text[end])) end++;
  else if (/\s/.test(text[start - 1])) start--;
  return text.slice(0, start) + text.slice(end);
}

/**
 * Append one class token just inside the literal's closing quote. Returns null
 * when the token is already present, which is what makes staging idempotent.
 *
 * @param {string} text
 * @param {string} token
 * @returns {string | null}
 */
function addClassToken(text, token) {
  if (tokenRe(token).test(text)) return null;
  const q = text[text.length - 1];
  const body = text.slice(0, -1);
  const sep = body.length === 1 || /\s$/.test(body) ? '' : ' ';
  return `${body}${sep}${token}${q}`;
}

/**
 * Apply the three class-token operations to ONE quoted class literal's text
 * (quotes included).
 *
 * Shared deliberately: the layout path (`applyLayoutProps`) and the CVA path
 * (`applyClassRewrite`, next PR) are the same user-visible operation, and two
 * definitions of class-token semantics would drift into behaving differently
 * for no defensible reason.
 *
 * `applied` counts operations that changed something; `missing` names the ones
 * that found nothing to act on, so a caller can report a partial result rather
 * than claiming success. `rejected` names the ones refused by
 * `isSafeClassToken` — kept separate from `missing` because "you may not write
 * that" and "that class is not here" are different answers for the UI.
 *
 * EVERY class token is validated here, on the way in. This is the chokepoint
 * both halves share, so one guard covers the layout path and the CVA path; a
 * check at each call site is the arrangement that already failed once, in the
 * re-keying hazard `test/server/name-keyed-maps.test.mjs` exists to prevent.
 *
 * @param {string} original  The literal's source text, quotes included.
 * @param {{replacements?: {from: string, to: string}[], additions?: string[],
 *          removals?: string[]}} ops
 * @returns {{applied: number, text: string, missing: string[], rejected: string[]}}
 */
function rewriteClassLiteral(original, { replacements = [], additions = [], removals = [] }) {
  let updated = original;
  let applied = 0;
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const rejected = [];
  // The delimiter decides the alphabet, and it is read from the literal being
  // spliced rather than assumed — `classLiteralOf` returns backtick literals too,
  // where `${` opens a substitution.
  const quote = original[0];
  /** Record and refuse an unsafe token. @param {string} t */
  const safe = (t) => {
    if (isSafeClassToken(t, quote)) return true;
    rejected.push(t);
    return false;
  };
  for (const { from, to } of replacements) {
    // `from` is only ever a search pattern and `to` is the only one spliced,
    // but both are checked: a `from` carrying whitespace builds a matcher that
    // spans two tokens and deletes a neighbour the caller never named.
    if (!safe(from) || !safe(to)) continue;
    if (!tokenRe(from).test(updated)) {
      missing.push(from);
      continue;
    }
    // The replacement is a FUNCTION, not a string: `String.prototype.replace`
    // reads `$&`, `` $` ``, `$'` and `$1` out of a string replacement, so a
    // `to` of `$&-$&` silently produced `text-sm-text-sm`. A function replacer
    // has no substitution grammar, so `to` lands verbatim.
    updated = updated.replace(tokenRe(from, 'g'), () => to);
    applied++;
  }
  for (const token of removals) {
    if (!safe(token)) continue;
    let next = removeClassToken(updated, token);
    if (next === null) {
      missing.push(token);
      continue;
    }
    // A token can appear more than once (rare); strip every occurrence.
    while (next !== null) {
      updated = next;
      next = removeClassToken(updated, token);
    }
    applied++;
  }
  for (const token of additions) {
    if (!safe(token)) continue;
    const next = addClassToken(updated, token);
    if (next === null) {
      missing.push(token);
      continue;
    }
    updated = next;
    applied++;
  }
  return { applied, text: updated, missing, rejected };
}

/**
 * Leading-whitespace indent of the line `node` starts on.
 *
 * @param {ts.SourceFile} sf
 * @param {ts.Node} node
 */
function indentOf(sf, node) {
  const full = sf.getFullText();
  const start = node.getStart(sf);
  let ls = start;
  while (ls > 0 && full[ls - 1] !== '\n') ls--;
  const m = /^[ \t]*/.exec(full.slice(ls, start));
  return m ? m[0] : '  ';
}

/**
 * Remove a node together with its own line: back to the start of its first line
 * (whitespace only) and forward past its trailing comma and newline. Offsets
 * come from `sf`, so callers must splice HIGHEST-offset-first.
 *
 * @param {string} fileText
 * @param {ts.SourceFile} sf
 * @param {ts.Node} node
 */
function removeNodeLine(fileText, sf, node) {
  const full = sf.getFullText();
  const nodeStart = node.getStart(sf);
  const nodeEnd = node.getEnd();

  // A trailing separator belongs to this member.
  let afterSep = nodeEnd;
  while (afterSep < full.length && /[,;]/.test(full[afterSep])) afterSep++;

  // Look past horizontal space for a line break.
  let probe = afterSep;
  while (probe < full.length && /[ \t\r]/.test(full[probe])) probe++;

  if (full[probe] === '\n') {
    // Own line: take the leading indent and the break with it.
    let start = nodeStart;
    while (start > 0 && full[start - 1] !== '\n' && /[ \t]/.test(full[start - 1])) start--;
    return spliceSpan(fileText, start, probe + 1, '');
  }

  // Shares its line — `{ bg: string; accent: string }`. Reaching back to the
  // start of the line would delete whatever preceded it, and eating the trailing
  // space would close up the gap before the bracket. Take the member plus the
  // separator it OWNS: a trailing one if it has one, otherwise a preceding comma
  // (which joins two members) but never a semicolon (which terminates the
  // previous one).
  let start = nodeStart;
  if (afterSep === nodeEnd) {
    while (start > 0 && /[ \t]/.test(full[start - 1])) start--;
    if (full[start - 1] === ',') start--;
  }
  return spliceSpan(fileText, start, afterSep, '');
}

// ---------------------------------------------------------------------------
// TOKEN MUTATION — the token pipeline, addressed by names that exist in source.
//
// Every op here is located by a name the author wrote (`cvaName`, `constName`, a
// CSS custom property) rather than by a `NodeAnchor`, so this half never touches
// the child-numbering model. That is the seam the two-PR split follows: this is
// reviewable against the token-file contract alone.
//
// It reuses `rewriteClassLiteral`, `removeNodeLine`, `indentOf` and `tokenRe`
// from the shared section above, which is why those do not travel with it.
// ---------------------------------------------------------------------------

/**
 * Find `const <cvaName> = cva(...)` and return the CallExpression.
 *
 * @param {ts.SourceFile} sf
 * @param {string} cvaName
 * @returns {ts.CallExpression | null}
 */
function findCvaCall(sf, cvaName) {
  /** @type {ts.CallExpression | null} */
  let found = null;
  /** @param {ts.Node} n */
  const visit = (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      n.name.getText(sf) === cvaName &&
      n.initializer &&
      ts.isCallExpression(n.initializer) &&
      n.initializer.expression.getText(sf) === 'cva'
    ) {
      found = n.initializer;
    }
    if (!found) ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/**
 * Navigate an object literal by property name, returning the initializer node.
 *
 * @param {ts.Node | null | undefined} objExpr
 * @param {string} key
 * @returns {ts.Expression | null}
 */
function getProp(objExpr, key) {
  if (!objExpr || !ts.isObjectLiteralExpression(objExpr)) return null;
  for (const p of objExpr.properties) {
    if (
      ts.isPropertyAssignment(p) &&
      p.name &&
      p.name.getText().replace(/^["']|["']$/g, '') === key
    ) {
      return p.initializer;
    }
  }
  return null;
}

/**
 * The PropertyAssignment node for `key` (not its initializer) — what a REMOVE
 * needs, since deleting the initializer alone would leave a dangling `key:`.
 *
 * @param {ts.Node | null | undefined} objExpr
 * @param {string} key
 * @returns {ts.PropertyAssignment | null}
 */
function findPropAssignment(objExpr, key) {
  if (!objExpr || !ts.isObjectLiteralExpression(objExpr)) return null;
  for (const p of objExpr.properties) {
    if (
      ts.isPropertyAssignment(p) &&
      p.name &&
      p.name.getText().replace(/^["']|["']$/g, '') === key
    ) {
      return p;
    }
  }
  return null;
}

/**
 * Locate the string-literal node holding a CVA value's classes.
 * `value === '__base__'` targets the base (first) argument.
 *
 * @param {ts.SourceFile} sf
 * @param {string} cvaName
 * @param {string} axis
 * @param {string} value
 * @returns {ts.Expression | null}
 */
function findClassLiteral(sf, cvaName, axis, value) {
  const call = findCvaCall(sf, cvaName);
  if (!call) return null;
  if (value === '__base__') return call.arguments[0] ?? null;

  const config = call.arguments[1];
  const variants = getProp(config, 'variants');
  const axisObj = getProp(variants, axis);
  return getProp(axisObj, value);
}

/**
 * Rewrite the class tokens inside ONE CVA value literal.
 *
 * Shares `rewriteClassLiteral` with `applyLayoutProps`: they are the same
 * user-visible operation reached from two panels, and two definitions of
 * class-token semantics would drift into behaving differently.
 *
 * @param {string} fileText
 * @param {{cvaName: string, axis?: string, value: string,
 *          replacements?: {from: string, to: string}[], additions?: string[],
 *          removals?: string[]}} intent
 * @returns {InjectResult}
 */
export function applyClassRewrite(fileText, intent) {
  const { cvaName, axis, value } = intent;
  const sf = parse(fileText);
  const node = findClassLiteral(sf, cvaName, axis ?? '', value);
  if (!node) {
    return {
      located: false,
      text: fileText,
      reason: `could not locate ${cvaName}.${axis}.${value}`,
    };
  }

  // The NODE KIND, not the last character. A `TemplateExpression` also ends in a
  // backtick, so the character test called `` `base ${cn('p-2')} end` `` a plain
  // literal and let class ops run over it — removing `p-2` rewrote the inside of
  // the substitution to `cn('')`, editing the author's expression. That is the
  // harm `classLiteralOf`'s joiner allowlist exists to prevent, reached through
  // the CVA door instead of the className one.
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) {
    return {
      located: false,
      text: fileText,
      reason: `${cvaName}.${value} is not a plain string literal`,
    };
  }
  const original = node.getText(sf); // includes surrounding quotes

  const { applied, text: updated, missing, rejected } = rewriteClassLiteral(original, intent);
  // The guard lives in `rewriteClassLiteral`, so this path is already SAFE — an
  // unsafe token never reaches the splice. Surfacing `rejected` is about the
  // ANSWER: without it a refused token reported `no matching classes: ` with an
  // empty list, which reads as "that class was not there" instead of "you may
  // not write that", and the designer retries the same edit forever.
  if (rejected.length) {
    return {
      located: false,
      text: fileText,
      reason: `rejected unsafe class tokens: ${rejected.join(', ')}`,
    };
  }
  if (applied === 0) {
    return { located: false, text: fileText, reason: `no matching classes: ${missing.join(', ')}` };
  }
  return { located: true, text: spliceSpan(fileText, node.getStart(sf), node.getEnd(), updated) };
}

/**
 * Find `const <name> = <objectLiteral>` and return the object literal.
 *
 * @param {ts.SourceFile} sf
 * @param {string} name
 * @returns {ts.ObjectLiteralExpression | null}
 */
function findConstObject(sf, name) {
  /** @type {ts.ObjectLiteralExpression | null} */
  let found = null;
  /** @param {ts.Node} n */
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === name && n.initializer) {
      let init = n.initializer;
      // `const light: SemanticColorMap = {…}` — unwrap the assertion forms too.
      if (ts.isAsExpression(init) || ts.isTypeAssertionExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) found = init;
    }
    if (!found) ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/**
 * Quote a value as a single-quoted TS string literal.
 *
 * Control characters are escaped, not just the backslash and the quote. A
 * single-quoted TS literal cannot span lines, so a value carrying a newline
 * produced an unterminated string — five parse errors in the consumer's token
 * file, from a value that arrived over the wire from a browser.
 *
 * @param {string} value
 */
const quoteLiteral = (value) =>
  `'${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    // U+2028/U+2029 end a line in JS source even inside a string literal.
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    // Everything else non-printable, by code point rather than by enumeration.
    .replace(
      /[\0-\x1f\x7f]/g,
      (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`,
    )}'`;

/**
 * Replace a nested object-property initializer.
 *
 * `valueKind` is the design-system-integrity rule, not a formatting choice:
 *
 *   - `'literal'` (default) — a quoted string, `'#B865aa'`. Right for a raw
 *     value (a palette leaf, a semantic neutral).
 *   - `'expression'` — verbatim and UNQUOTED, `palette.butter`. This is what
 *     keeps a semantic token BOUND to the palette. Always writing a literal
 *     severs that link and leaves every other palette consumer on the old
 *     color, so the single source of truth diverges silently.
 *
 * Only a bare dotted `palette.<key>` reference is accepted, for the same reason
 * `renderAttribute` guards its expression kind: the value arrives from a browser
 * and is spliced into a file the dev server executes.
 *
 * @param {string} fileText
 * @param {{constName: string, path: string[], value: string,
 *          valueKind?: 'literal'|'expression'}} intent
 * @returns {InjectResult}
 */
export function applyTokenValue(fileText, intent) {
  const { constName, path, value, valueKind = 'literal' } = intent;
  const sf = parse(fileText);
  let obj = findConstObject(sf, constName);
  if (!obj) return { located: false, text: fileText, reason: `const ${constName} not found` };

  /** @type {ts.Expression | null} */
  let target = null;
  for (let i = 0; i < path.length; i++) {
    const init = getProp(obj, path[i]);
    if (!init) {
      return {
        located: false,
        text: fileText,
        reason: `property ${path.slice(0, i + 1).join('.')} not found`,
      };
    }
    if (i === path.length - 1) {
      target = init;
    } else if (ts.isObjectLiteralExpression(init)) {
      obj = init;
    } else {
      return { located: false, text: fileText, reason: `${path[i]} is not an object` };
    }
  }
  if (!target) return { located: false, text: fileText, reason: 'no target' };

  let replacement;
  if (valueKind === 'expression') {
    if (!/^palette(\.[a-zA-Z_$][a-zA-Z0-9_$]*)+$/.test(value)) {
      return { located: false, text: fileText, reason: `invalid palette reference: ${value}` };
    }
    replacement = value;
  } else {
    replacement = quoteLiteral(value);
  }
  return {
    located: true,
    text: spliceSpan(fileText, target.getStart(sf), target.getEnd(), replacement),
  };
}

// --- Introspection readers -------------------------------------------------
// Read the CURRENT binding form of each token so the editor can distinguish
// "bound to the palette" from "raw literal", and enumerate the palette's leaves
// for the rebind picker.

/**
 * Flatten a const object's string leaves into `{path, value}` pairs.
 *
 * The editor's "current value" comes from SOURCE rather than `getComputedStyle`,
 * which goes stale the moment a write lands — that staleness is what made saved
 * values look unsaved.
 *
 * @param {string} fileText
 * @param {string} constName
 * @returns {{located: boolean, leaves?: {path: string[], value: string}[], reason?: string}}
 */
export function readConstLeaves(fileText, constName) {
  const sf = parse(fileText, `${constName}.ts`);
  const obj = findConstObject(sf, constName);
  if (!obj) return { located: false, reason: `const ${constName} not found` };
  /** @type {{path: string[], value: string}[]} */
  const leaves = [];
  /**
   * @param {ts.ObjectLiteralExpression} node
   * @param {string[]} path
   */
  const walk = (node, path) => {
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p) || !p.name) continue;
      const key = p.name.getText(sf).replace(/^["']|["']$/g, '');
      const init = p.initializer;
      if (ts.isObjectLiteralExpression(init)) walk(init, [...path, key]);
      else if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
        leaves.push({ path: [...path, key], value: init.text });
      }
    }
  };
  walk(obj, []);
  return { located: true, leaves };
}

/**
 * Classify one semantic-map initializer into a binding descriptor.
 *
 * @param {ts.Expression} init
 * @param {ts.SourceFile} sf
 * @returns {{kind: string, value?: string, ref?: string}}
 */
function classifyInit(init, sf) {
  if (ts.isStringLiteral(init)) return { kind: 'literal', value: init.text };
  if (ts.isPropertyAccessExpression(init)) {
    const text = init.getText(sf);
    return text.startsWith('palette.')
      ? { kind: 'palette', ref: text }
      : { kind: 'other', value: text };
  }
  if (ts.isTemplateExpression(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
    return { kind: 'computed', value: init.getText(sf) };
  }
  return { kind: 'other', value: init.getText(sf) };
}

/**
 * Read every `light`/`dark` semantic token's binding form.
 *
 * @param {string} fileText
 * @returns {{located: boolean, bindings?: Record<string, Record<string, object>>,
 *            reason?: string}}
 */
export function readSemanticBindings(fileText) {
  const sf = parse(fileText, 'semantic.ts');
  // Null-prototype: the keys are token names read out of a consumer's source.
  // See §5.11 and `test/server/name-keyed-maps.test.mjs`.
  /** @type {Record<string, Record<string, object>>} */
  const bindings = Object.create(null);
  for (const constName of ['light', 'dark']) {
    const obj = findConstObject(sf, constName);
    if (!obj) return { located: false, reason: `const ${constName} not found` };
    bindings[constName] = Object.create(null);
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p) || !p.name) continue;
      const key = p.name.getText(sf).replace(/^["']|["']$/g, '');
      bindings[constName][key] = classifyInit(p.initializer, sf);
    }
  }
  return { located: true, bindings };
}

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|oklch\(|rgba?\(|hsla?\()/;

/**
 * Flatten the `palette` const's string leaves. Each entry carries its dotted ref
 * (`palette.neutrals.light.ink`), path, value, and whether it reads as a color —
 * rgb tuples like `syrupRgb` are flagged `isColor: false` so a color picker does
 * not offer them.
 *
 * @param {string} fileText
 * @returns {{located: boolean, reason?: string,
 *            colors?: {ref: string, path: string[], value: string, isColor: boolean}[]}}
 */
export function readPaletteColors(fileText) {
  const sf = parse(fileText, 'palette.ts');
  const obj = findConstObject(sf, 'palette');
  if (!obj) return { located: false, reason: 'const palette not found' };
  /** @type {{ref: string, path: string[], value: string, isColor: boolean}[]} */
  const colors = [];
  /**
   * @param {ts.ObjectLiteralExpression} node
   * @param {string[]} path
   */
  const walk = (node, path) => {
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p) || !p.name) continue;
      const key = p.name.getText(sf).replace(/^["']|["']$/g, '');
      const init = p.initializer;
      if (ts.isObjectLiteralExpression(init)) {
        walk(init, [...path, key]);
      } else if (ts.isStringLiteral(init)) {
        colors.push({
          ref: ['palette', ...path, key].join('.'),
          path: [...path, key],
          value: init.text,
          isColor: COLOR_RE.test(init.text),
        });
      }
    }
  };
  walk(obj, []);
  return { located: true, colors };
}

// --- Token creation and removal: the three-point edit -----------------------
// The token pipeline is CLOSED (source const → emitter array → `@theme inline`
// alias), so creating a token in ANY family is the same coordinated edit in
// three places. Miss one and the token exists but is unreachable as a utility.

/**
 * Find `type <name> = { … }` and return its TypeLiteral node.
 *
 * @param {ts.SourceFile} sf
 * @param {string} name
 * @returns {ts.TypeLiteralNode | null}
 */
function findTypeLiteral(sf, name) {
  /** @type {ts.TypeLiteralNode | null} */
  let found = null;
  /** @param {ts.Node} n */
  const visit = (n) => {
    if (
      ts.isTypeAliasDeclaration(n) &&
      n.name.getText(sf) === name &&
      ts.isTypeLiteralNode(n.type)
    ) {
      found = n.type;
    }
    if (!found) ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/**
 * Insert `member` as its own line just above a literal's closing bracket.
 *
 * The splice lands at the START of the closing bracket's line, not immediately
 * before the bracket, so the bracket's own indentation is not prepended to the
 * new line.
 *
 * @param {string} fileText
 * @param {ts.SourceFile} sf
 * @param {ts.Node} node
 * @param {string} member
 * @param {ts.Node} sampleForIndent
 */
function insertBeforeClose(fileText, sf, node, member, sampleForIndent) {
  const full = sf.getFullText();
  const nl = full.includes('\r\n') ? '\r\n' : '\n';
  const closeAt = node.getEnd() - 1; // the `}` or `]`
  const hasMembers = sampleForIndent !== node;
  // The member carries its own trailing separator; this is the character that
  // has to JOIN it to whatever comes before.
  const sepChar = member.trimEnd().endsWith(';') ? ';' : ',';

  let ls = closeAt;
  while (ls > 0 && full[ls - 1] !== '\n') ls--; // start of the closing-bracket line

  // Multi-line: the closing bracket sits alone on its line, so the new member
  // takes its own line above it at the existing members' indent.
  if (/^[ \t]*$/.test(full.slice(ls, closeAt))) {
    let out = spliceSpan(fileText, ls, ls, `${indentOf(sf, sampleForIndent)}${member}${nl}`);
    // A last member with no trailing separator has to gain one, or the new line
    // below it is a syntax error. Spliced second because it is the lower offset.
    if (hasMembers) {
      const prevEnd = sampleForIndent.getEnd();
      // Two places the separator can already be: INSIDE the previous member (a
      // `PropertySignature`'s span includes its `;`) or in the gap after it (an
      // object literal's comma is a list separator, outside the property). Only
      // checking the gap re-added a semicolon the type member already had.
      const already =
        /[,;]/.test(full[prevEnd - 1] ?? '') || /[,;]/.test(full.slice(prevEnd, ls));
      if (!already) out = spliceSpan(out, prevEnd, prevEnd, sepChar);
    }
    return out;
  }

  // Single-line — `type SemanticColorMap = { bg: string; };`. The scan above
  // lands at the start of the whole DECLARATION, so the member was spliced above
  // it as a stray top-level statement. That parses (as a label) and typechecks
  // nowhere, so nothing reported it: the token simply never joined the type.
  // Insert inline instead, just inside the bracket.
  let at = closeAt;
  while (at > 0 && /[ \t]/.test(full[at - 1])) at--;
  const prev = full[at - 1];
  const lead = prev === '{' || prev === ',' || prev === ';' ? ' ' : `${sepChar} `;
  // No trailing space: the whitespace between `at` and the bracket is still
  // there, and adding another produced `accent: string  }`.
  return spliceSpan(fileText, at, at, `${lead}${member.replace(/[,;]\s*$/, '')}`);
}

/**
 * Find a function declaration by name and return its first array literal.
 *
 * @param {ts.SourceFile} sf
 * @param {string} fnName
 * @returns {ts.ArrayLiteralExpression | null}
 */
function findFirstArrayInFn(sf, fnName) {
  /** @type {ts.FunctionDeclaration | null} */
  let fn = null;
  /** @param {ts.Node} n */
  const findFn = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.name.getText(sf) === fnName) fn = n;
    if (!fn) ts.forEachChild(n, findFn);
  };
  findFn(sf);
  if (!fn) return null;
  /** @type {ts.ArrayLiteralExpression | null} */
  let arr = null;
  /** @param {ts.Node} n */
  const findArr = (n) => {
    if (!arr && ts.isArrayLiteralExpression(n)) arr = n;
    if (!arr) ts.forEachChild(n, findArr);
  };
  findArr(fn);
  return arr;
}

/**
 * Add a brand-new semantic color token: the `SemanticColorMap` type, plus the
 * `light` and `dark` maps (same starting value in both, so the token is valid
 * across themes from the moment it exists).
 *
 * Splices run BOTTOM-UP because they share one `sf`, so an earlier write
 * invalidates every later offset. The order is DERIVED from each target's
 * position, not hardcoded: writing dark → light → type happens to be bottom-up
 * only for the declaration order this repo's `semantic.ts` uses, and a file that
 * declares `dark` before `light` came out mangled and unparseable.
 *
 * @param {string} fileText
 * @param {{camelKey: string, value: string}} intent
 * @returns {InjectResult}
 */
export function insertSemanticToken(fileText, intent) {
  const { camelKey, value } = intent;
  if (!isIdent(camelKey)) {
    return { located: false, text: fileText, reason: `invalid token key: ${camelKey}` };
  }
  const sf = parse(fileText, 'semantic.ts');

  const typeLit = findTypeLiteral(sf, 'SemanticColorMap');
  const light = findConstObject(sf, 'light');
  const dark = findConstObject(sf, 'dark');
  if (!typeLit || !light || !dark) {
    return {
      located: false,
      text: fileText,
      reason: 'semantic.ts shape not recognized (type/light/dark)',
    };
  }
  if (getProp(light, camelKey) || getProp(dark, camelKey)) {
    return { located: false, text: fileText, reason: `token "${camelKey}" already exists` };
  }

  const val = quoteLiteral(value);
  const lightSample = light.properties[light.properties.length - 1] ?? light;
  const darkSample = dark.properties[dark.properties.length - 1] ?? dark;
  const typeSample = typeLit.members[typeLit.members.length - 1] ?? typeLit;

  const edits = [
    { container: dark, line: `${camelKey}: ${val},`, sample: darkSample },
    { container: light, line: `${camelKey}: ${val},`, sample: lightSample },
    { container: typeLit, line: `${camelKey}: string;`, sample: typeSample },
  ].sort((a, b) => b.container.getEnd() - a.container.getEnd());

  let text = fileText;
  for (const e of edits) text = insertBeforeClose(text, sf, e.container, e.line, e.sample);
  return { located: true, text };
}

/**
 * Remove a semantic token from all three places `insertSemanticToken` added it.
 * Bottom-up for the same shared-`sf` reason.
 *
 * Tolerates a PARTIAL presence — a token in `light` but not `dark` still gets
 * cleaned up — because refusing would leave the half-created state permanently
 * unfixable through this API.
 *
 * @param {string} fileText
 * @param {{camelKey: string}} intent
 * @returns {InjectResult}
 */
export function removeSemanticToken(fileText, intent) {
  const { camelKey } = intent;
  const sf = parse(fileText, 'semantic.ts');
  const typeLit = findTypeLiteral(sf, 'SemanticColorMap');
  const light = findConstObject(sf, 'light');
  const dark = findConstObject(sf, 'dark');
  if (!typeLit || !light || !dark) {
    return {
      located: false,
      text: fileText,
      reason: 'semantic.ts shape not recognized (type/light/dark)',
    };
  }
  const lightProp = findPropAssignment(light, camelKey);
  const darkProp = findPropAssignment(dark, camelKey);
  const typeMember = typeLit.members.find(
    (m) =>
      ts.isPropertySignature(m) &&
      m.name &&
      m.name.getText(sf).replace(/^["']|["']$/g, '') === camelKey,
  );
  if (!lightProp && !darkProp && !typeMember) {
    return { located: false, text: fileText, reason: `token "${camelKey}" not found` };
  }
  // Sorted, not hardcoded — same reason as `insertSemanticToken`: the three
  // declarations can appear in any order, and a fixed sequence is bottom-up for
  // only one of them.
  const targets = [darkProp, lightProp, typeMember]
    .filter((n) => n != null)
    .sort((a, b) => b.getEnd() - a.getEnd());

  let text = fileText;
  for (const node of targets) text = removeNodeLine(text, sf, node);
  return { located: true, text };
}

/**
 * Add a member to `const <constName> = { … }` — the generic form for the
 * palette / radius / typography families, which have no type-literal member.
 *
 * @param {string} fileText
 * @param {{constName: string, key: string, value: string,
 *          valueKind?: 'literal'|'expression'}} intent
 * @returns {InjectResult}
 */
export function insertConstMember(fileText, intent) {
  const { constName, key, value, valueKind = 'literal' } = intent;
  if (!isIdent(key)) return { located: false, text: fileText, reason: `invalid token key: ${key}` };
  const sf = parse(fileText, `${constName}.ts`);
  const obj = findConstObject(sf, constName);
  if (!obj) return { located: false, text: fileText, reason: `const ${constName} not found` };
  if (getProp(obj, key)) {
    return { located: false, text: fileText, reason: `"${key}" already exists in ${constName}` };
  }
  if (valueKind === 'expression' && !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(value)) {
    return { located: false, text: fileText, reason: `invalid expression: ${value}` };
  }
  const val = valueKind === 'expression' ? value : quoteLiteral(value);
  const sample = obj.properties[obj.properties.length - 1] ?? obj;
  return { located: true, text: insertBeforeClose(fileText, sf, obj, `${key}: ${val},`, sample) };
}

/**
 * Remove `key` from `const <constName> = { … }` — the inverse of
 * `insertConstMember`, used when an undo rolls back past a save.
 *
 * @param {string} fileText
 * @param {{constName: string, key: string}} intent
 * @returns {InjectResult}
 */
export function removeConstMember(fileText, intent) {
  const { constName, key } = intent;
  const sf = parse(fileText, `${constName}.ts`);
  const obj = findConstObject(sf, constName);
  if (!obj) return { located: false, text: fileText, reason: `const ${constName} not found` };
  const prop = findPropAssignment(obj, key);
  if (!prop) return { located: false, text: fileText, reason: `"${key}" not found in ${constName}` };
  return { located: true, text: removeNodeLine(fileText, sf, prop) };
}

/**
 * Register a CSS variable in one of the emitter arrays, so the token actually
 * reaches the generated stylesheet. Without this the const exists and nothing
 * is emitted — the token is invisible.
 *
 * @param {string} fileText
 * @param {{fnName: string, cssVar: string, expr: string}} intent
 * @returns {InjectResult}
 */
export function insertBlockEmit(fileText, intent) {
  const { fnName, cssVar, expr } = intent;
  const sf = parse(fileText, 'build-css.ts');
  const arr = findFirstArrayInFn(sf, fnName);
  if (!arr) return { located: false, text: fileText, reason: `${fnName}() array not found` };
  if (arr.elements.some((e) => e.getText(sf).includes(`'${cssVar}'`))) {
    return { located: false, text: fileText, reason: `emitter for ${cssVar} already present` };
  }
  const sample = arr.elements[arr.elements.length - 1] ?? arr;
  return {
    located: true,
    text: insertBeforeClose(fileText, sf, arr, `['${cssVar}', ${expr}],`, sample),
  };
}

/**
 * Remove a CSS variable's emitter entry — the inverse of `insertBlockEmit`.
 *
 * @param {string} fileText
 * @param {{fnName: string, cssVar: string}} intent
 * @returns {InjectResult}
 */
export function removeBlockEmit(fileText, intent) {
  const { fnName, cssVar } = intent;
  const sf = parse(fileText, 'build-css.ts');
  const arr = findFirstArrayInFn(sf, fnName);
  if (!arr) return { located: false, text: fileText, reason: `${fnName}() array not found` };
  const el = arr.elements.find((e) => e.getText(sf).includes(`'${cssVar}'`));
  if (!el) return { located: false, text: fileText, reason: `emitter for ${cssVar} not found` };
  return { located: true, text: removeNodeLine(fileText, sf, el) };
}

// --- Tailwind `@theme inline` aliases --------------------------------------
// A CSS variable in `:root` is NOT a Tailwind utility. `bg-brand-accent` only
// exists once `@theme inline { --color-brand-accent: var(--brand-accent); }` is
// declared. Plain-text surgery, not TS, bounded to that block — and it is the
// step that makes a newly created token usable as a class.

/**
 * Locate the `@theme inline { … }` block's brace span.
 *
 * Brace-counts rather than regex-matching, so a nested block inside `@theme`
 * cannot end the span early.
 *
 * @param {string} cssText
 * @returns {{open: number, close: number} | null}
 */
function findThemeBlock(cssText) {
  const at = cssText.indexOf('@theme inline');
  if (at < 0) return null;
  const open = cssText.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < cssText.length; i++) {
    if (cssText[i] === '{') depth++;
    else if (cssText[i] === '}') {
      depth--;
      if (depth === 0) return { open, close: i };
    }
  }
  return null;
}

/**
 * Every custom property declared inside `@theme inline` — i.e. which tokens are
 * reachable as utility classes.
 *
 * @param {string} cssText
 * @returns {{located: boolean, mappings?: string[], reason?: string}}
 */
export function readThemeMappings(cssText) {
  const block = findThemeBlock(cssText);
  if (!block) return { located: false, reason: '@theme inline block not found' };
  const body = cssText.slice(block.open + 1, block.close);
  const mappings = [...body.matchAll(/^[ \t]*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]);
  return { located: true, mappings };
}

/**
 * Add `<cssVar>: var(<mapTo>);` to `@theme inline`, grouped after the last
 * declaration sharing its namespace (`--color-*`, `--radius-*`, `--font-*`).
 *
 * Grouping is not cosmetic: it keeps the block sorted by family, and it puts a
 * `--font-*` alias inside the existing lint-disable region rather than beside it.
 *
 * @param {string} cssText
 * @param {{cssVar: string, mapTo: string}} intent
 * @returns {InjectResult}
 */
export function insertThemeMapping(cssText, intent) {
  const { cssVar, mapTo } = intent;
  if (!/^--[a-z0-9-]+$/.test(cssVar) || !/^--[a-z0-9-]+$/.test(mapTo)) {
    return {
      located: false,
      text: cssText,
      reason: `invalid custom property: ${cssVar} / ${mapTo}`,
    };
  }
  const block = findThemeBlock(cssText);
  if (!block) return { located: false, text: cssText, reason: '@theme inline block not found' };
  const body = cssText.slice(block.open + 1, block.close);
  if (new RegExp(`^[ \\t]*${escapeRe(cssVar)}\\s*:`, 'm').test(body)) {
    return { located: false, text: cssText, reason: `${cssVar} already mapped` };
  }

  const ns = /^(--[a-z]+)-/.exec(cssVar)?.[1] ?? '';
  const lines = [
    ...body.matchAll(new RegExp(`^[ \\t]*${escapeRe(ns)}-[a-z0-9-]+\\s*:[^\\n]*\\n`, 'gm')),
  ];
  const last = lines[lines.length - 1];
  const nl = cssText.includes('\r\n') ? '\r\n' : '\n';
  const decl = `  ${cssVar}: var(${mapTo});`;

  if (last && last.index !== undefined) {
    const at = block.open + 1 + last.index + last[0].length;
    return { located: true, text: spliceSpan(cssText, at, at, `${decl}${nl}`) };
  }
  // No same-namespace sibling — insert at the start of the closing brace's line.
  let ls = block.close;
  while (ls > 0 && cssText[ls - 1] !== '\n') ls--;
  return { located: true, text: spliceSpan(cssText, ls, ls, `${decl}${nl}`) };
}

/**
 * Remove a `@theme inline` alias — the inverse of `insertThemeMapping`.
 *
 * @param {string} cssText
 * @param {{cssVar: string}} intent
 * @returns {InjectResult}
 */
export function removeThemeMapping(cssText, intent) {
  const { cssVar } = intent;
  const block = findThemeBlock(cssText);
  if (!block) return { located: false, text: cssText, reason: '@theme inline block not found' };
  const body = cssText.slice(block.open + 1, block.close);
  // `\n|$` rather than `\n`: the LAST declaration in a block may sit directly
  // against the closing brace with no trailing newline, and requiring one made
  // `removeThemeMapping` report "not mapped" for a mapping that is plainly
  // there. `$` is end-of-body here (the body stops at the brace), so this still
  // cannot reach past the block.
  const m = new RegExp(`^[ \\t]*${escapeRe(cssVar)}\\s*:[^\\n]*(?:\\n|$)`, 'm').exec(body);
  if (!m) return { located: false, text: cssText, reason: `${cssVar} is not mapped` };
  const start = block.open + 1 + m.index;
  return { located: true, text: spliceSpan(cssText, start, start + m[0].length, '') };
}

// ---------------------------------------------------------------------------
// LAYOUT MUTATION — arbitrary JSX nodes in a scene file.
//
// Same discipline as the token half: resolve an exact node, replace only its
// span. The difference is the ANCHOR. A CVA edit is addressed by
// (cvaName, axis, value) — names that exist in the source. A layout edit has no
// such names, so it is addressed by a `NodeAnchor`: a child-index path (a HINT)
// verified by a fingerprint (the TRUTH). See `jsx-nodes.mjs`, which owns the
// numbering and the resolution algorithm.
//
// All paths and indices are in the BASELINE frame — what is on disk, what the
// metadata describes. Cross-intent ordering is the CLIENT's job (a batch is
// sorted so no op disturbs a position a later op still needs); this module
// applies one intent against the text it is given.
// ---------------------------------------------------------------------------

/**
 * Splice offset for "become child #index of parent", plus the indent to use.
 *
 * The offset sits immediately BEFORE the owner currently at `index`, including
 * that owner's leading line-break and indent — not after the previous element
 * sibling. The distinction is the whole point:
 *
 *     <div>
 *       <A/>
 *       Some prose
 *       {count}
 *       <B/>          <-- element index 1
 *     </div>
 *
 * `childrenOf` filters to JSX elements, so `Some prose` and `{count}` are not
 * children in this numbering — but they ARE bytes between `<A/>` and `<B/>`.
 * Anchoring after `<A/>` made `applyLayoutRemove`'s span swallow both: removing
 * `<B/>` silently deleted the prose and the expression too. Anchoring before
 * `<B/>` removes exactly `<B/>` and its own line.
 *
 * Using the OWNER rather than the node still matters: for `{cond && <div/>}` the
 * element's end sits before the `}`, so splicing at the element would produce
 * `{cond && <div/> <new/>}` — a syntax error.
 *
 * BOTH `applyLayoutInsert` AND `applyLayoutRemove` derive their span from this
 * one function. That is what makes remove → insert an exact involution rather
 * than an approximate one: the removed span runs from this offset to the node's
 * end, and re-inserting splices at the same offset. Two copies of the
 * arithmetic — which is how this was first written — would let the
 * byte-identity property break silently the day one of them was touched.
 *
 * `null` means "no expressible position", which callers must refuse rather than
 * approximate. It is returned when `index` falls INSIDE a shared-owner group:
 * in `{flag ? <A/> : <B/>}` both branches are children with one owner, and
 * there is no offset that means "between them". Before this returned null, an
 * insert at that index silently landed after the whole conditional — the
 * position of the NEXT index, byte-identical to it.
 *
 * @param {ts.SourceFile} sf
 * @param {JsxRootNode} parent
 * @param {Scope} scope
 * @param {number} index
 * @returns {{offset: number | null, indent: string, reason?: string}}
 */
function childSpliceOffset(sf, parent, scope, index) {
  const kids = childrenOf(parent, scope);
  const node = /** @type {ts.Node} */ (parent);
  const openEnd = ts.isJsxElement(node)
    ? node.openingElement.getEnd()
    : ts.isJsxFragment(node)
      ? node.openingFragment.getEnd()
      : null;

  // Inside a shared-owner group there is no position to name.
  if (index > 0 && index < kids.length && kids[index - 1].owner === kids[index].owner) {
    return {
      offset: null,
      indent: indentOf(sf, kids[index].owner),
      reason:
        `index ${index} falls inside a single expression that renders ` +
        `${kids.filter((k) => k.owner === kids[index].owner).length} children; ` +
        `there is no source position between them`,
    };
  }

  // Append: the one position with no "current occupant" to sit in front of, so
  // it anchors at the END OF THE CHILD REGION — scanning back from the closing
  // tag over whitespace — rather than after the last ELEMENT.
  //
  // Those differ exactly when non-element content trails the last element, and
  // the difference is the involution: removing the last `<B/>` from
  // `… {count} <B/> </div>` captures `"\n      <B/>"`, and re-inserting at the
  // append index has to land after `{count}`, not after the element before it.
  // Anchoring on the last element put `<B/>` back in the wrong place and the
  // round-trip stopped being byte-identical.
  //
  // Scanning back from the closing tag also preserves what the owner-based form
  // protected: for a trailing `{cond && <div/>}` the scan stops after the `}`,
  // never inside the expression.
  if (index >= kids.length) {
    const closeStart = ts.isJsxElement(node)
      ? node.closingElement.getStart(sf)
      : ts.isJsxFragment(node)
        ? node.closingFragment.getStart(sf)
        : null;
    const last = kids[kids.length - 1];
    const indent = last ? indentOf(sf, last.owner) : `${indentOf(sf, node)}  `;
    if (closeStart == null) {
      return last
        ? { offset: last.owner.getEnd(), indent }
        : { offset: openEnd, indent };
    }
    const full = sf.getFullText();
    let end = closeStart;
    while (end > 0 && /\s/.test(full[end - 1])) end--;
    if (openEnd != null && end < openEnd) end = openEnd;
    return { offset: end, indent };
  }

  // Before the current occupant, taking its leading indent with it so the
  // captured span carries its own line.
  const target = kids[index].owner;
  const full = sf.getFullText();
  let start = target.getStart(sf);
  while (start > 0 && full[start - 1] !== '\n' && /[ \t]/.test(full[start - 1])) start--;
  if (start > 0 && full[start - 1] === '\n') start--;
  if (start > 0 && full[start - 1] === '\r') start--;
  // Never reach back past the parent's opening tag (index 0 with no newline).
  if (openEnd != null && start < openEnd) start = openEnd;
  return { offset: start, indent: indentOf(sf, target) };
}

/**
 * Attributes a design tool has no business writing, whatever their value.
 *
 * `renderAttribute` validated the SHAPE of a name and the shape of a value, and
 * both `dangerouslySetInnerHTML={x.y}` and `onClick={h.save}` satisfy every
 * shape rule it had — a bare dotted reference is exactly what the expression
 * guard is designed to allow. Shape is the wrong question for these names:
 *
 *   - `on*` — a handler is behaviour, not design, and the reference it names is
 *     resolved in the consumer's scope at run time.
 *   - `dangerouslySetInnerHTML` — React's own explicit escape from escaping.
 *   - `srcDoc` — a whole document inlined into an iframe, script tags included.
 *
 * This is a denylist and therefore not a security boundary on its own; it is the
 * layer that stops the obvious cases from being reachable through an ordinary
 * intent. The boundary is that values are validated at all.
 *
 * @param {string} name
 */
const isDangerousAttribute = (name) =>
  /^on[A-Z]/.test(name) || name === 'dangerouslySetInnerHTML' || name === 'srcDoc';

/**
 * The `JsxAttribute` node named `name`, or null.
 *
 * @param {ts.Node} node
 * @param {string} name
 * @returns {ts.JsxAttribute | null}
 */
function findJsxAttribute(node, name) {
  /** @type {readonly ts.JsxAttributeLike[]} */
  const props = ts.isJsxElement(node)
    ? node.openingElement.attributes.properties
    : ts.isJsxSelfClosingElement(node)
      ? node.attributes.properties
      : [];
  for (const p of props) {
    if (ts.isJsxAttribute(p) && p.name.getText() === name) return p;
  }
  return null;
}

/**
 * The opening element's tag-name node, for "append an attribute after the tag".
 *
 * @param {ts.Node} node
 * @returns {ts.Node | null}
 */
function tagNameOf(node) {
  if (ts.isJsxElement(node)) return node.openingElement.tagName;
  if (ts.isJsxSelfClosingElement(node)) return node.tagName;
  return null;
}

/**
 * Render `name={value}` or `name="value"`, or null if the value is not safe to
 * splice.
 *
 * `expression` is GUARDED: only a bare dotted reference or a number/boolean is
 * accepted. The value arrives from a browser, so arbitrary text must not be
 * splicable into a source file — an unguarded `expression` here would be a
 * remote-code-execution hole in a dev server, since whatever lands in the file
 * is executed by the next HMR reload.
 *
 * @param {string} name
 * @param {string} value
 * @param {'string'|'expression'} valueKind
 * @returns {string | null}
 */
function renderAttribute(name, value, valueKind) {
  if (!/^[A-Za-z_$][\w$-]*$/.test(name)) return null;
  if (isDangerousAttribute(name)) return null;
  if (valueKind === 'expression') {
    const ok =
      /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(value) ||
      /^(-?\d+(\.\d+)?|true|false)$/.test(value);
    return ok ? `${name}={${value}}` : null;
  }
  if (value.includes('"')) return `${name}={${JSON.stringify(value)}}`;
  return `${name}="${value}"`;
}

/**
 * Rewrite attributes / classes / text on one existing JSX node. Never changes
 * tree shape, which is why it is the ONLY layout op allowed inside a `.map()`
 * body or a conditional — `resolveNode` is called WITHOUT `requireStatic`.
 *
 * Splices are collected and applied HIGHEST-OFFSET-FIRST so earlier offsets stay
 * valid — the same rule every multi-splice path in this file follows.
 *
 * @param {string} fileText
 * @param {{anchor: NodeAnchor,
 *          sets?: {name: string, value: string|null, valueKind?: 'string'|'expression'}[],
 *          classOps?: {replacements?: {from: string, to: string}[], additions?: string[],
 *                      removals?: string[]},
 *          text?: string|null}} intent
 * @returns {InjectResult}
 */
export function applyLayoutProps(fileText, intent) {
  const sf = parse(fileText);
  const r = resolveNode(sf, intent.anchor);
  if (!r.located) return { located: false, text: fileText, reason: r.reason };

  const node = /** @type {ts.Node} */ (r.entry.node);
  /** @type {{start: number, end: number, text: string}[]} */
  const splices = [];
  /** @type {string[]} */
  const notes = [];
  let applied = 0;

  // --- classOps: whole-token ops on the className literal ---
  if (intent.classOps) {
    const lit = classLiteralOf(node);
    if (lit) {
      const original = lit.getText(sf); // quotes included
      const { applied: n, text, missing, rejected } = rewriteClassLiteral(original, intent.classOps);
      if (rejected.length) notes.push(`rejected unsafe class tokens: ${rejected.join(', ')}`);
      if (n === 0) notes.push(`no matching classes: ${missing.join(', ')}`);
      else {
        splices.push({ start: lit.getStart(sf), end: lit.getEnd(), text });
        applied += n;
      }
    } else if (findJsxAttribute(node, 'className')) {
      // A `className` attribute exists but is not a plain string literal — a
      // call to something that is not a known class joiner, a bare variable, a
      // ternary. Refusing (rather than clobbering it with a plain string) is the
      // same discipline `classLiteralOf` describes: editing anything but the
      // authored literal blob would be a guess, and this module writes to disk.
      //
      // Since `classLiteralOf` was narrowed to a joiner allowlist, this branch
      // also catches `className={t("nav.home")}` — which the earlier code would
      // have rewritten, destroying the translation key. The refusal is correct;
      // it is also currently invisible to the designer, which the follow-up PR
      // fixes by surfacing the expression on the node's metadata.
      notes.push('className is not a string literal (no editable class blob)');
    } else {
      // No `className` attribute AT ALL — common for a `.map()` row that is a
      // thin wrapper component with no className of its own. Nothing to rewrite,
      // but nothing to lose either: create a fresh attribute from `additions`
      // alone (there is no existing blob for `replacements`/`removals` to act
      // on), the same "append after the tag name" splice the `sets` loop uses.
      //
      // The attribute is rendered by `renderAttribute`, not by interpolating
      // into a template here. Hand-rolling ` className="${…}"` was the same
      // splice `renderAttribute` exists to perform safely, and it accepted a
      // token carrying a quote — writing a live `onLoad={…}` handler onto the
      // element. One renderer means the escaping rule cannot differ by path.
      // A fresh attribute is always written double-quoted by `renderAttribute`,
      // so that is the alphabet to check against.
      const requested = intent.classOps.additions ?? [];
      const additions = requested.filter((t) => isSafeClassToken(t, '"'));
      const unsafe = requested.filter((t) => !isSafeClassToken(t, '"'));
      if (unsafe.length) notes.push(`rejected unsafe class tokens: ${unsafe.join(', ')}`);
      const tagName = tagNameOf(node);
      if (additions.length && tagName) {
        const tagEnd = tagName.getEnd();
        const rendered = renderAttribute('className', additions.join(' '), 'string');
        if (rendered === null) {
          notes.push('could not render a className attribute');
        } else {
          splices.push({ start: tagEnd, end: tagEnd, text: ` ${rendered}` });
          applied += additions.length;
        }
      } else if (!unsafe.length) {
        notes.push('no className attribute to remove classes from');
      }
    }
  }

  // --- sets: whole-attribute writes ---
  for (const set of intent.sets ?? []) {
    // `className` is not an ordinary attribute here. The `classOps` branch above
    // refuses to touch a non-literal one (`className={t("nav.home")}`) because
    // rewriting it would destroy the author's expression — and `sets` reached
    // the very same attribute through a different door and overwrote it wholesale
    // with `className="…"`, which is the exact key-destruction the joiner
    // allowlist exists to prevent. One rule, both doors.
    if (set.name === 'className' && set.value !== null) {
      if (findJsxAttribute(node, 'className') && !classLiteralOf(node)) {
        notes.push('className is not a string literal (no editable class blob)');
        continue;
      }
      if (intent.classOps) {
        // Both paths write the same attribute; their spans overlap and applying
        // them highest-first interleaves the two texts into `"REPLACED"gap-2"`.
        notes.push('className cannot be set and class-edited in one intent');
        continue;
      }
    }
    const existing = findJsxAttribute(node, set.name);
    if (set.value === null) {
      if (!existing) {
        notes.push(`${set.name} is already absent`);
        continue;
      }
      // Remove the attribute and exactly one adjacent space.
      let start = existing.getStart(sf);
      let end = existing.getEnd();
      const full = sf.getFullText();
      if (/[ \t]/.test(full[end])) end++;
      else if (/[ \t]/.test(full[start - 1])) start--;
      splices.push({ start, end, text: '' });
      applied++;
      continue;
    }
    const rendered = renderAttribute(set.name, set.value, set.valueKind ?? 'string');
    if (rendered === null) {
      notes.push(`rejected ${set.name}: only string literals and bare references may be written`);
      continue;
    }
    if (existing) {
      splices.push({ start: existing.getStart(sf), end: existing.getEnd(), text: rendered });
    } else {
      // Append just after the tag name, before any existing attributes.
      const tagName = tagNameOf(node);
      if (!tagName) {
        notes.push(`cannot add ${set.name} to a fragment`);
        continue;
      }
      const tagEnd = tagName.getEnd();
      splices.push({ start: tagEnd, end: tagEnd, text: ` ${rendered}` });
    }
    applied++;
  }

  // --- text: replace the node's direct JSXText ---
  if (intent.text != null) {
    // JSXText has a WIDER hazard than a quoted attribute value, and the guard
    // differs accordingly — the two contexts are not interchangeable. Verified
    // against the parser: `{expr()}` becomes a JsxExpression and `<Foo/>` a
    // JsxElement (both executable, 0 parse errors), while a bare `>` or `}`
    // yields a parse error and breaks the consumer's build. All four are
    // refused. Escaping to `&gt;`/`{'}'}` would also work but silently rewrites
    // what the designer typed; refusing says so.
    if (/[{}<>]/.test(intent.text)) {
      notes.push('rejected text containing JSX syntax ({, }, < or >)');
    } else if (!ts.isJsxElement(node)) {
      notes.push('a self-closing element has no text to replace');
    } else {
      const texts = node.children.filter((c) => ts.isJsxText(c) && c.text.trim());
      if (!texts.length) {
        notes.push('node has no direct text child');
      } else if (texts.length > 1) {
        notes.push('node has multiple text runs; text editing needs a single run');
      } else {
        const t = texts[0];
        // Preserve the run's surrounding whitespace so indentation survives.
        const raw = t.getText(sf);
        const lead = /^\s*/.exec(raw)?.[0] ?? '';
        const trail = /\s*$/.exec(raw)?.[0] ?? '';
        splices.push({
          start: t.getStart(sf),
          end: t.getEnd(),
          text: `${lead}${intent.text}${trail}`,
        });
        applied++;
      }
    }
  }

  if (!applied) {
    return { located: false, text: fileText, reason: notes.join('; ') || 'nothing to apply' };
  }

  let out = fileText;
  const ordered = splices.sort((a, b) => b.start - a.start);
  // Highest-offset-first only keeps earlier offsets valid while the spans are
  // DISJOINT. Two splices over the same range interleave their texts into
  // nonsense that still gets written (`className="REPLACED"gap-2"`), so overlap
  // is refused rather than applied. The className case above is handled at its
  // source; this is the backstop that keeps a future third writer from
  // reintroducing the same corruption silently.
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].end > ordered[i - 1].start) {
      return {
        located: false,
        text: fileText,
        reason: 'refusing overlapping edits to the same source range',
      };
    }
  }
  for (const s of ordered) {
    out = spliceSpan(out, s.start, s.end, s.text);
  }
  const why = [
    ...notes,
    r.relocated ? `relocated to path ${r.entry.path.join('.')}` : '',
  ].filter(Boolean);
  return { located: true, text: out, reason: why.length ? why.join('; ') : undefined };
}

/**
 * Insert a subtree as child #index of `parent`.
 *
 * `requireStatic` is passed to `resolveNode`, so this refuses a parent inside a
 * `.map()` body or a conditional — where implicit returns, block bodies and
 * conditional roots each need different splicing, and getting one wrong corrupts
 * the iteration.
 *
 * `verbatim` splices `raw` exactly as given, which is what makes the inverse of
 * `applyLayoutRemove` byte-identical: the captured span already carries its
 * newline and indentation.
 *
 * @param {string} fileText
 * @param {{parent: NodeAnchor, index: number, raw: string, verbatim?: boolean}} intent
 * @returns {InjectResult}
 */
export function applyLayoutInsert(fileText, intent) {
  const sf = parse(fileText);
  // `role: 'container'` — the parent RECEIVES a child rather than being spliced
  // itself, so the sibling-list guards do not apply. Without it this refuses
  // every component whose root is a returned element, which makes
  // `applyLayoutRemove`'s inverse unapplicable: the remove succeeds and the undo
  // cannot. The scope guard still applies — a `.map()` body renders N times
  // whether you are moving it or filling it.
  const r = resolveNode(sf, intent.parent, { requireStatic: true, role: 'container' });
  if (!r.located) return { located: false, text: fileText, reason: r.reason };

  const parent = /** @type {ts.Node} */ (r.entry.node);
  if (ts.isJsxSelfClosingElement(parent)) {
    // Converting `<X/>` to `<X></X>` would make the inverse non-byte-identical,
    // so it is refused rather than silently reshaping the parent.
    return {
      located: false,
      text: fileText,
      reason: `<${r.entry.tag}> is self-closing and has no children region to insert into`,
    };
  }
  const kids = childrenOf(parent, r.entry.scope);
  if (intent.index < 0 || intent.index > kids.length) {
    return {
      located: false,
      text: fileText,
      reason: `index ${intent.index} out of range (<${r.entry.tag}> has ${kids.length} children)`,
    };
  }

  const { offset, indent, reason: offsetReason } = childSpliceOffset(
    sf,
    parent,
    r.entry.scope,
    intent.index,
  );
  if (offsetReason) return { located: false, text: fileText, reason: offsetReason };
  if (offset == null) {
    return {
      located: false,
      text: fileText,
      reason: `cannot determine an insertion point in <${r.entry.tag}>`,
    };
  }

  // `verbatim` restores a captured span exactly (its newline + indent are part
  // of the text). A fresh snippet is re-indented to the insertion site, and its
  // own relative indentation is preserved so a multi-line snippet stays readable.
  const nl = fileText.includes('\r\n') ? '\r\n' : '\n';
  let snippet;
  if (intent.verbatim) {
    snippet = intent.raw;
  } else {
    // An all-whitespace snippet has nothing to indent and nothing to insert: it
    // used to report `located: true` after splicing a bare newline, which reads
    // to the client as a successful insert and leaves the file dirty with no
    // element to show for it. `verbatim` is exempt — a captured span is
    // whitespace-significant by definition.
    if (!intent.raw.trim()) {
      return { located: false, text: fileText, reason: 'snippet is empty' };
    }
    const bad = snippetRejection(intent.raw);
    if (bad) return { located: false, text: fileText, reason: bad };
    const lines = intent.raw.replace(/\s+$/, '').split(/\r?\n/);
    const base = Math.min(
      ...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)?.[0].length ?? 0),
    );
    snippet = nl + lines.map((l) => (l.trim() ? indent + l.slice(base) : '')).join(nl);
  }

  const out = spliceSpan(fileText, offset, offset, snippet);
  // Backstop on the OFFSET, not on the snippet. `snippetRejection` has already
  // proved the snippet is one well-formed JSX element, so given a correct
  // insertion point the result parses by construction — and no test here
  // reaches this branch, which is stated plainly rather than implied: removing
  // it breaks nothing in the suite.
  //
  // It is kept because the insertion point is the part that has actually been
  // wrong. `childSpliceOffset` shipped two defects (a span that swallowed
  // sibling text, a position that silently collapsed onto the next index), and
  // a bad offset with a valid snippet is exactly the combination every other
  // guard here waves through. One parse per explicit insert is a fair price for
  // never writing an unparseable file into someone's working tree.
  //
  // `verbatim` is exempt: its bytes came out of a parseable file at this very
  // offset, so re-parsing would only re-derive that.
  if (!intent.verbatim && !parsesCleanly(parse(out, 'check.tsx'))) {
    return { located: false, text: fileText, reason: 'insert would not parse' };
  }
  const why = r.relocated ? `relocated to path ${r.entry.path.join('.')}` : undefined;
  return { located: true, text: out, reason: why };
}

/**
 * Why a fresh snippet may not be spliced, or null if it may.
 *
 * `intent.raw` went in with NO validation at all, which made
 * `applyLayoutInsert` the widest hole in the module: a raw of
 * `</div>); } evil(); function D(){ return (<div>` closed the enclosing JSX,
 * ran a call at module scope, and reopened the element — producing a file that
 * PARSES CLEANLY, so no downstream check would have caught it either.
 *
 * Three questions, cheapest first:
 *
 *   1. Does it parse standalone, as exactly one JSX element or fragment? That
 *      is what "insert a node" means, and it rejects the structural escape
 *      above (which parses as several statements, not one element).
 *   2. Does the subtree carry an attribute we refuse to write anywhere else?
 *      Otherwise the denylist `renderAttribute` enforces is trivially bypassed
 *      by inserting the handler instead of setting it.
 *   3. (At the call site) does the SPLICED FILE still parse? That is the
 *      generic backstop — it does not depend on enumerating escapes correctly.
 *
 * `verbatim` is exempt, and must stay exempt: it replays bytes that were
 * already in the file, so validating it would make undo refuse to restore
 * anything the consumer had legitimately written.
 *
 * @param {string} raw
 * @returns {string | null}
 */
function snippetRejection(raw) {
  const wrapper = parse(`<>${raw}</>`, 'snippet.tsx');
  if (!parsesCleanly(wrapper)) return 'snippet is not valid JSX';

  const stmt = wrapper.statements[0];
  if (wrapper.statements.length !== 1 || !stmt || !ts.isExpressionStatement(stmt)) {
    return 'snippet must be a single JSX element';
  }
  const frag = stmt.expression;
  if (!ts.isJsxFragment(frag)) return 'snippet must be a single JSX element';
  const kids = frag.children.filter((c) => !ts.isJsxText(c) || c.text.trim());
  if (kids.length !== 1) return 'snippet must be a single JSX element';
  const only = kids[0];
  if (!ts.isJsxElement(only) && !ts.isJsxSelfClosingElement(only) && !ts.isJsxFragment(only)) {
    return 'snippet must be a single JSX element';
  }

  /** @type {string | null} */
  let offending = null;
  /** @param {ts.Node} n */
  const walk = (n) => {
    if (offending) return;
    if (ts.isJsxAttribute(n) && isDangerousAttribute(n.name.getText())) {
      offending = n.name.getText();
      return;
    }
    n.forEachChild(walk);
  };
  walk(frag);
  return offending ? `snippet sets a disallowed attribute: ${offending}` : null;
}

/**
 * Delete a node and its subtree, and report the EXACT span removed.
 *
 * `removedText` is the analogue of a token edit's `oldValue`: it is what the
 * client stores so the inverse (`applyLayoutInsert` with `verbatim: true`)
 * restores the file byte-for-byte. The span runs from immediately after the
 * previous sibling's owner (or the parent's opening tag) through the node's end
 * — the same offset an insert at this index computes, which is what makes the
 * pair an exact involution rather than an approximate one.
 *
 * @param {string} fileText
 * @param {{anchor: NodeAnchor}} intent
 * @returns {InjectResult & {removedText?: string, removedIndex?: number,
 *                          parentPath?: number[]}}
 */
export function applyLayoutRemove(fileText, intent) {
  const sf = parse(fileText);
  const r = resolveNode(sf, intent.anchor, { requireStatic: true });
  if (!r.located) return { located: false, text: fileText, reason: r.reason };

  const { path } = r.entry;
  const node = /** @type {ts.Node} */ (r.entry.node);
  if (!path.length) {
    return { located: false, text: fileText, reason: 'cannot remove a root node' };
  }
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  // NEVER remove something the inverse cannot restore. An empty `parentPath`
  // means the container is the synthetic returns root, which no anchor can name
  // — `resolveNode` refuses it by design. That happens for the children of a
  // RETURNED FRAGMENT: the fragment is transparent for numbering, so `<A/>` and
  // `<B/>` sit at depth 1 with nothing addressable above them.
  //
  // Removing one would succeed and its `verbatim` re-insert would be refused,
  // which is the same "gone with no way back" failure `role: 'container'` was
  // added to fix one layer up. Refusing costs a real capability; the fix is to
  // make the returns root addressable as a container when it wraps a single
  // fragment, which needs `childSpliceOffset` to delegate to that fragment's
  // opening token. Left for the PR that has a client able to exercise it.
  if (!parentPath.length) {
    return {
      located: false,
      text: fileText,
      reason:
        `<${r.entry.tag}> at ${path.join('.')} is a direct child of the return value, whose ` +
        `container has no anchor — removing it could not be undone. Wrap the group in an ` +
        `element to restructure inside it.`,
    };
  }
  const { roots } = findJsxRoots(sf);
  const parent = nodeAtPath(roots[intent.anchor.component], parentPath, 'static');
  if (!parent) return { located: false, text: fileText, reason: 'parent node vanished' };

  // The SAME offset an insert at this index would use — that identity is what
  // makes the pair an exact involution.
  const { offset, reason: offsetReason } = childSpliceOffset(
    sf,
    parent.node,
    parent.scope,
    index,
  );
  if (offsetReason) return { located: false, text: fileText, reason: offsetReason };
  const start = offset ?? node.getStart(sf);
  const end = node.getEnd();

  return {
    located: true,
    text: spliceSpan(fileText, start, end, ''),
    removedText: fileText.slice(start, end),
    removedIndex: index,
    parentPath,
    reason: r.relocated ? `relocated to path ${path.join('.')}` : undefined,
  };
}

/**
 * Walk `path` from a root, returning `{node, scope}`.
 *
 * @param {JsxRootNode | undefined} root
 * @param {number[]} path
 * @param {Scope} scope
 * @returns {{node: JsxRootNode, scope: Scope} | null}
 */
function nodeAtPath(root, path, scope) {
  if (!root) return null;
  let cur = { node: root, scope };
  for (const i of path) {
    const kids = childrenOf(cur.node, cur.scope);
    if (!kids[i]) return null;
    cur = { node: kids[i].node, scope: kids[i].scope };
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Import maintenance for inserts / removes.
// ---------------------------------------------------------------------------

/**
 * Add named / default bindings for `module`, merging into an existing import
 * when there is one. Add-if-absent, so re-applying is a no-op.
 *
 * Reads the AST directly rather than `extract.mjs`'s `readImports`: that survey
 * feeds the UI's "what is in scope", while this needs the actual nodes to splice
 * into.
 *
 * @param {string} fileText
 * @param {{module: string, named?: string[], default?: string}} spec
 * @returns {InjectResult}
 */
export function insertImport(fileText, spec) {
  const sf = parse(fileText);
  const wantNamed = spec.named ?? [];

  // EVERY part of this statement is interpolated into source, so every part is
  // validated first. Unvalidated, a module of `./m'; evil(); import './n` wrote
  // `import { A } from './m'; evil(); import './n';` — a whole extra statement,
  // executed on the next reload — and a named specifier could do the same by
  // closing the brace. `isIdent` and the module rule below are the only reason
  // the template below is safe to build by concatenation.
  for (const n of wantNamed) {
    if (!isIdent(n)) {
      return { located: false, text: fileText, reason: `invalid import specifier: ${n}` };
    }
  }
  if (spec.default !== undefined && !isIdent(spec.default)) {
    return { located: false, text: fileText, reason: `invalid default binding: ${spec.default}` };
  }
  // A module specifier is freer than an identifier (slashes, dots, scopes), so
  // it is constrained by what would ESCAPE the quotes rather than by a grammar.
  if (typeof spec.module !== 'string' || !spec.module || /["'`\\\r\n]/.test(spec.module)) {
    return { located: false, text: fileText, reason: `invalid module specifier: ${spec.module}` };
  }

  /** @type {ts.ImportDeclaration | null} */
  let target = null;
  for (const st of sf.statements) {
    if (
      ts.isImportDeclaration(st) &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.moduleSpecifier.text === spec.module
    ) {
      target = st;
      break;
    }
  }

  if (target) {
    const clause = target.importClause;
    const nb = clause?.namedBindings;
    // `import type { Foo } from './m'` is a TYPE-ONLY statement: everything it
    // brings in is erased at compile time. Merging a value binding into it
    // produced `import type { Foo, bar }`, where `bar` is undefined at run time
    // — worse than a missing import, because it typechecks.
    if (clause?.isTypeOnly) {
      return {
        located: false,
        text: fileText,
        reason: 'refusing to add a value binding to a type-only import',
      };
    }
    // The two bindings are decided INDEPENDENTLY and spliced together. Treating
    // "an import for this module exists" as "already imported" answered
    // `located: false, 'already imported'` to a request for a default binding
    // the file did not have — a refusal that reads as a no-op, so the caller
    // omits an import it needs and the consumer's build breaks.
    /** @type {{start: number, end: number, text: string}[]} */
    const splices = [];

    if (spec.default) {
      if (clause?.name) {
        const existing = clause.name.getText();
        if (existing !== spec.default) {
          return {
            located: false,
            text: fileText,
            reason: `module already has a different default binding (${existing})`,
          };
        }
      } else if (clause) {
        // `import { A } from 'm'` / `import * as X from 'm'` — a default may sit
        // in front of either form.
        const at = clause.getStart(sf);
        splices.push({ start: at, end: at, text: `${spec.default}, ` });
      } else {
        // `import 'm'` — a side-effect import has no clause to extend.
        return { located: false, text: fileText, reason: 'unsupported import form' };
      }
    }

    if (wantNamed.length) {
      if (nb && ts.isNamedImports(nb)) {
        const have = new Set(nb.elements.map((e) => e.name.getText()));
        const add = wantNamed.filter((n) => !have.has(n));
        if (add.length) {
          const last = nb.elements[nb.elements.length - 1];
          if (last) {
            const at = last.getEnd();
            splices.push({ start: at, end: at, text: `, ${add.join(', ')}` });
          } else {
            // `import {} from 'm'` — an EMPTY group is legal input, and it has
            // no element for a new name to follow. The comma-first splice used
            // for a populated group emitted `import {, B }`, which does not
            // parse. Sit just inside the brace instead, with no comma.
            const at = nb.getStart(sf) + 1;
            splices.push({ start: at, end: at, text: ` ${add.join(', ')} ` });
          }
        }
      } else if (nb) {
        // A namespace import (`import * as X`) has no named group to merge into;
        // reshaping it is not this function's call. This also covers
        // `import D, * as X`, where appending `, { A }` after the default would
        // have produced the illegal `import D, { A }, * as X`.
        return { located: false, text: fileText, reason: 'unsupported import form' };
      } else if (clause?.name) {
        // Default-only import: add a named group after it.
        const at = clause.name.getEnd();
        splices.push({ start: at, end: at, text: `, { ${wantNamed.join(', ')} }` });
      } else {
        return { located: false, text: fileText, reason: 'unsupported import form' };
      }
    }

    if (!splices.length) return { located: false, text: fileText, reason: 'already imported' };
    let out = fileText;
    for (const s of splices.sort((a, b) => b.start - a.start)) {
      out = spliceSpan(out, s.start, s.end, s.text);
    }
    return { located: true, text: out };
  }

  const parts = [];
  if (spec.default) parts.push(spec.default);
  if (wantNamed.length) parts.push(`{ ${wantNamed.join(', ')} }`);
  if (!parts.length) return { located: false, text: fileText, reason: 'nothing to import' };

  const nl = fileText.includes('\r\n') ? '\r\n' : '\n';
  const stmt = `import ${parts.join(', ')} from '${spec.module}';`;
  const imports = sf.statements.filter((s) => ts.isImportDeclaration(s));
  if (imports.length) {
    // On its own line after the last existing import.
    const at = imports[imports.length - 1].getEnd();
    return { located: true, text: spliceSpan(fileText, at, at, `${nl}${stmt}`) };
  }
  return { located: true, text: spliceSpan(fileText, 0, 0, `${stmt}${nl}`) };
}

/**
 * Drop named bindings for `module` — but ONLY when no other reference to the
 * identifier remains in the file.
 *
 * That check is not optional politeness. A stray unused import is harmless; a
 * MISSING import breaks the build, and a layout remove that deleted one of two
 * usages would do exactly that.
 *
 * @param {string} fileText
 * @param {{module: string, named?: string[], default?: string}} spec
 * @returns {InjectResult}
 */
export function removeImport(fileText, spec) {
  const sf = parse(fileText);
  /** @type {ts.ImportDeclaration | null} */
  let target = null;
  for (const st of sf.statements) {
    if (
      ts.isImportDeclaration(st) &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.moduleSpecifier.text === spec.module
    ) {
      target = st;
      break;
    }
  }
  if (!target) return { located: false, text: fileText, reason: `no import of ${spec.module}` };

  /**
   * Is `name` still referenced anywhere outside the import statements?
   *
   * @param {string} name
   */
  const stillUsed = (name) => {
    let used = false;
    /** @param {ts.Node} n */
    const visit = (n) => {
      if (used || ts.isImportDeclaration(n)) return;
      if (ts.isIdentifier(n) && n.getText() === name) {
        used = true;
        return;
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(sf, visit);
    return used;
  };

  const nb = target.importClause?.namedBindings;
  const wanted = new Set(spec.named ?? []);
  if (!nb || !ts.isNamedImports(nb) || !wanted.size) {
    return { located: false, text: fileText, reason: 'nothing removable' };
  }
  const drop = nb.elements.filter(
    (e) => wanted.has(e.name.getText()) && !stillUsed(e.name.getText()),
  );
  if (!drop.length) return { located: false, text: fileText, reason: 'still referenced elsewhere' };

  if (drop.length === nb.elements.length && !target.importClause?.name) {
    // The whole statement goes.
    return { located: true, text: removeNodeLine(fileText, sf, target) };
  }
  let out = fileText;
  for (const el of [...drop].sort((a, b) => b.getStart(sf) - a.getStart(sf))) {
    let start = el.getStart(sf);
    let end = el.getEnd();
    while (end < out.length && /[,\s]/.test(out[end]) && out[end] !== '\n') end++;
    if (start > 0 && /,/.test(out[start - 1])) start--;
    out = spliceSpan(out, start, end, '');
  }
  return { located: true, text: out };
}

// ---------------------------------------------------------------------------
// Multi-hunk unified diff.
//
// Some edits are genuinely non-contiguous: creating a semantic token touches the
// type literal, the `light` map and the `dark` map — three insertions ~70 lines
// apart. A single-region diff has to span all of them, so a review modal ends up
// showing the entire middle of the file as one "changed" block. This trims the
// common prefix/suffix, runs an LCS over what is left, and emits one hunk per
// cluster of changes.
// ---------------------------------------------------------------------------

/** Cap on the LCS table; beyond this we degrade to a single coarse hunk. */
const LCS_CELL_LIMIT = 4_000_000;

/**
 * Line ops between two arrays via LCS backtracking.
 *
 * @param {string[]} a
 * @param {string[]} b
 * @returns {{t: ' '|'-'|'+', line: string}[]}
 */
function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i…] and b[j…]
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  /** @type {{t: ' '|'-'|'+', line: string}[]} */
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: ' ', line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: '-', line: a[i++] });
    } else {
      ops.push({ t: '+', line: b[j++] });
    }
  }
  while (i < n) ops.push({ t: '-', line: a[i++] });
  while (j < m) ops.push({ t: '+', line: b[j++] });
  return ops;
}

/**
 * A compact unified-diff-style rendering for display.
 *
 * @param {string} before
 * @param {string} after
 * @param {number} [context]
 * @returns {string}
 */
export function unifiedDiff(before, after, context = 2) {
  if (before === after) return '';
  const a = before.split('\n');
  const b = after.split('\n');

  // Trim the identical head/tail — usually the bulk of the file.
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let ea = a.length - 1;
  let eb = b.length - 1;
  while (ea >= p && eb >= p && a[ea] === b[eb]) {
    ea--;
    eb--;
  }

  const midA = a.slice(p, ea + 1);
  const midB = b.slice(p, eb + 1);

  /** @type {{t: ' '|'-'|'+', line: string}[]} */
  let ops;
  if (midA.length * midB.length > LCS_CELL_LIMIT) {
    // Pathologically large rewrite — one coarse hunk beats spending seconds here.
    ops = [
      ...midA.map((line) => /** @type {const} */ ({ t: '-', line })),
      ...midB.map((line) => /** @type {const} */ ({ t: '+', line })),
    ];
  } else {
    ops = lcsOps(midA, midB);
  }

  // Re-attach the trimmed context as unchanged ops so hunk grouping is uniform.
  const all = [
    ...a.slice(0, p).map((line) => /** @type {const} */ ({ t: ' ', line })),
    ...ops,
    ...a.slice(ea + 1).map((line) => /** @type {const} */ ({ t: ' ', line })),
  ];

  const changed = all.map((o, i) => (o.t === ' ' ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return '';

  // Group changes within 2×context of each other into one hunk.
  /** @type {[number, number][]} */
  const hunks = [[changed[0], changed[0]]];
  for (const i of changed.slice(1)) {
    const last = hunks[hunks.length - 1];
    if (i - last[1] <= context * 2 + 1) last[1] = i;
    else hunks.push([i, i]);
  }

  /** @type {string[]} */
  const out = [];
  hunks.forEach(([from, to], h) => {
    if (h > 0) out.push('  ⋯');
    const start = Math.max(0, from - context);
    const end = Math.min(all.length - 1, to + context);
    for (let i = start; i <= end; i++) out.push(`${all[i].t} ${all[i].line}`);
  });
  return out.join('\n');
}

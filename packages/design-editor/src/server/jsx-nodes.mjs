// @ts-check
/**
 * jsx-nodes.mjs — THE JSX node model.
 *
 * One definition of "what a node is" and "which child is index 2", shared by
 * three consumers that must agree byte-for-byte:
 *
 *   1. `extract.mjs`  — emits `SceneMeta` (what the client's outline shows)
 *   2. `inject.mjs`   — resolves a `NodeAnchor` (what a write targets)
 *   3. the `data-wb-node` stamping transform (CP3 — what a click resolves to)
 *
 * Three implementations of numbering would drift, and the drift would surface as
 * an edit landing on the wrong node — silently. So it lives here once.
 *
 * A NODE is a JSX element in the SOURCE AST (`JsxElement` |
 * `JsxSelfClosingElement` | a returned `JsxFragment` root). It is not a DOM node,
 * not a React element, not a fiber. One source node maps to 0..N rendered DOM
 * nodes: zero behind a falsy conditional, N inside a `.map()`.
 */
import { createHash } from 'node:crypto';
import ts from 'typescript';

export function parse(fileText, fileName = 'source.tsx') {
  return ts.createSourceFile(fileName, fileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/**
 * Attributes whose VALUES enter the fingerprint. Chosen because a layout edit
 * never changes a *sibling's* identity, so sibling anchors survive our writes.
 * `className` is deliberately absent — see `fpOf`.
 */
export const IDENTITY_ATTRS = [
  'to', 'href', 'id', 'name', 'htmlFor', 'type', 'value',
  'data-testid', 'aria-label', 'role', 'key',
];

/** Iteration methods whose callback body is an `iteration` scope. */
const ITERATION_METHODS = new Set(['map', 'flatMap', 'filter', 'forEach', 'reduce']);

const isElement = (n) => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n);

/**
 * The synthetic root of a walkable function: its returned JSX expressions, in
 * source order.
 *
 * WHY A SYNTHETIC ROOT. A component routinely has several returns —
 * `if (loading) return <Loader/>` before the main render. `SheetView` does
 * exactly this, and taking "the first return" as the root reduced a 1648-line
 * component to a single `<Loader/>` node. All of those returns are legitimate,
 * separately-editable render outputs.
 *
 * Making the container synthetic and ALWAYS present buys one path convention
 * instead of two: `[0]` is the first return's JSX whether the function has one
 * return or five. A shape that collapsed to the bare element for a single return
 * would renumber every path in the file the day someone added a guard clause.
 *
 * The container itself (`path: []`) is not editable — there are no attributes on
 * a return list, and you cannot splice a JSX child into one.
 */
const returnsRoot = (jsx) => ({ __wbReturns: true, jsx });
export const isReturnsRoot = (n) => !!n && n.__wbReturns === true;

/** Tag name as written: `div`, `Link`, `Card.Header`. A fragment is `<>`. */
export function tagOf(node) {
  if (isReturnsRoot(node)) return '#returns';
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return '<>';
}

/** The JSX attribute list, or an empty array for a fragment / returns root. */
function attrPropsOf(node) {
  if (isReturnsRoot(node)) return [];
  if (ts.isJsxElement(node)) return node.openingElement.attributes.properties;
  if (ts.isJsxSelfClosingElement(node)) return node.attributes.properties;
  return [];
}

/**
 * Attribute names (spreads as `...`), the values of `IDENTITY_ATTRS`, and the
 * `className` string literal when there is one.
 *
 * @returns {{names: string[], identity: Record<string, string>, className: string | null}}
 */
export function attrsOf(node) {
  const names = [];
  /** @type {Record<string, string>} */
  const identity = {};
  let className = null;

  for (const p of attrPropsOf(node)) {
    if (ts.isJsxSpreadAttribute(p)) {
      names.push('...');
      continue;
    }
    if (!ts.isJsxAttribute(p)) continue;
    const name = p.name.getText();
    names.push(name);

    const init = p.initializer;
    let text = null;
    if (!init) text = 'true'; // bare boolean attribute
    else if (ts.isStringLiteral(init)) text = init.text;
    else if (ts.isJsxExpression(init) && init.expression) text = init.expression.getText();

    if (name === 'className') {
      const lit = classLiteralOf(node);
      className = lit ? lit.text : null;
    }
    if (IDENTITY_ATTRS.includes(name) && text != null) identity[name] = text;
  }
  return { names, identity, className };
}

/**
 * The string-literal node holding `className`'s classes, or null.
 *
 * `className="a b"` and `className={"a b"}` resolve directly. For
 * `className={cn("a b", other)}` we take the FIRST string literal inside the
 * expression — that is the authored class blob in every shadcn/`cn()` call in
 * this codebase, and editing anything else would be a guess.
 */
export function classLiteralOf(node) {
  for (const p of attrPropsOf(node)) {
    if (!ts.isJsxAttribute(p) || p.name.getText() !== 'className') continue;
    const init = p.initializer;
    if (!init) return null;
    if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return init;
    if (!ts.isJsxExpression(init) || !init.expression) return null;
    let found = null;
    const visit = (n) => {
      if (found) return;
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
        found = n;
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(init.expression);
    return found;
  }
  return null;
}

/** Concatenated direct `JsxText` children, whitespace-collapsed. */
export function directTextOf(node) {
  if (isReturnsRoot(node)) return '';
  if (!ts.isJsxElement(node) && !ts.isJsxFragment(node)) return '';
  return node.children
    .filter((c) => ts.isJsxText(c))
    .map((c) => c.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Child numbering — the load-bearing part
// ---------------------------------------------------------------------------

/**
 * Numbered children of `node`, each with the scope it sits in.
 *
 * Numbered:      JSX elements, and JSX reachable through an expression child.
 * NOT numbered:  `JsxText`, comments, and expressions that yield no JSX.
 * Transparent:   fragments — their children number into THIS list, because a
 *                fragment has no rendered presence and wrapping one must not
 *                renumber a whole subtree.
 *
 * Expression children are descended into on purpose: `{cond && <div/>}` and
 * `{items.map(d => <Row/>)}` are how most of this codebase renders, and a
 * walker that skipped them would leave the majority of every page unaddressable.
 *
 * Each record carries its `owner`: the direct member of the parent's child list
 * through which the node was reached. For a plain `<div/>` child the owner IS
 * the node; for `{cond && <div/>}` the owner is the whole `{…}` expression.
 * Splice offsets must be taken from the OWNER — inserting after the `<div/>`
 * inside `{cond && <div/>}` would land before the `}` and produce a syntax
 * error. `owner !== node` is also what makes a node structurally read-only:
 * deleting the element out of `{cond && <div/>}` would leave a bare `{}`, and
 * deleting the whole expression would silently drop the condition.
 *
 * @returns {{node: ts.Node, owner: ts.Node, scope: 'static'|'iteration'|'callback'}[]}
 */
export function childrenOf(node, parentScope = 'static') {
  /** @type {{node: ts.Node, owner: ts.Node, scope: 'static'|'iteration'|'callback'}[]} */
  const out = [];
  if (isReturnsRoot(node)) {
    // Each returned expression contributes its JSX: a returned fragment is
    // transparent, a returned ternary contributes BOTH branches as distinct
    // source nodes.
    for (const j of node.jsx) pushExpr(j, parentScope, out, j);
    return out;
  }
  if (!ts.isJsxElement(node) && !ts.isJsxFragment(node)) return out;
  for (const c of node.children) pushChild(c, parentScope, out, c);
  return out;
}

function pushChild(c, scope, out, owner) {
  if (isElement(c)) {
    out.push({ node: c, owner, scope });
    return;
  }
  if (ts.isJsxFragment(c)) {
    for (const g of c.children) pushChild(g, scope, out, owner);
    return;
  }
  if (ts.isJsxExpression(c) && c.expression) pushExpr(c.expression, scope, out, owner);
}

/**
 * Collect JSX reachable from an expression, tracking the scope transition.
 *
 * Handled shapes, all of which occur in this repo: parenthesised, `&&`/`||`,
 * ternary (BOTH branches are distinct source nodes and both get an index), and
 * a call with an inline function argument (`.map(d => …)`). Anything else — a
 * bare identifier, a member access, a call with only a function *reference* —
 * contributes no numbered node here. That is not a gap: for
 * `items.map(renderRow)` the JSX lives in `renderRow`, which `findJsxRoots`
 * exposes as its OWN walkable root where it is `static` and fully editable.
 */
function pushExpr(expr, scope, out, owner) {
  if (isElement(expr)) {
    out.push({ node: expr, owner: owner ?? expr, scope });
    return;
  }
  if (ts.isJsxFragment(expr)) {
    for (const g of expr.children) pushChild(g, scope, out, owner ?? expr);
    return;
  }
  if (ts.isParenthesizedExpression(expr)) return pushExpr(expr.expression, scope, out, owner);
  if (ts.isBinaryExpression(expr)) {
    pushExpr(expr.left, scope, out, owner);
    pushExpr(expr.right, scope, out, owner);
    return;
  }
  if (ts.isConditionalExpression(expr)) {
    pushExpr(expr.whenTrue, scope, out, owner);
    pushExpr(expr.whenFalse, scope, out, owner);
    return;
  }
  if (ts.isCallExpression(expr)) {
    const method = ts.isPropertyAccessExpression(expr.expression)
      ? expr.expression.name.getText()
      : '';
    // Crossing an inline function boundary demotes the scope, and it never
    // recovers: structural ops are refused below `static` (see `resolveNode`).
    const inner = scope !== 'static' ? scope : ITERATION_METHODS.has(method) ? 'iteration' : 'callback';
    for (const a of expr.arguments) {
      if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) pushFnBody(a, inner, out, owner);
    }
  }
}

function pushFnBody(fn, scope, out, owner) {
  if (!ts.isBlock(fn.body)) return pushExpr(fn.body, scope, out, owner);
  // Block body: collect `return <jsx>` at any depth WITHIN this function, but do
  // not descend into nested functions (their JSX belongs to their own scope).
  const visit = (n) => {
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) return;
    if (ts.isReturnStatement(n) && n.expression) pushExpr(n.expression, scope, out, owner);
    else ts.forEachChild(n, visit);
  };
  ts.forEachChild(fn.body, visit);
}

/**
 * One walkable root per JSX-returning function in the file — the component
 * itself PLUS local helpers like `renderRow`.
 *
 * This is what turns `items.map(renderRow)` from the most fragile case into a
 * supported one: `renderRow`'s JSX is `static` in its own root, so structural
 * ops work there normally.
 *
 * @returns {{roots: Record<string, ts.Node>, defaultExport: string | null}}
 */
export function findJsxRoots(sf) {
  /** @type {Record<string, ts.Node>} */
  const roots = {};
  let defaultExport = null;

  /**
   * EVERY JSX expression a function returns, in source order, wrapped in the
   * synthetic returns root. Returns nested inside callbacks (`useEffect`
   * cleanups, `.map` bodies) are skipped — they belong to their own scope, not
   * to this function's render output.
   */
  const rootJsxOf = (fn) => {
    if (!fn.body) return null;
    /** @type {ts.Node[]} */
    const returned = [];
    const take = (expr) => {
      const e = ts.isParenthesizedExpression(expr) ? expr.expression : expr;
      // Only expressions that actually contain JSX become returns; a
      // `return null` guard contributes nothing.
      const probe = [];
      pushExpr(e, 'static', probe);
      if (probe.length) returned.push(e);
    };
    if (!ts.isBlock(fn.body)) take(fn.body);
    else {
      const visit = (n) => {
        if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) return;
        if (ts.isReturnStatement(n) && n.expression) {
          take(n.expression);
          return;
        }
        ts.forEachChild(n, visit);
      };
      ts.forEachChild(fn.body, visit);
    }
    return returned.length ? returnsRoot(returned) : null;
  };

  const isExportDefault = (node) =>
    !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const root = rootJsxOf(node);
      if (root) {
        roots[node.name.getText()] = root;
        if (isExportDefault(node)) defaultExport = node.name.getText();
      }
    }
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        const init = d.initializer;
        if (!init) continue;
        const fn = ts.isArrowFunction(init) || ts.isFunctionExpression(init) ? init : null;
        if (!fn) continue;
        const root = rootJsxOf(fn);
        if (root) roots[d.name.getText()] = root;
      }
    }
    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
      defaultExport = node.expression.getText();
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { roots, defaultExport };
}

/**
 * @typedef {object} JsxEntry
 * @property {ts.Node} node
 * @property {number[]} path        Child-index path from the root. A HINT.
 * @property {string[]} ancestorTags
 * @property {string} tag
 * @property {'static'|'iteration'|'callback'} scope
 * @property {string} fp            Stable identity. Survives every edit to
 *                                  another node, but COLLIDES freely: two
 *                                  `<div className=…>` siblings are identical
 *                                  under it, by design.
 * @property {string} fpx           Extended identity: `fp` plus the sorted
 *                                  className tokens and the child tag sequence.
 *                                  Highly discriminating, but invalidated by an
 *                                  edit to THIS node. Used only as the first
 *                                  search key when the path hint fails.
 */

/**
 * Pre-order walk of one root, yielding every numbered node with its path and
 * fingerprint. The root itself is `path: []`.
 *
 * @returns {Generator<JsxEntry>}
 */
export function* walkJsx(sf, root, scope = 'static') {
  yield* walkNode(root, [], [], scope, root);
}

function* walkNode(node, path, ancestorTags, scope, owner) {
  const tag = tagOf(node);
  const { names, identity, className } = attrsOf(node);
  const kids = childrenOf(node, scope);
  const fp = fpOf({ ancestorTags, tag, attrNames: names, identity, text: directTextOf(node) });
  yield {
    node,
    owner,
    path,
    ancestorTags,
    tag,
    scope,
    fp,
    fpx: fpxOf(fp, className, kids.map((k) => tagOf(k.node))),
  };
  for (let i = 0; i < kids.length; i++) {
    yield* walkNode(kids[i].node, [...path, i], [...ancestorTags, tag], kids[i].scope, kids[i].owner);
  }
}

/**
 * The stable identity of a node.
 *
 * WHAT IS DELIBERATELY EXCLUDED IS THE WHOLE DESIGN:
 *
 *   - `className` CONTENT — it is the most-edited attribute. Including it would
 *     make every class edit invalidate its own anchor AND its own revert's
 *     anchor, since a revert resolves against the post-edit tree.
 *   - the CHILD TAG SEQUENCE — an insert changes the PARENT's sequence, so a
 *     second op on that parent in the same batch would find a stale fp.
 *   - SOURCE OFFSETS — invalidated by any edit above the node, including our own
 *     earlier intent in the same batch.
 *
 * `ancestorTags` (tag names, not indices) does not disambiguate identical
 * siblings — they share ancestors — but it blocks the more dangerous
 * cross-subtree false match, where an edit lands elsewhere in the tree entirely.
 */
export function fpOf({ ancestorTags, tag, attrNames, identity, text }) {
  const idStr = IDENTITY_ATTRS.map((a) => `${a}=${identity[a] ?? ''}`).join(';');
  const payload = [
    (ancestorTags ?? []).join('>'),
    tag,
    [...(attrNames ?? [])].sort().join(','),
    idStr,
    (text ?? '').trim().slice(0, 40),
  ].join('|');
  return createHash('sha1').update(payload).digest('hex').slice(0, 8);
}

/**
 * Extended identity: `fp` plus what `fp` deliberately omits.
 *
 * `fp` collides freely in real components — `SheetView` has four `<Suspense>`
 * siblings and two top-level `<div className=…>` returns that are all identical
 * under it, because className content and the child tag sequence are excluded
 * (they would make an edit invalidate its own anchor). That is correct for
 * VERIFYING a path hit, and useless for SEARCHING when the hint fails.
 *
 * `fpx` restores the omitted signal as a *search key only*. It is invalidated by
 * an edit to this node — but a path hint fails because something changed
 * ELSEWHERE, so `fpx` is normally still valid at exactly the moment it is
 * needed. When it is not, resolution falls through to the `fp` search. Adding it
 * introduces no new failure mode and turns most post-external-edit relocations
 * from "ambiguous, discard your edit" into a silent recovery.
 *
 * Class tokens are SORTED so a reorder does not invalidate it.
 */
export function fpxOf(fp, className, childTags) {
  const classes = (className ?? '').split(/\s+/).filter(Boolean).sort().join(' ');
  return createHash('sha1')
    .update([fp, classes, (childTags ?? []).join(',')].join('|'))
    .digest('hex')
    .slice(0, 8);
}

const samePath = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Resolve a `NodeAnchor` to a live AST node. Three steps, most precise first:
 *
 *   1. the `path` hint, verified by `tag` + `fp` — the overwhelmingly common case
 *   2. a unique `fpx` match  (high precision: includes classes + child tags)
 *   3. a unique `fp` match   (low precision, survives edits to this node)
 *
 * EVERY SEARCH STEP RESOLVES ONLY ON EXACTLY ONE MATCH. `login/page.tsx` has two
 * byte-identical `<span className="mx-2 opacity-50">·</span>` nodes; `SheetView`
 * has four identical `<Suspense>` siblings. Picking the first would write to the
 * wrong node silently — the worst failure this tool can have. Ambiguity is
 * treated as absence, and the reason carries the candidate paths so the UI can
 * offer "re-point this edit" rather than only "discard".
 *
 * `requireStatic` is the structural-op guard. It lives HERE, server-side, rather
 * than as a disabled button, because the client's `SceneMeta` can be stale — the
 * same reason `/validate` shares `composeIntents` with `/commit`.
 *
 * @param {ts.SourceFile} sf
 * @param {{component: string, path: number[], tag: string, fp: string, fpx?: string}} anchor
 * @param {{requireStatic?: boolean}} [opts]
 * @returns {{located: true, entry: JsxEntry, relocated: boolean} |
 *           {located: false, reason: string, candidates?: number[][], scope?: string}}
 */
export function resolveNode(sf, anchor, opts = {}) {
  const { roots } = findJsxRoots(sf);
  const root = roots[anchor.component];
  if (!root) {
    return { located: false, reason: `no JSX-returning function named ${anchor.component}` };
  }
  const entries = [...walkJsx(sf, root)];
  const at = entries.find((e) => samePath(e.path, anchor.path));

  let hit = null;
  let relocated = false;
  if (at && at.tag === anchor.tag && at.fp === anchor.fp) {
    hit = at;
  } else {
    const uniq = (list) => (list.length === 1 ? list[0] : null);
    hit =
      (anchor.fpx ? uniq(entries.filter((e) => e.fpx === anchor.fpx)) : null) ??
      uniq(entries.filter((e) => e.fp === anchor.fp));
    relocated = !!hit;
    if (!hit) {
      const matches = entries.filter((e) => e.fp === anchor.fp);
      const where = matches.length ? `: ${matches.map((m) => m.path.join('.')).join(', ')}` : '';
      return {
        located: false,
        reason:
          `node anchor no longer resolves (path ${anchor.path.join('.')}, <${anchor.tag}>, ` +
          `fp ${anchor.fp}; ${matches.length} candidate${matches.length === 1 ? '' : 's'}${where})`,
        candidates: matches.map((m) => m.path),
      };
    }
  }

  if (isReturnsRoot(hit.node)) {
    return {
      located: false,
      reason: 'the synthetic returns root is not editable — target one of its children',
    };
  }
  if (opts.requireStatic) {
    if (hit.scope !== 'static') {
      return {
        located: false,
        scope: hit.scope,
        reason:
          `structural edits are not supported inside ${hit.scope === 'iteration' ? 'an' : 'a'} ` +
          `${hit.scope} scope (<${hit.tag}> at ${hit.path.join('.')}); only layout-props is. ` +
          `Extract the row into a component or a render helper to restructure it.`,
      };
    }
    // A node reached through an expression container cannot be spliced: removing
    // the element would leave `{}`, and removing the container would drop the
    // condition. Its attributes are still editable.
    if (hit.owner !== hit.node) {
      return {
        located: false,
        reason:
          `structural edits are not supported for a conditionally-rendered node ` +
          `(<${hit.tag}> at ${hit.path.join('.')} sits inside a {…} expression); only layout-props is`,
      };
    }
  }
  return { located: true, entry: hit, relocated };
}

/** The node at `path` within `root`, or null. */
export function nodeAt(sf, root, path) {
  let node = root;
  let scope = 'static';
  for (const i of path) {
    const kids = childrenOf(node, scope);
    if (!kids[i]) return null;
    node = kids[i].node;
    scope = kids[i].scope;
  }
  return node;
}

export { ts };

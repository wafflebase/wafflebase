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

/**
 * How many times the surrounding source renders. `static` is once and is the
 * only scope where a structural edit is well-defined; the other two are reached
 * by crossing an inline function boundary and never recover.
 *
 * @typedef {'static'|'iteration'|'callback'} Scope
 */

/**
 * A member of a parent's numbered child list, with the scope it sits in and the
 * `owner` a splice offset must be taken from.
 *
 * @typedef {{node: ts.Node, owner: ts.Node, scope: Scope}} JsxChild
 */

/**
 * The synthetic container `returnsRoot` builds around the JSX expressions a
 * function returns. NOT a `ts.Node` — every reader has to test `isReturnsRoot`
 * before touching AST-only members, which is why it carries a discriminant.
 *
 * @typedef {{__wbReturns: true, jsx: ts.Node[]}} ReturnsRoot
 */

/**
 * Anything the walker can stand on: a real AST node, or the synthetic root.
 *
 * @typedef {ts.Node | ReturnsRoot} JsxRootNode
 */

/**
 * @param {string} fileText
 * @param {string} [fileName]
 */
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

/**
 * @param {ts.Node} n
 * @returns {n is ts.JsxElement | ts.JsxSelfClosingElement}
 */
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
/**
 * @param {ts.Node[]} jsx
 * @returns {ReturnsRoot}
 */
const returnsRoot = (jsx) => ({ __wbReturns: true, jsx });

/**
 * @param {unknown} n
 * @returns {n is ReturnsRoot}
 */
export const isReturnsRoot = (n) =>
  !!n && /** @type {ReturnsRoot} */ (n).__wbReturns === true;

/**
 * Tag name as written: `div`, `Link`, `Card.Header`. A fragment is `<>`.
 *
 * @param {JsxRootNode} node
 */
export function tagOf(node) {
  if (isReturnsRoot(node)) return '#returns';
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return '<>';
}

/**
 * The JSX attribute list, or an empty array for a fragment / returns root.
 *
 * @param {JsxRootNode} node
 * @returns {readonly ts.JsxAttributeLike[]}
 */
function attrPropsOf(node) {
  if (isReturnsRoot(node)) return [];
  if (ts.isJsxElement(node)) return node.openingElement.attributes.properties;
  if (ts.isJsxSelfClosingElement(node)) return node.attributes.properties;
  return [];
}

/**
 * Attribute names (spreads as `...`), the values of `IDENTITY_ATTRS`, the
 * `className` string literal when there is one, and — when the value is not
 * simply that literal — the expression it was written as.
 *
 * `className` and `classNameExpr` are SIBLINGS, not a union, and the pair is
 * what the UI reads:
 *
 * | `className` | `classNameExpr` | the node's class value is |
 * | --- | --- | --- |
 * | string | `null`   | a plain literal — fully editable |
 * | string | string   | a joiner call with an authored blob — `cn("p-2", x)`. The blob is editable; the rest is the author's |
 * | `null` | string   | LOCKED — an expression with no editable blob (`t("nav.home")`) |
 * | `null` | `null`   | no `className` attribute … OR a valueless one, see below |
 *
 * So `classNameExpr !== null` means "an expression exists", NOT "locked".
 * Locked is `className === null && classNameExpr !== null`.
 *
 * NOT COVERED BY THE PAIR: `<div className/>` and `<div className={}/>` have an
 * attribute with no value, so both fields are null and they read as row 4 — while
 * `applyClassRewrite` refuses them ("className is not a string literal"), because
 * its test is `findJsxAttribute && !classLiteralOf`. A UI that must mirror the
 * refusal exactly has to test `names.includes('className') && className === null`;
 * `classNameExpr` supplies the text to SHOW, not the decision. Both shapes are a
 * type error in any real consumer file and neither carries text worth showing,
 * which is why they are documented rather than given a third field.
 *
 * @param {JsxRootNode} node
 * @returns {{names: string[], identity: Record<string, string>, className: string | null, classNameExpr: string | null}}
 */
export function attrsOf(node) {
  /** @type {string[]} */
  const names = [];
  /** @type {Record<string, string>} */
  const identity = {};
  let className = null;
  let classNameExpr = null;
  let seenClassName = false;

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

    // FIRST `className` only. A duplicate attribute is a type error, not a parse
    // error, so `<div className={t("x")} className="p-2"/>` reaches here — and
    // `classLiteralOf` answers for the first one. Reading the expression off a
    // later attribute would pair one attribute's literal with another's
    // expression: "locked" about an editable node, or the reverse.
    if (name === 'className' && !seenClassName) {
      seenClassName = true;
      const lit = classLiteralOf(node);
      className = lit ? lit.text : null;
      classNameExpr = classExprTextOf(init, lit);
    }
    if (IDENTITY_ATTRS.includes(name) && text != null) identity[name] = text;
  }
  return { names, identity, className, classNameExpr };
}

/**
 * The DISPLAY half of `classLiteralOf`'s refusal: the `className` expression as
 * the author wrote it, or null when there is no expression to show.
 *
 * Derived from `classLiteralOf`'s own result rather than re-deciding what counts
 * as a literal, so the two cannot drift into disagreeing about the same
 * attribute. `className={"a b"}` is a braced literal: the expression IS the
 * literal that was returned, there is nothing in it the designer cannot edit, and
 * a read-only token showing `"a b"` beside an editable `a b` would be noise. It
 * therefore reads identically to the unbraced `className="a b"`, which is the
 * point — the braces are the author's punctuation, not a restriction.
 *
 * Returned VERBATIM, including newlines: a wrapped `cn(\n  "a b",\n  other,\n)`
 * comes back wrapped. It is source text, so the caller collapses it for a
 * single-line token rather than this losing the shape for everyone.
 *
 * @param {ts.JsxAttributeValue | undefined} init
 * @param {ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | null} lit
 * @returns {string | null}
 */
function classExprTextOf(init, lit) {
  if (!init || !ts.isJsxExpression(init) || !init.expression) return null;
  if (lit && unwrapParens(init.expression) === lit) return null;
  return init.expression.getText();
}

/**
 * Call names whose string arguments are class blobs.
 *
 * An ALLOWLIST, not "any call", because what this function returns is a REWRITE
 * TARGET: `inject.mjs` splices the class ops directly over the literal's span.
 * So naming the wrong literal is not a weak search key, it is Tailwind classes
 * written over something that was never classes — `className={t("nav.home")}`
 * becoming `className={t("flex gap-2")}`, with the translation key gone. The
 * AST cannot tell a class joiner from any other single-string call, so the
 * callee's NAME is the only signal available here.
 *
 * A consumer whose joiner is not on this list loses the class component of
 * `fpx` and gets "className is not a string literal" from a class rewrite — a
 * weaker key and a visible refusal, which is the safe half of the trade.
 */
const CLASS_JOINERS = new Set([
  'cn',
  'clsx',
  'classNames',
  'classnames',
  'cx',
  'twMerge',
  'twJoin',
]);

/**
 * `cn(…)` and `utils.cn(…)` both count — the import style is the consumer's.
 *
 * @param {ts.Expression} callee
 */
const isClassJoiner = (callee) =>
  (ts.isIdentifier(callee) && CLASS_JOINERS.has(callee.text)) ||
  (ts.isPropertyAccessExpression(callee) && CLASS_JOINERS.has(callee.name.text));

/**
 * `("a b")` → `"a b"`. Shared by `classLiteralOf` and `classExprTextOf` so that
 * "is this expression just the literal?" is answered the same way in both.
 *
 * @param {ts.Expression} e
 * @returns {ts.Expression}
 */
const unwrapParens = (e) => (ts.isParenthesizedExpression(e) ? unwrapParens(e.expression) : e);

/**
 * The string-literal node holding `className`'s classes, or null.
 *
 * `className="a b"` and `className={"a b"}` resolve directly. For
 * `className={cn("a b", other)}` we take the first string literal that is a
 * DIRECT ARGUMENT of a call to a KNOWN class joiner (`CLASS_JOINERS`).
 *
 * Directness is the whole guard. Descending into the expression instead finds
 * the first literal ANYWHERE, which for the idioms this repo is built on is not
 * the authored class blob at all:
 *
 *   cn({"is-open": open}, "base")     → "is-open", an object KEY
 *   clsx(a ? "yes" : "no", "base")    → "yes", one branch of a ternary
 *   cn(button({size:"sm"}), "base")   → "sm", a CVA VARIANT VALUE
 *
 * The last is the shadcn/CVA idiom this codebase is built on, so "the first
 * literal is the authored blob in every cn() call in this codebase" was false
 * for the codebase it named — before reaching the arbitrary consumer trees the
 * local-plugin pivot points this at.
 *
 * Anything not attributable to a direct position in a recognised joiner returns
 * null. That costs the class signal in `fpx`, weakening a search key, rather
 * than handing `inject.mjs` a confident pointer at a literal it would REWRITE.
 *
 * @param {JsxRootNode} node
 * @returns {ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | null}
 */
export function classLiteralOf(node) {
  /**
   * @param {ts.Node} n
   * @returns {ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | null}
   */
  const asLiteral = (n) =>
    ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n : null;

  for (const p of attrPropsOf(node)) {
    if (!ts.isJsxAttribute(p) || p.name.getText() !== 'className') continue;
    const init = p.initializer;
    if (!init) return null;
    const bare = asLiteral(init);
    if (bare) return bare;
    if (!ts.isJsxExpression(init) || !init.expression) return null;

    const expr = unwrapParens(init.expression);
    const direct = asLiteral(expr);
    if (direct) return direct;
    if (ts.isCallExpression(expr) && isClassJoiner(expr.expression)) {
      for (const arg of expr.arguments) {
        const lit = asLiteral(unwrapParens(arg));
        if (lit) return lit;
      }
    }
    return null;
  }
  return null;
}

/**
 * Concatenated direct `JsxText` children, whitespace-collapsed.
 *
 * @param {JsxRootNode} node
 */
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
 * @param {JsxRootNode} node
 * @param {Scope} [parentScope]
 * @returns {JsxChild[]}
 */
export function childrenOf(node, parentScope = 'static') {
  /** @type {JsxChild[]} */
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

/**
 * @param {ts.Node} c
 * @param {Scope} scope
 * @param {JsxChild[]} out
 * @param {ts.Node} owner
 */
function pushChild(c, scope, out, owner) {
  if (isElement(c)) {
    out.push({ node: c, owner, scope });
    return;
  }
  if (ts.isJsxFragment(c)) {
    // A fragment reached DIRECTLY is transparent for ownership as well as for
    // numbering: splicing a sibling in beside `<A/>` inside `<><A/><B/></>` is
    // legal JSX, and the offset has to come from `<A/>` itself — taking it from
    // the fragment would land the insert after `<B/>`. Forwarding the fragment
    // instead made every fragment child report `owner !== node`, so
    // `requireStatic` refused it AND blamed a `{…}` expression that is not there.
    // A fragment reached through `{…}` keeps that expression as the owner.
    for (const g of c.children) pushChild(g, scope, out, owner === c ? g : owner);
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
 *
 * @param {ts.Node} expr
 * @param {Scope} scope
 * @param {JsxChild[]} out
 * @param {ts.Node} [owner]
 */
function pushExpr(expr, scope, out, owner) {
  if (isElement(expr)) {
    out.push({ node: expr, owner: owner ?? expr, scope });
    return;
  }
  if (ts.isJsxFragment(expr)) {
    // Same rule as `pushChild`: `return <><A/><B/></>` reaches the fragment as
    // the returned expression itself (owner === expr), so its children own
    // themselves. `{cond && <>…</>}` reaches it through the `{…}` container,
    // which stays the owner because splicing there is genuinely unsafe.
    for (const g of expr.children) pushChild(g, scope, out, owner && owner !== expr ? owner : g);
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

/**
 * @param {ts.ArrowFunction | ts.FunctionExpression} fn
 * @param {Scope} scope
 * @param {JsxChild[]} out
 * @param {ts.Node} [owner]
 */
function pushFnBody(fn, scope, out, owner) {
  if (!ts.isBlock(fn.body)) return pushExpr(fn.body, scope, out, owner);
  // Block body: collect `return <jsx>` at any depth WITHIN this function, but do
  // not descend into nested functions (their JSX belongs to their own scope).
  /** @param {ts.Node} n */
  const visit = (n) => {
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) return;
    if (ts.isReturnStatement(n) && n.expression) pushExpr(n.expression, scope, out, owner);
    else ts.forEachChild(n, visit);
  };
  ts.forEachChild(fn.body, visit);
}

/**
 * Wrapper calls whose ARGUMENT is the component function.
 *
 * An allowlist, for the same reason `CLASS_JOINERS` is one. `useMemo(() =>
 * <div/>, [])` and `withRetry(() => <Spinner/>)` also hold an arrow returning
 * JSX, but that arrow is not the declared name's render output, and registering
 * it as one would key a root on a name that does not describe it. `forwardRef`
 * and `memo` are the two React wrappers where the argument genuinely IS the
 * component — and they are everywhere in shadcn/Radix code, which
 * `design-editor-audit.md` puts at the centre of the support matrix.
 */
const RENDER_WRAPPERS = new Set(['forwardRef', 'memo']);

/**
 * The component function `expr` denotes, seeing through the parentheses and
 * render wrappers that hold one. `memo(forwardRef((props, ref) => …))` nests in
 * practice, so the unwrap recurses.
 *
 * @param {ts.Expression} expr
 * @returns {ts.ArrowFunction | ts.FunctionExpression | null}
 */
function componentFnOf(expr) {
  if (ts.isParenthesizedExpression(expr)) return componentFnOf(expr.expression);
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return expr;
  if (!ts.isCallExpression(expr)) return null;
  const callee = expr.expression;
  const isWrapper =
    (ts.isIdentifier(callee) && RENDER_WRAPPERS.has(callee.text)) ||
    (ts.isPropertyAccessExpression(callee) && RENDER_WRAPPERS.has(callee.name.text));
  if (!isWrapper) return null;
  for (const a of expr.arguments) {
    const fn = componentFnOf(a);
    if (fn) return fn;
  }
  return null;
}

/**
 * Root name for a default export that has no identifier of its own.
 *
 * `default` is a reserved word, so no source identifier can collide with it —
 * the synthetic name cannot shadow a real component, by construction.
 */
const DEFAULT_ROOT = 'default';

/**
 * One walkable root per JSX-returning function in the file — the component
 * itself PLUS local helpers like `renderRow`.
 *
 * This is what turns `items.map(renderRow)` from the most fragile case into a
 * supported one: `renderRow`'s JSX is `static` in its own root, so structural
 * ops work there normally.
 *
 * A component reaches this map under three shapes, and MISSING one costs the
 * whole component: with no root, none of its nodes are walked, so nothing is
 * stamped, nothing appears in the outline, and a click inside it falls through
 * to whichever ancestor was stamped. The shapes are a function declaration, a
 * variable initialised to a function — through `RENDER_WRAPPERS` if it is
 * wrapped — and a default export with no name of its own, which keys on
 * `DEFAULT_ROOT`.
 *
 * `ambiguous` carries the names that more than one JSX-returning function in the
 * file claims. `visit` recurses over the whole file, so two components each
 * holding a local `const Row = () => <li/>` both register under `Row` and the
 * last one visited would otherwise silently replace the first — after which a
 * matching path and fingerprint resolve an anchor against a DIFFERENT function's
 * JSX. That is the same wrong-node-silently failure `resolveNode` already treats
 * ambiguity as absence to avoid, so the name is reported rather than resolved.
 *
 * @param {ts.SourceFile} sf
 * @returns {{roots: Record<string, JsxRootNode>, ambiguous: Set<string>,
 *            defaultExport: string | null}}
 */
export function findJsxRoots(sf) {
  // Null-prototype: component names are arbitrary source identifiers, and on a
  // plain `{}` the ones that collide with `Object.prototype` break all three
  // uses of this map. `name in roots` is true on FIRST sight of a `toString` or
  // `valueOf` component, so it is reported ambiguous and becomes permanently
  // unresolvable. `roots.__proto__ = root` hits the inherited accessor instead
  // of defining a key, so that root vanishes from `Object.keys` AND repoints
  // this object's prototype. And `roots[anchor.component]` returns an inherited
  // METHOD, which is truthy, so `resolveNode` walks a function instead of
  // answering "no JSX-returning function named …".
  /** @type {Record<string, JsxRootNode>} */
  const roots = Object.create(null);
  /** @type {Set<string>} */
  const ambiguous = new Set();
  /** @type {string | null} */
  let defaultExport = null;

  /**
   * EVERY JSX expression a function returns, in source order, wrapped in the
   * synthetic returns root. Returns nested inside callbacks (`useEffect`
   * cleanups, `.map` bodies) are skipped — they belong to their own scope, not
   * to this function's render output.
   *
   * @param {ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression} fn
   * @returns {ReturnsRoot | null}
   */
  const rootJsxOf = (fn) => {
    if (!fn.body) return null;
    /** @type {ts.Node[]} */
    const returned = [];
    /** @param {ts.Node} expr */
    const take = (expr) => {
      const e = ts.isParenthesizedExpression(expr) ? expr.expression : expr;
      // Only expressions that actually contain JSX become returns; a
      // `return null` guard contributes nothing.
      /** @type {JsxChild[]} */
      const probe = [];
      pushExpr(e, 'static', probe);
      if (probe.length) returned.push(e);
    };
    if (!ts.isBlock(fn.body)) take(fn.body);
    else {
      /** @param {ts.Node} n */
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

  /** @param {ts.FunctionDeclaration} node */
  const isExportDefault = (node) =>
    !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

  /**
   * @param {string} name
   * @param {ReturnsRoot} root
   */
  const addRoot = (name, root) => {
    if (name in roots) ambiguous.add(name);
    roots[name] = root;
  };

  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node)) {
      // `export default function () {}` is the one anonymous declaration the
      // grammar allows, and the only place the synthetic name is needed here.
      const name = node.name?.getText() ?? (isExportDefault(node) ? DEFAULT_ROOT : null);
      const root = name ? rootJsxOf(node) : null;
      if (name && root) {
        addRoot(name, root);
        if (isExportDefault(node)) defaultExport = name;
      }
    }
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (!d.initializer) continue;
        const fn = componentFnOf(d.initializer);
        if (!fn) continue;
        const root = rootJsxOf(fn);
        if (root) addRoot(d.name.getText(), root);
      }
    }
    if (ts.isExportAssignment(node)) {
      if (ts.isIdentifier(node.expression)) {
        // `export default Foo` — the root is already registered under `Foo` by
        // whichever branch declared it.
        defaultExport = node.expression.getText();
      } else {
        // `export default () => …`, or wrapped. The component has no name
        // anywhere in the file, so without the synthetic one it is a root that
        // cannot be addressed.
        const fn = componentFnOf(node.expression);
        const root = fn ? rootJsxOf(fn) : null;
        if (root) {
          addRoot(DEFAULT_ROOT, root);
          defaultExport = DEFAULT_ROOT;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { roots, ambiguous, defaultExport };
}

/**
 * @typedef {object} JsxEntry
 * @property {JsxRootNode} node     A `ts.Node` for every entry EXCEPT the root of
 *                                  a walk, which is the synthetic `ReturnsRoot`.
 *                                  `resolveNode` tests `isReturnsRoot(hit.node)`
 *                                  precisely because this can be either.
 * @property {JsxRootNode} owner    The direct member of the parent's child list
 *                                  through which `node` was reached. `owner !==
 *                                  node` marks the node structurally read-only —
 *                                  see `childrenOf`. Read by `resolveNode`.
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
 * `_sf` is unused and kept anyway: every public entry point in this module takes
 * the `SourceFile` first, and this one is a published API whose argument
 * positions three consumers already call by. Dropping it would be a breaking
 * change to buy nothing.
 *
 * @param {ts.SourceFile} _sf
 * @param {JsxRootNode} root
 * @param {Scope} [scope]
 * @returns {Generator<JsxEntry>}
 */
export function* walkJsx(_sf, root, scope = 'static') {
  yield* walkNode(root, [], [], scope, root);
}

/**
 * @param {JsxRootNode} node
 * @param {number[]} path
 * @param {string[]} ancestorTags
 * @param {Scope} scope
 * @param {JsxRootNode} owner
 * @returns {Generator<JsxEntry>}
 */
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
 *
 * `identity` is REQUIRED while the rest are not, which matches the body rather
 * than the symmetry: the other fields are read through `??`, `identity` is
 * indexed directly and omitting it throws. Typed as it behaves.
 *
 * @param {{ancestorTags?: string[], tag: string, attrNames?: string[],
 *          identity: Record<string, string>, text?: string}} parts
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
 *
 * @param {string} fp
 * @param {string | null} className
 * @param {string[]} [childTags]
 */
export function fpxOf(fp, className, childTags) {
  const classes = (className ?? '').split(/\s+/).filter(Boolean).sort().join(' ');
  return createHash('sha1')
    .update([fp, classes, (childTags ?? []).join(',')].join('|'))
    .digest('hex')
    .slice(0, 8);
}

/**
 * @param {number[]} a
 * @param {number[]} b
 */
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
 * `role` says what the anchor IS to the caller's op, because two of the three
 * guards depend on it:
 *
 *   - `'target'` (default) — the node itself is spliced into or out of a sibling
 *     list: `applyLayoutRemove`, or an insert-as-sibling. All three guards.
 *   - `'container'` — the node RECEIVES a child: `applyLayoutInsert`. Only the
 *     scope guard applies.
 *
 * Verified against the parser rather than assumed: a child spliced into a
 * returned root (`return <div><A/><NEW/></div>`) parses, and so does one spliced
 * into a conditionally-rendered element; a SIBLING beside a returned root
 * (`return <div/><NEW/>`) is a syntax error. The guards that exist to prevent
 * the third case were refusing the first two, which made
 * `applyLayoutRemove`'s inverse unapplicable for the commonest component shape
 * — a remove that succeeded and could not be undone.
 *
 * @param {ts.SourceFile} sf
 * @param {{component: string, path: number[], tag: string, fp: string, fpx?: string}} anchor
 * @param {{requireStatic?: boolean, role?: 'target'|'container'}} [opts]
 * @returns {{located: true, entry: JsxEntry, relocated: boolean} |
 *           {located: false, reason: string, candidates?: number[][], scope?: string}}
 */
export function resolveNode(sf, anchor, opts = {}) {
  const { roots, ambiguous } = findJsxRoots(sf);
  // Ambiguity is absence HERE TOO. A name two functions claim cannot say which
  // JSX an anchor belongs to, and guessing resolves against the wrong function's
  // tree without erroring anywhere.
  if (ambiguous.has(anchor.component)) {
    return {
      located: false,
      reason: `more than one JSX-returning function is named ${anchor.component}`,
    };
  }
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
    /** @param {JsxEntry[]} list */
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
    // The remaining two guards are about splicing THIS node into or out of a
    // sibling list. When it is only receiving a child, neither hazard exists —
    // the splice lands inside the node's own children region, which is why both
    // shapes parse. See the `role` note above.
    const asContainer = opts.role === 'container';

    // A node reached through an expression container cannot be spliced: removing
    // the element would leave `{}`, and removing the container would drop the
    // condition. Its attributes are still editable, and so are its children.
    if (!asContainer && hit.owner !== hit.node) {
      return {
        located: false,
        reason:
          `structural edits are not supported for a conditionally-rendered node ` +
          `(<${hit.tag}> at ${hit.path.join('.')} sits inside a {…} expression); only layout-props is`,
      };
    }
    // A RETURNED EXPRESSION has no sibling list to splice into. The children of
    // the synthetic returns root look like siblings to the path model, but in
    // source they are separate `return` statements: `[0]` and `[1]` of
    // `if (x) return <a/>; return <b/>;` are not adjacent to each other or to
    // anything else. Even with one return, adding a sibling yields
    // `return <div/><span/>;` — adjacent top-level JSX, which does not parse.
    //
    // The test is identity against `root.jsx`, NOT `path.length === 1`. A
    // returned FRAGMENT is transparent for numbering, so `return <><A/><B/></>`
    // puts A and B at depth 1 — and those two are real siblings inside a real
    // container, so splicing between them is legal and must stay allowed.
    //
    // Inserting a CHILD into a returned root is fine and is the commonest
    // structural op there is, which is what `role: 'container'` exempts. This
    // guard is only about the node itself joining or leaving a sibling list.
    if (!asContainer && isReturnsRoot(root) && root.jsx.includes(/** @type {ts.Node} */ (hit.node))) {
      return {
        located: false,
        reason:
          `structural edits are not supported for a top-level returned element ` +
          `(<${hit.tag}> at ${hit.path.join('.')} is a whole return value, not a child ` +
          `in a sibling list); only layout-props is. Wrap it to restructure around it.`,
      };
    }
  }
  return { located: true, entry: hit, relocated };
}

/**
 * The node at `path` within `root`, or null.
 *
 * `_sf` is unused, for the same published-signature reason as `walkJsx`.
 *
 * @param {ts.SourceFile} _sf
 * @param {JsxRootNode} root
 * @param {number[]} path
 * @returns {JsxRootNode | null}
 */
export function nodeAt(_sf, root, path) {
  let node = root;
  /** @type {Scope} */
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

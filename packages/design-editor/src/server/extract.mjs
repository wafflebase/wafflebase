// @ts-check
/**
 * extract.mjs — static analysis for the design editor, as an IMPORTABLE library.
 *
 * Two analyzers over the TypeScript compiler API (no extra deps — `typescript`
 * is already a workspace dependency):
 *
 *   `analyzeFile(path)`  — the component/CVA analysis: exported components, the
 *                          wrapped `cva(...)` broken down per variant value,
 *                          token + anti-pattern rollups.
 *   `analyzeScene(path)` — the JSX node tree for a whole route file.
 *
 * WHY THIS IS A LIBRARY AND NOT A SCRIPT. A script that writes to stdout at
 * import time cannot be called by the bridge, and the metadata has to be re-read
 * imperatively after every commit — an insertion renumbers every following
 * sibling, so a stale tree means the next save fails on all of them.
 *
 * THE SECOND CONSUMER of `jsx-nodes.mjs`, and the one a designer sees. The
 * injector resolves anchors with it and the stamper marks the DOM with it; this
 * builds the OUTLINE. Its `structuralEditable` flag is what enables or greys out
 * "insert sibling" and "remove" in the UI, so it is a PREDICTION of what
 * `resolveNode(…, {requireStatic: true})` will do — and a prediction that
 * disagrees with the server produces a control that invites a drag and then
 * refuses it. `test/server/extract.test.mjs` asserts the agreement node-by-node
 * rather than trusting the two rules to stay in step.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  attrsOf,
  childrenOf,
  directTextOf,
  findJsxRoots,
  fpOf,
  fpxOf,
  isReturnsRoot,
  parse,
  tagOf,
  ts,
} from './jsx-nodes.mjs';

/**
 * @typedef {import('./jsx-nodes.mjs').JsxRootNode} JsxRootNode
 * @typedef {import('./jsx-nodes.mjs').Scope} Scope
 */

/**
 * @typedef {{utility: string, role: string}} ColorBinding
 * @typedef {{category: string, utility: string, value: string, className: string}} ScaleBinding
 * @typedef {{tokensUsed: string[], colorBindings: ColorBinding[],
 *            scaleBindings: ScaleBinding[],
 *            antiPatterns: Record<string, string[]>}} ClassAnalysis
 */

// --- Token vocabulary --------------------------------------------------------
// The CSS-variable-backed Tailwind colors a shadcn/ui theme defines. A utility
// targeting one of these roles is "on token"; anything else is a candidate
// anti-pattern.
//
// This is the SHADCN vocabulary, not a wafflebase one — the same role names ship
// in a stock `npx shadcn init` theme — which is why it is hard-coded in the
// generic package rather than injected. A consumer with a different design
// language reads every one of its colors as an anti-pattern; when that becomes
// real, this is the list `TokenAdapter` supplies (local-plugin §6), and it is
// exported so a caller can already see what it was measured against.
export const SEMANTIC_ROLES = [
  'background', 'foreground', 'card', 'card-foreground',
  'popover', 'popover-foreground', 'primary', 'primary-foreground',
  'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
  'accent', 'accent-foreground', 'destructive', 'border', 'input', 'ring',
  'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-accent',
  'sidebar-border', 'sidebar-ring',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
];
const COLOR_UTILITIES = ['bg', 'text', 'border', 'ring', 'fill', 'stroke', 'from', 'to', 'via', 'outline', 'decoration', 'divide', 'shadow', 'accent'];

// --- Non-color scale tokens --------------------------------------------------
const FONT_SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'];
const RADIUS_VALUES = ['base', 'none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full'];
const SPACING_UTILS = ['p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'gap', 'gap-x', 'gap-y', 'space-x', 'space-y'];
const roundedRe = /^rounded(?:-(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|ee|es))?(?:-(.+))?$/;
const spacingRe = new RegExp(`^(${SPACING_UTILS.join('|')})-(\\[?[\\d.]+(?:px|rem|em)?\\]?)$`);
const fontSizeRe = /^text-(.+)$/;

/**
 * Strip Tailwind variant modifiers (`hover:`, `dark:`, `[a&]:hover:`, …).
 *
 * @param {string} cls
 */
function bareClass(cls) {
  return cls.includes(':') ? cls.slice(cls.lastIndexOf(':') + 1) : cls;
}

/**
 * Classify one class token as a non-color scale binding, or null.
 *
 * @param {string} cls
 * @returns {ScaleBinding | null}
 */
function detectScale(cls) {
  const bare = bareClass(cls);
  const r = bare.match(roundedRe);
  if (r) {
    const value = r[1] ?? 'base'; // bare `rounded` === base radius (--radius)
    if (RADIUS_VALUES.includes(value)) {
      return { category: 'radius', utility: bare.split('-').slice(0, -1).join('-') || 'rounded', value, className: cls };
    }
  }
  const s = bare.match(spacingRe);
  if (s) return { category: 'spacing', utility: s[1], value: s[2], className: cls };
  const f = bare.match(fontSizeRe);
  if (f && FONT_SIZES.includes(f[1])) return { category: 'fontSize', utility: 'text', value: f[1], className: cls };
  return null;
}

const TW_PALETTE = 'zinc|slate|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const TW_NAMED_HARDCODED = 'white|black';

const util = `(?:${COLOR_UTILITIES.join('|')})`;
// Longest role first: `primary-foreground` must win over `primary`, which the
// alternation would otherwise match at the same start offset.
const ROLES_BY_LEN = [...SEMANTIC_ROLES].sort((a, b) => b.length - a.length);
const tokenRe = new RegExp(`\\b${util}-(${ROLES_BY_LEN.join('|')})(?:/\\d+)?\\b`, 'g');
const utilCapture = `(${COLOR_UTILITIES.join('|')})`;
const bindingRe = new RegExp(`\\b${utilCapture}-(${ROLES_BY_LEN.join('|')})(?:/\\d+)?\\b`, 'g');
const paletteRe = new RegExp(`\\b${util}-(?:${TW_PALETTE})-\\d{2,3}\\b`, 'g');
const namedColorRe = new RegExp(`\\b${util}-(?:${TW_NAMED_HARDCODED})\\b(?:/\\d+)?`, 'g');
const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
const rgbRe = /\b(?:rgb|rgba|hsl|hsla)\([^)]*\)/g;
const arbPxRe = /\b[a-z-]+-\[\d+px\]/g;

const ANTI_KEYS = /** @type {const} */ ([
  'hardcodedPaletteColors',
  'hardcodedNamedColors',
  'hexLiterals',
  'rgbHslLiterals',
  'arbitraryPx',
]);

/**
 * Stable de-dupe key + sort order for a color binding.
 *
 * @param {ColorBinding} b
 */
const bindingKey = (b) => `${b.utility}:${b.role}`;
/**
 * @param {ColorBinding} a
 * @param {ColorBinding} b
 */
const byBinding = (a, b) => a.utility.localeCompare(b.utility) || a.role.localeCompare(b.role);

/** @param {ScaleBinding} b */
const scaleKey = (b) => `${b.category}:${b.className}`;
const CATEGORY_ORDER = ['radius', 'spacing', 'fontSize'];
/**
 * @param {ScaleBinding} a
 * @param {ScaleBinding} b
 */
const byScale = (a, b) =>
  CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
  a.className.localeCompare(b.className);

/** @param {string} s */
const unquote = (s) => s.replace(/^["']|["']$/g, '');

/**
 * Best-effort literal text of a string / no-subst / template node.
 *
 * @param {ts.Node | undefined} node
 * @returns {string}
 */
function literalText(node) {
  if (!node) return '';
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' ');
  }
  return '';
}

/**
 * Collect every string-literal (incl. template) text under a node.
 *
 * @param {ts.Node} node
 * @returns {string[]}
 */
function collectStringLiterals(node) {
  /** @type {string[]} */
  const out = [];
  /** @param {ts.Node} n */
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      out.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/**
 * Extract token usage + anti-patterns from a blob of class strings.
 *
 * @param {string[]} strings
 * @returns {ClassAnalysis}
 */
export function analyzeClasses(strings) {
  /** @type {Set<string>} */
  const tokens = new Set();
  /** @type {Map<string, ColorBinding>} */
  const bindings = new Map();
  /** @type {Map<string, ScaleBinding>} */
  const scales = new Map();
  /** @type {Record<string, Set<string>>} */
  const anti = Object.fromEntries(ANTI_KEYS.map((k) => [k, new Set()]));
  for (const s of strings) {
    for (const m of s.matchAll(tokenRe)) tokens.add(m[1]);
    for (const m of s.matchAll(bindingRe)) {
      const b = { utility: m[1], role: m[2] };
      bindings.set(bindingKey(b), b);
    }
    for (const cls of s.split(/\s+/).filter(Boolean)) {
      const scale = detectScale(cls);
      if (scale) scales.set(scaleKey(scale), scale);
    }
    for (const m of s.matchAll(paletteRe)) anti.hardcodedPaletteColors.add(m[0]);
    for (const m of s.matchAll(namedColorRe)) anti.hardcodedNamedColors.add(m[0]);
    for (const m of s.matchAll(hexRe)) anti.hexLiterals.add(m[0]);
    for (const m of s.matchAll(rgbRe)) anti.rgbHslLiterals.add(m[0]);
    for (const m of s.matchAll(arbPxRe)) anti.arbitraryPx.add(m[0]);
  }
  return {
    tokensUsed: [...tokens].sort(),
    colorBindings: [...bindings.values()].sort(byBinding),
    scaleBindings: [...scales.values()].sort(byScale),
    antiPatterns: Object.fromEntries(ANTI_KEYS.map((k) => [k, [...anti[k]].sort()])),
  };
}

/**
 * Union several analyses into one.
 *
 * @param {Partial<ClassAnalysis>[]} list
 * @returns {ClassAnalysis}
 */
export function mergeAnalyses(list) {
  /** @type {Set<string>} */
  const tokens = new Set();
  /** @type {Map<string, ColorBinding>} */
  const bindings = new Map();
  /** @type {Map<string, ScaleBinding>} */
  const scales = new Map();
  /** @type {Record<string, Set<string>>} */
  const anti = Object.fromEntries(ANTI_KEYS.map((k) => [k, new Set()]));
  for (const a of list) {
    for (const t of a.tokensUsed || []) tokens.add(t);
    for (const b of a.colorBindings || []) bindings.set(bindingKey(b), b);
    for (const b of a.scaleBindings || []) scales.set(scaleKey(b), b);
    for (const k of ANTI_KEYS) for (const x of a.antiPatterns?.[k] || []) anti[k].add(x);
  }
  return {
    tokensUsed: [...tokens].sort(),
    colorBindings: [...bindings.values()].sort(byBinding),
    scaleBindings: [...scales.values()].sort(byScale),
    antiPatterns: Object.fromEntries(ANTI_KEYS.map((k) => [k, [...anti[k]].sort()])),
  };
}

/**
 * Parse a `cva(base, { variants, defaultVariants })` call into a per-value
 * breakdown. Reading each value's initializer directly (instead of scraping
 * every string literal in the call) keeps `defaultVariants` values like
 * `"default"` out of the class analysis.
 *
 * @param {ts.CallExpression} call
 */
function parseCvaCall(call) {
  const [baseArg, configArg] = call.arguments;
  const baseClasses = literalText(baseArg);
  const base = { classes: baseClasses, ...analyzeClasses([baseClasses]) };

  /** @type {Record<string, Record<string, {classes: string} & ClassAnalysis>>} */
  const axes = {};
  /** @type {Record<string, string>} */
  const defaults = {};

  if (configArg && ts.isObjectLiteralExpression(configArg)) {
    for (const prop of configArg.properties) {
      if (!ts.isPropertyAssignment(prop) || !prop.name) continue;
      const key = unquote(prop.name.getText());
      if (key === 'variants' && ts.isObjectLiteralExpression(prop.initializer)) {
        for (const axis of prop.initializer.properties) {
          if (!ts.isPropertyAssignment(axis) || !ts.isObjectLiteralExpression(axis.initializer)) continue;
          /** @type {Record<string, {classes: string} & ClassAnalysis>} */
          const values = {};
          for (const v of axis.initializer.properties) {
            if (!ts.isPropertyAssignment(v)) continue;
            const classes = literalText(v.initializer);
            values[unquote(v.name.getText())] = { classes, ...analyzeClasses([classes]) };
          }
          axes[unquote(axis.name.getText())] = values;
        }
      } else if (key === 'defaultVariants' && ts.isObjectLiteralExpression(prop.initializer)) {
        for (const d of prop.initializer.properties) {
          if (ts.isPropertyAssignment(d)) defaults[unquote(d.name.getText())] = unquote(d.initializer.getText());
        }
      }
    }
  }

  const perValue = Object.values(axes).flatMap((vals) => Object.values(vals));
  const aggregate = mergeAnalyses([base, ...perValue]);
  return { base, axes, defaults, aggregate };
}

/**
 * Pull explicit prop members + variant/native origins out of a props type node.
 *
 * @param {ts.TypeNode | undefined} typeNode
 */
function parsePropsType(typeNode) {
  /** @type {{name: string, type: string, optional: boolean, origin: string}[]} */
  const props = [];
  /** @type {string[]} */
  const notes = [];
  if (!typeNode) return { props, notes };

  const members = ts.isIntersectionTypeNode(typeNode) ? typeNode.types : [typeNode];
  for (const member of members) {
    if (ts.isTypeLiteralNode(member)) {
      for (const m of member.members) {
        if (ts.isPropertySignature(m) && m.name) {
          props.push({
            name: m.name.getText(),
            type: m.type ? m.type.getText() : 'unknown',
            optional: !!m.questionToken,
            origin: 'explicit',
          });
        }
      }
    } else if (ts.isTypeReferenceNode(member)) {
      const ref = member.typeName.getText();
      if (ref === 'VariantProps') notes.push('variant-props:' + member.getText());
      else notes.push('native:' + member.getText());
    }
  }
  return { props, notes };
}

/**
 * Component/CVA analysis for one source file.
 *
 * @param {string} filePath
 */
export function analyzeFile(filePath) {
  const src = readFileSync(filePath, 'utf8');
  const sf = parse(src, filePath);

  /** @type {Record<string, any>[]} */
  const components = [];
  /** @type {Record<string, ReturnType<typeof parseCvaCall>>} */
  const cvaDefs = {};

  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          decl.initializer &&
          ts.isCallExpression(decl.initializer) &&
          decl.initializer.expression.getText() === 'cva'
        ) {
          cvaDefs[decl.name.getText()] = parseCvaCall(decl.initializer);
        }
      }
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      const param = node.parameters[0];
      const { props, notes } = parsePropsType(param?.type);
      const bodyAnalysis = analyzeClasses(collectStringLiterals(node));
      components.push({
        name: node.name.getText(),
        kind: 'function',
        props,
        propOrigins: notes,
        _bodyAnalysis: bodyAnalysis,
      });
    }

    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        const init = decl.initializer;
        if (init && ts.isCallExpression(init) && init.expression.getText().endsWith('forwardRef')) {
          const fn = init.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
          const bodyAnalysis = analyzeClasses(fn ? collectStringLiterals(fn) : []);
          components.push({
            name: decl.name.getText(),
            kind: 'forwardRef',
            props: [],
            propOrigins: init.typeArguments ? init.typeArguments.map((t) => 'generic:' + t.getText()) : [],
            _bodyAnalysis: bodyAnalysis,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  /** @type {Set<string>} */
  const attached = new Set();
  for (const comp of components) {
    // Attachment is a TEXT heuristic (`buttonVariants({`) rather than a
    // resolved reference, so a component that never calls its cva but sits in
    // a file with one still claims it. Faithful to the shipped output shape;
    // the cost is a wrong `cva` attribution in the panel, never a wrong write.
    const refd = Object.keys(cvaDefs).find((name) =>
      (comp.propOrigins || []).some((/** @type {string} */ o) => o.includes(name)) || src.includes(`${name}({`),
    );
    const def = refd ? cvaDefs[refd] : null;
    if (refd) attached.add(refd);

    const overall = mergeAnalyses([comp._bodyAnalysis, ...(def ? [def.aggregate] : [])]);
    comp.cva = def ? { name: refd, base: def.base, axes: def.axes, defaults: def.defaults } : null;
    comp.tokensUsed = overall.tokensUsed;
    comp.colorBindings = overall.colorBindings;
    comp.scaleBindings = overall.scaleBindings;
    comp.antiPatterns = overall.antiPatterns;
    delete comp._bodyAnalysis;
  }

  return {
    file: filePath,
    module: basename(filePath).replace(/\.tsx?$/, ''),
    components,
    orphanCva: Object.keys(cvaDefs).filter((n) => !attached.has(n)),
  };
}

// ---------------------------------------------------------------------------
// Scene analysis
// ---------------------------------------------------------------------------

/**
 * @typedef {{module: string, named: string[], default?: string,
 *            namespace?: string, typeOnly?: boolean,
 *            typeOnlyNamed?: string[]}} ImportEntry
 */

/**
 * Every `import` in the file, so a caller knows what is already available.
 *
 * This feeds `SceneMeta.imports` — what the UI lists as in scope. It is NOT
 * what `insertImport`/`removeImport` read: those re-parse the file and work off
 * the AST directly, which is why a shape missing here cannot produce a duplicate
 * import. It can only make the UI describe the file wrongly.
 *
 * `import * as ReactDOM` binds a name too, and recording only `named` dropped it
 * entirely — the survey then said `ReactDOM` was not imported while it was.
 *
 * Type-only bindings are marked rather than filtered. They ARE in scope, just
 * not as values, so a caller deciding whether a JSX tag is available needs to
 * tell `import type { Props }` from `import { Button }`; flattening the two
 * would offer `Props` as something to render.
 *
 * @param {ts.SourceFile} sf
 * @returns {ImportEntry[]}
 */
export function readImports(sf) {
  /** @type {ImportEntry[]} */
  const out = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    /** @type {ImportEntry} */
    const entry = { module: st.moduleSpecifier.text, named: [] };
    const clause = st.importClause;
    // `import './side-effect.css'` has no clause at all.
    if (clause?.isTypeOnly) entry.typeOnly = true;
    if (clause?.name) entry.default = clause.name.getText();
    const nb = clause?.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      /** @type {string[]} */
      const typeOnlyNamed = [];
      for (const el of nb.elements) {
        const name = el.name.getText();
        entry.named.push(name);
        // Per-specifier `import { type A, B }`, distinct from the whole-clause
        // `import type { A, B }` recorded above.
        if (el.isTypeOnly) typeOnlyNamed.push(name);
      }
      if (typeOnlyNamed.length) entry.typeOnlyNamed = typeOnlyNamed;
    } else if (nb && ts.isNamespaceImport(nb)) {
      entry.namespace = nb.name.getText();
    }
    out.push(entry);
  }
  return out;
}

/**
 * Build the nested `SceneNodeMeta` tree for one walkable root.
 *
 * Paths here are produced by `childrenOf` — the SAME numbering `resolveNode`
 * and the stamping transform use, because all three call into `jsx-nodes.mjs`.
 * That identity is the contract; two implementations of it would let an edit
 * land on the wrong node with nothing to catch it.
 *
 * @param {JsxRootNode} node
 * @param {number[]} path
 * @param {string[]} ancestorTags
 * @param {Scope} scope
 * @param {JsxRootNode} owner   The child-list member `node` was reached through.
 * @param {readonly ts.Node[]} returnedJsx  The root's returned expressions.
 * @returns {Record<string, any>}
 */
function buildNode(node, path, ancestorTags, scope, owner, returnedJsx) {
  const tag = tagOf(node);
  const { names, identity, className } = attrsOf(node);
  const text = directTextOf(node);
  const kids = childrenOf(node, scope);
  const fp = fpOf({ ancestorTags, tag, attrNames: names, identity, text });

  return {
    path,
    tag,
    attrs: names,
    className,
    identity,
    text: text || null,
    fp,
    fpx: fpxOf(fp, className, kids.map((k) => tagOf(k.node))),
    analysis: analyzeClasses(className ? [className] : []),
    scope,
    // MIRRORS `resolveNode(…, {requireStatic: true})`, GUARD FOR GUARD. This
    // flag is what enables "insert sibling" / "remove" in the outline, so any
    // disagreement offers a control the server then refuses. The prototype
    // tested only `scope === 'static' && tag !== '#returns'` and disagreed on
    // half the nodes in a four-case fixture — every `{cond && …}` child and
    // every single-return root element read as editable.
    //
    //   scope             — an iteration/callback body renders N times
    //   owner !== node    — reached through `{…}`; removing it leaves a bare `{}`
    //   returnedJsx       — a whole return value has no sibling list to splice
    //                       into. Identity against the returned expressions, NOT
    //                       `path.length === 1`: a returned FRAGMENT is
    //                       transparent, so its children sit at depth 1 and ARE
    //                       real siblings.
    //   tag               — the synthetic `#returns` container itself
    structuralEditable:
      scope === 'static' &&
      tag !== '#returns' &&
      owner === node &&
      !returnedJsx.includes(/** @type {ts.Node} */ (node)),
    repeated: scope === 'iteration',
    // Intrinsic elements always receive a stamped `data-*`. A component only
    // does if it spreads `{...props}`, which we cannot know from this file — so
    // this is conservative and the stamper upgrades it at runtime by checking
    // whether the attribute actually reached the DOM. Unselectable-by-click
    // nodes are still reachable from the outline panel.
    clickSelectable: /^[a-z]/.test(tag),
    children: kids.map((k, i) =>
      buildNode(k.node, [...path, i], [...ancestorTags, tag], k.scope, k.owner, returnedJsx),
    ),
  };
}

/**
 * The node-tree half of a scene, for ANY file — no manifest entry required.
 *
 * This is what the outline's drill-in reads: selecting `<DocumentRow doc={d}/>`
 * in a scene gives you that node in the LIST file, and opening its definition
 * needs the component file's own tree. Without this the drill-in could only
 * reach files someone had thought to list as scenes, which is precisely the
 * files a designer does not need to drill into.
 *
 * @param {string} filePath
 * @returns {{roots: Record<string, any>, imports: ReturnType<typeof readImports>,
 *            defaultExport: string | null, ambiguous: string[]}}
 */
export function analyzeNodes(filePath) {
  const sf = parse(readFileSync(filePath, 'utf8'), filePath);
  const { roots, defaultExport, ambiguous } = findJsxRoots(sf);
  // Null-prototype, for the same reason `findJsxRoots` uses one: the keys are
  // arbitrary source identifiers. `findJsxRoots` already protects its own map,
  // and copying into a plain `{}` here threw that away one layer down —
  // `built.__proto__ = tree` hit the inherited setter, so a component named
  // `__proto__` DISAPPEARED from the outline entirely, and `built.valueOf`
  // answered with an inherited method for a component that does not exist.
  /** @type {Record<string, any>} */
  const built = Object.create(null);
  for (const [name, root] of Object.entries(roots)) {
    // An AMBIGUOUS name is unaddressable by construction: `resolveNode` refuses
    // it outright, because a name two JSX-returning functions claim cannot say
    // which tree an anchor belongs to. Emitting an outline entry would show a
    // subtree whose every node rejects the first edit — and attribute it to
    // whichever function happened to be registered second. Reporting the names
    // lets the UI say "two components here are called Row" instead.
    if (ambiguous.has(name)) continue;
    const returnedJsx = isReturnsRoot(root) ? root.jsx : [];
    built[name] = buildNode(root, [], [], 'static', root, returnedJsx);
  }
  return { roots: built, imports: readImports(sf), defaultExport, ambiguous: [...ambiguous].sort() };
}

/**
 * Analyze one scene file into a `SceneMeta`.
 *
 * `roots` holds ONE walkable root per JSX-returning function — the component
 * plus local helpers like `renderRow`. That is what makes `items.map(renderRow)`
 * a supported case: `renderRow`'s JSX is `static` in its own root, so structural
 * ops work there normally, while an inline `.map(d => …)` body stays `iteration`
 * and is refused structural edits.
 *
 * @param {string} filePath
 * @param {{id: string, kind: 'dom'|'canvas', label: string, export?: string,
 *          route?: string, routePattern?: string, shell?: 'app', mocks?: string[],
 *          fixtures?: Record<string,string>, viewports?: string[],
 *          readOnly?: boolean}} cfg
 */
export function analyzeScene(filePath, cfg) {
  const { roots: built, imports, defaultExport, ambiguous } = analyzeNodes(filePath);

  const wanted = cfg.export ?? 'default';
  const component = wanted === 'default' ? defaultExport : wanted;

  return {
    id: cfg.id,
    kind: cfg.kind,
    label: cfg.label,
    file: filePath,
    export: wanted,
    // `built`, not a bare `roots` — the latter is not in scope here, so this
    // fallback threw `ReferenceError: roots is not defined` in the prototype and
    // would have taken the whole `/metadata` response with it.
    //
    // It fires for exactly one shape: `export: 'default'` (or omitted) against a
    // file with no default export. A mis-typed NAMED export does not reach it —
    // `component` is that string, which is truthy — so the scene reports a
    // component with no matching entry in `roots`. Validating the manifest
    // against the roots belongs with whatever loads the manifest, not here;
    // pinned by test so the gap is recorded rather than assumed away.
    component: component ?? Object.keys(built)[0] ?? null,
    // `route` and `shell` are carried through so the host's `SceneMeta` and the
    // frame's scene entry describe the same scene.
    route: cfg.route,
    routePattern: cfg.routePattern,
    shell: cfg.shell,
    mocks: cfg.mocks ?? [],
    fixtures: cfg.fixtures,
    viewports: cfg.viewports,
    readOnly: cfg.readOnly,
    roots: built,
    imports,
    ambiguous,
  };
}

/**
 * Assemble the full `DesignMetadata` document from per-file analyses.
 * `files` and `scenes` are passed in already-analyzed so the bridge can serve
 * a cached mix of fresh and unchanged entries.
 *
 * @param {{files: ReturnType<typeof analyzeFile>[], scenes?: any[]}} input
 */
export function buildMetadata({ files, scenes }) {
  const rollup = mergeAnalyses(
    files.flatMap((f) => f.components.map((c) => ({ tokensUsed: c.tokensUsed, antiPatterns: c.antiPatterns }))),
  );
  return {
    generatedBy: 'src/server/extract.mjs',
    tokenVocabulary: { semanticRoles: SEMANTIC_ROLES },
    files,
    scenes: scenes ?? [],
    summary: {
      componentCount: files.reduce((n, f) => n + f.components.length, 0),
      uniqueTokensUsed: rollup.tokensUsed,
      antiPatternTotals: Object.fromEntries(ANTI_KEYS.map((k) => [k, rollup.antiPatterns[k].length])),
    },
  };
}

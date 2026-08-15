import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  analyzeClasses,
  analyzeFile,
  analyzeNodes,
  analyzeScene,
  buildMetadata,
  mergeAnalyses,
  readImports,
  SEMANTIC_ROLES,
} from '../../src/server/extract.mjs';
import { findJsxRoots, parse, resolveNode } from '../../src/server/jsx-nodes.mjs';

/**
 * `extract.mjs` is the SECOND consumer of `jsx-nodes.mjs` and the one a designer
 * sees. Its `structuralEditable` flag enables "insert sibling" / "remove" in the
 * outline, which makes it a PREDICTION of what `resolveNode(…, {requireStatic:
 * true})` will do on the server. The two rules live in different files, so the
 * suite below asserts the agreement node-by-node rather than trusting them to
 * stay in step — that is the `describe` that matters most here.
 */

// --- helpers ---------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), 'wb-extract-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
/** Write `src` to a real .tsx file — the analyzers take paths, not text. */
function fixture(src, name = `f${n++}.tsx`) {
  const p = join(dir, name);
  writeFileSync(p, src, 'utf8');
  return p;
}

/** Flatten a built node tree into a list, root included. */
function flatten(node, out = []) {
  out.push(node);
  for (const c of node.children) flatten(c, out);
  return out;
}

const classesOf = (s) => analyzeClasses([s]);

// --- token + anti-pattern analysis -----------------------------------------

describe('analyzeClasses', () => {
  it('records a semantic role and the utility it was bound through', () => {
    const a = classesOf('bg-primary text-primary-foreground');
    expect(a.tokensUsed).toEqual(['primary', 'primary-foreground']);
    expect(a.colorBindings).toEqual([
      { utility: 'bg', role: 'primary' },
      { utility: 'text', role: 'primary-foreground' },
    ]);
  });

  it('prefers the LONGEST matching role', () => {
    // `primary-foreground` and `primary` both match at the same offset. The
    // alternation is sorted by length for exactly this reason; unsorted, the
    // token reads as `primary` and the binding points at the wrong role.
    expect(classesOf('text-primary-foreground').tokensUsed).toEqual(['primary-foreground']);
  });

  it('sees through Tailwind variant modifiers', () => {
    expect(classesOf('hover:bg-accent dark:text-muted-foreground').tokensUsed)
      .toEqual(['accent', 'muted-foreground']);
  });

  it('keeps an opacity suffix out of the role name', () => {
    expect(classesOf('bg-primary/50').tokensUsed).toEqual(['primary']);
  });

  it('flags each anti-pattern family separately', () => {
    const a = classesOf('bg-blue-500 text-white border-[3px]');
    expect(a.antiPatterns.hardcodedPaletteColors).toEqual(['bg-blue-500']);
    expect(a.antiPatterns.hardcodedNamedColors).toEqual(['text-white']);
    expect(a.antiPatterns.arbitraryPx).toEqual(['border-[3px]']);
  });

  it('flags raw color literals', () => {
    const a = classesOf('#ff0088 rgb(1, 2, 3) hsl(200 50% 50%)');
    expect(a.antiPatterns.hexLiterals).toEqual(['#ff0088']);
    expect(a.antiPatterns.rgbHslLiterals).toEqual(['hsl(200 50% 50%)', 'rgb(1, 2, 3)']);
  });

  it('classifies radius, spacing and font-size as scale bindings', () => {
    const a = classesOf('rounded-lg p-4 text-sm');
    expect(a.scaleBindings).toEqual([
      { category: 'radius', utility: 'rounded', value: 'lg', className: 'rounded-lg' },
      { category: 'spacing', utility: 'p', value: '4', className: 'p-4' },
      { category: 'fontSize', utility: 'text', value: 'sm', className: 'text-sm' },
    ]);
  });

  it('reads a bare `rounded` as the base radius', () => {
    // `rounded` with no value IS a radius binding (--radius). Dropping it would
    // hide the single most common radius usage from the scale rollup.
    expect(classesOf('rounded').scaleBindings)
      .toEqual([{ category: 'radius', utility: 'rounded', value: 'base', className: 'rounded' }]);
  });

  it('does not mistake a non-scale text- utility for a font size', () => {
    // `text-primary` is a COLOR. Only the known font-size scale qualifies.
    expect(classesOf('text-primary').scaleBindings).toEqual([]);
  });

  it('de-dupes across the whole blob and sorts deterministically', () => {
    // Output feeds a rendered panel and a JSON document, so unstable ordering
    // would show up as spurious diffs on every re-extract.
    const a = analyzeClasses(['bg-primary p-4', 'bg-primary p-4', 'bg-accent']);
    expect(a.tokensUsed).toEqual(['accent', 'primary']);
    expect(a.colorBindings).toHaveLength(2);
    expect(a.scaleBindings).toHaveLength(1);
  });

  it('returns empty families rather than omitting them', () => {
    const a = classesOf('');
    expect(Object.keys(a.antiPatterns).sort()).toEqual([
      'arbitraryPx', 'hardcodedNamedColors', 'hardcodedPaletteColors', 'hexLiterals', 'rgbHslLiterals',
    ]);
    expect(a.tokensUsed).toEqual([]);
  });
});

describe('mergeAnalyses', () => {
  it('unions tokens, bindings and anti-patterns without duplicates', () => {
    const m = mergeAnalyses([classesOf('bg-primary #fff'), classesOf('bg-primary text-accent')]);
    expect(m.tokensUsed).toEqual(['accent', 'primary']);
    expect(m.colorBindings).toEqual([
      { utility: 'bg', role: 'primary' },
      { utility: 'text', role: 'accent' },
    ]);
    expect(m.antiPatterns.hexLiterals).toEqual(['#fff']);
  });

  it('tolerates partial analyses', () => {
    // `buildMetadata` merges `{tokensUsed, antiPatterns}` projections with no
    // binding arrays at all.
    const m = mergeAnalyses([{ tokensUsed: ['primary'] }, {}]);
    expect(m.tokensUsed).toEqual(['primary']);
    expect(m.colorBindings).toEqual([]);
  });
});

// --- file analysis ----------------------------------------------------------

describe('analyzeFile', () => {
  it('breaks a cva() call down per variant value', () => {
    const f = fixture(`
      const buttonVariants = cva("rounded-md bg-primary", {
        variants: { size: { sm: "p-2 text-sm", lg: "p-6 text-lg" } },
        defaultVariants: { size: "sm" },
      });
      export function Button(props: { size?: string }) { return <button className={buttonVariants({})}/>; }`);
    const { components } = analyzeFile(f);
    const btn = components.find((c) => c.name === 'Button');
    expect(btn.cva.name).toBe('buttonVariants');
    expect(btn.cva.base.classes).toBe('rounded-md bg-primary');
    expect(Object.keys(btn.cva.axes.size)).toEqual(['sm', 'lg']);
    expect(btn.cva.axes.size.lg.classes).toBe('p-6 text-lg');
    expect(btn.cva.defaults).toEqual({ size: 'sm' });
  });

  it('keeps defaultVariants values out of the class analysis', () => {
    // `defaultVariants: { size: "sm" }` is a variant KEY, not a class blob.
    // Scraping every literal in the call would enter "sm" as a class.
    const f = fixture(`
      const v = cva("bg-primary", { variants: { size: { sm: "p-2" } }, defaultVariants: { size: "sm" } });
      export function C() { return <div className={v({})}/>; }`);
    const c = analyzeFile(f).components[0];
    expect(c.cva.base.tokensUsed).toEqual(['primary']);
    expect(c.tokensUsed).toEqual(['primary']);
  });

  it('reads explicit props and records native/variant origins', () => {
    const f = fixture(`
      export function Card(props: { title: string; subtitle?: string } & VariantProps<typeof v> & React.HTMLAttributes<HTMLDivElement>) {
        return <div/>;
      }`);
    const c = analyzeFile(f).components[0];
    expect(c.props).toEqual([
      { name: 'title', type: 'string', optional: false, origin: 'explicit' },
      { name: 'subtitle', type: 'string', optional: true, origin: 'explicit' },
    ]);
    expect(c.propOrigins.some((o) => o.startsWith('variant-props:'))).toBe(true);
    expect(c.propOrigins.some((o) => o.startsWith('native:'))).toBe(true);
  });

  it('records a forwardRef component and its generics', () => {
    const f = fixture(`
      export const Input = React.forwardRef<HTMLInputElement, Props>((props, ref) =>
        <input ref={ref} className="bg-background border-input"/>);`);
    const c = analyzeFile(f).components[0];
    expect(c.kind).toBe('forwardRef');
    expect(c.name).toBe('Input');
    expect(c.tokensUsed).toEqual(['background', 'input']);
    expect(c.propOrigins).toEqual(['generic:HTMLInputElement', 'generic:Props']);
  });

  it('reports a cva no component claims as orphaned', () => {
    const f = fixture(`const strayVariants = cva("bg-primary", {});`);
    expect(analyzeFile(f).orphanCva).toEqual(['strayVariants']);
  });

  it('over-attaches a cva to a component that never calls it', () => {
    // Pins a KNOWN limitation, not a fix. Attachment is a file-wide text search
    // (`src.includes("v({")`) rather than a resolved reference, so any component
    // in a file containing one call claims the cva — here `Other` renders a
    // plain <div> and still reports `v`, inheriting its tokens.
    //
    // The cost is a wrong attribution in the panel, never a wrong write: no
    // mutation path resolves its target through this field. Recorded so the
    // behaviour is a decision rather than a surprise.
    const f = fixture(`
      const v = cva("bg-primary", {});
      export function Uses() { return <button className={v({})}/>; }
      export function Other() { return <div/>; }`);
    const { components, orphanCva } = analyzeFile(f);
    expect(components.find((c) => c.name === 'Other').cva.name).toBe('v');
    expect(components.find((c) => c.name === 'Other').tokensUsed).toEqual(['primary']);
    expect(orphanCva).toEqual([]);
  });

  it('names the module after the file', () => {
    expect(analyzeFile(fixture(`export function C() { return <div/>; }`, 'button.tsx')).module)
      .toBe('button');
  });
});

// --- node tree --------------------------------------------------------------

describe('analyzeNodes', () => {
  it('builds one tree per JSX-returning function, under the synthetic root', () => {
    const { roots } = analyzeNodes(fixture(`
      function C() { return <div><b/></div>; }
      function renderRow() { return <li/>; }`));
    expect(Object.keys(roots).sort()).toEqual(['C', 'renderRow']);
    expect(roots.C.tag).toBe('#returns');
    expect(roots.C.children[0].tag).toBe('div');
    expect(roots.C.children[0].children[0].path).toEqual([0, 0]);
  });

  it('carries className, identity attrs and text onto the node', () => {
    const { roots } = analyzeNodes(fixture(
      `function C() { return <a href="/x" className="bg-primary">Go</a>; }`));
    const a = roots.C.children[0];
    expect(a.className).toBe('bg-primary');
    expect(a.identity).toEqual({ href: '/x' });
    expect(a.text).toBe('Go');
    expect(a.analysis.tokensUsed).toEqual(['primary']);
  });

  it('carries the className EXPRESSION onto the node, so a refusal is visible', () => {
    // Without this the outline could not tell `className={t("nav.home")}` from a
    // node with no class attribute: both arrived as `className: null`, so the UI
    // offered a class edit that `applyClassRewrite` then refused. The three
    // distinguishable shapes, on one tree:
    const { roots } = analyzeNodes(fixture(`
      function C() {
        return (
          <div className={isActive ? "bg-primary" : "bg-muted"}>
            <b className={cn("p-2", x)}/>
            <i/>
          </div>
        );
      }`));
    const div = roots.C.children[0];
    // LOCKED — an expression with no blob to rewrite.
    expect([div.className, div.classNameExpr])
      .toEqual([null, 'isActive ? "bg-primary" : "bg-muted"']);
    // Both fields: the blob IS editable, so a UI keying off `classNameExpr !== null`
    // alone would wrongly grey this out.
    expect([div.children[0].className, div.children[0].classNameExpr])
      .toEqual(['p-2', 'cn("p-2", x)']);
    // No attribute at all.
    expect([div.children[1].className, div.children[1].classNameExpr]).toEqual([null, null]);
    // `analysis` still reads `className` ALONE. A ternary is the fixture because
    // its text carries two real tokens, so routing `classNameExpr` into
    // `analyzeClasses` would report `['muted', 'primary']` here — measured, after
    // an earlier version of this test used `t("nav.home")` and passed whether the
    // expression reached the analyzer or not. Whether a refused expression's
    // literal classes SHOULD be analyzed is a separate question; this pins only
    // that surfacing the text did not silently change the answer.
    expect(div.analysis.tokensUsed).toEqual([]);
  });

  it('marks a .map() body repeated', () => {
    const { roots } = analyzeNodes(fixture(
      `function C() { return <ul>{items.map(d => <li/>)}</ul>; }`));
    const li = roots.C.children[0].children[0];
    expect(li.repeated).toBe(true);
    expect(li.scope).toBe('iteration');
  });

  it('treats a lowercase tag as click-selectable and a component as not', () => {
    // A component only carries the stamped attribute if it spreads {...props},
    // which this file cannot know — so the flag is conservative here and the
    // stamper upgrades it at runtime.
    const { roots } = analyzeNodes(fixture(`function C() { return <div><Card/></div>; }`));
    expect(roots.C.children[0].clickSelectable).toBe(true);
    expect(roots.C.children[0].children[0].clickSelectable).toBe(false);
  });

  it('omits an ambiguous root and reports the name', () => {
    // Two JSX-returning functions named `Row`. `resolveNode` refuses that name
    // outright, so an outline entry would render a subtree whose every node
    // rejects the first edit — and attribute it to whichever was registered
    // second.
    const { roots, ambiguous } = analyzeNodes(fixture(`
      function One() { const Row = () => <li/>; return <ul/>; }
      function Two() { const Row = () => <td/>; return <tr/>; }`));
    expect(ambiguous).toEqual(['Row']);
    expect(Object.keys(roots).sort()).toEqual(['One', 'Two']);
  });

  it('reports the default export', () => {
    expect(analyzeNodes(fixture(`export default function Page() { return <div/>; }`)).defaultExport)
      .toBe('Page');
  });

  it('registers components whose names collide with Object.prototype', () => {
    // `findJsxRoots` returns a null-prototype map for exactly this reason, and
    // copying its entries into a plain `{}` here undid that one layer down:
    // `built.__proto__ = tree` hit the inherited SETTER, so the component
    // vanished from the outline with nothing reported.
    for (const name of ['toString', 'valueOf', '__proto__']) {
      const { roots } = analyzeNodes(fixture(
        `function ${name}() { return <div/>; }`,
        `proto-${name.replace(/\W/g, '')}.tsx`,
      ));
      expect(Object.keys(roots)).toEqual([name]);
      expect(roots[name].tag).toBe('#returns');
    }
  });

  it('keeps the built tree free of any inherited prototype', () => {
    // A name with no component must read as absent. On a plain `{}`,
    // `roots.valueOf` answers with an inherited METHOD — truthy, so a caller
    // testing `if (roots[name])` walks a function instead of reporting "no
    // such component".
    const { roots } = analyzeNodes(fixture(`function C() { return <div/>; }`));
    expect(Object.getPrototypeOf(roots)).toBeNull();
    expect(roots.valueOf).toBeUndefined();
  });
});

// --- THE DRIFT GUARD --------------------------------------------------------

describe('structuralEditable agrees with resolveNode', () => {
  // The prototype tested only `scope === 'static' && tag !== '#returns'` and
  // disagreed with the server on 4 of the 8 nodes below: every single-return
  // root element, and every child reached through `{cond && …}`. Each
  // disagreement is an outline control that invites a drag and is then refused.
  const CASES = {
    'single return': `function C(){ return <div><b/></div>; }`,
    'conditional child': `function C(){ return <div>{cond && <b/>}</div>; }`,
    'returned fragment': `function C(){ return <><A/><B/></>; }`,
    'iteration body': `function C(){ return <ul>{items.map(d => <li/>)}</ul>; }`,
    'ternary branches': `function C(){ return <div>{ok ? <Yes/> : <No/>}</div>; }`,
    'guard clause + main': `function C(){ if (x) return <Loader/>; return <div><b/></div>; }`,
    'nested fragment': `function C(){ return <div><><A/><B/></><C2/></div>; }`,
    'helper root': `function C(){ return <ul/>; } function renderRow(){ return <li><b/></li>; }`,
  };

  for (const [name, src] of Object.entries(CASES)) {
    it(`agrees for every node: ${name}`, () => {
      const path = fixture(src);
      const { roots } = analyzeNodes(path);
      const sf = parse(src, path);
      const live = findJsxRoots(sf).roots;

      // The converse direction too: a root the resolver knows but the outline
      // omitted is invisible in the UI, and the ONLY licensed reason to omit
      // one is ambiguity. Without this, silently dropping roots would satisfy
      // the per-node agreement below by having no nodes to disagree about.
      const { ambiguous } = findJsxRoots(sf);
      const omitted = Object.keys(live).filter((k) => !(k in roots));
      expect(omitted.filter((n) => !ambiguous.has(n))).toEqual([]);

      let checked = 0;
      for (const [rootName, tree] of Object.entries(roots)) {
        expect(live[rootName]).toBeTruthy();
        for (const node of flatten(tree)) {
          const anchor = {
            component: rootName,
            path: node.path,
            tag: node.tag,
            fp: node.fp,
            fpx: node.fpx,
          };
          // BOTH roles. `role: 'container'` split one predicate into two, and an
          // outline that models only the first is wrong in the opposite
          // direction from the original bug: it withholds an "insert child"
          // control the server would have accepted.
          for (const [role, flag] of /** @type {const} */ ([
            ['target', 'structuralEditable'],
            ['container', 'containerEditable'],
          ])) {
            const r = resolveNode(sf, anchor, { requireStatic: true, role });
            expect(
              node[flag],
              `<${node.tag}> at ${node.path.join('.') || '[]'} in ${rootName} as ${role}: ` +
                `outline says ${node[flag]}, server says ${r.located}` +
                (r.located ? '' : ` (${r.reason})`),
            ).toBe(r.located === true);
            checked++;
          }
        }
      }
      // Guards the guard: a fixture that walked no nodes would pass vacuously.
      expect(checked).toBeGreaterThan(0);
    });
  }

  it('refuses the whole return value but allows its children', () => {
    // Pins the direction of the returned-expression rule, so a future "fix"
    // cannot satisfy the agreement test by refusing everything.
    const { roots } = analyzeNodes(fixture(`function C(){ return <div><b/></div>; }`));
    expect(roots.C.children[0].structuralEditable).toBe(false); // the <div>
    expect(roots.C.children[0].children[0].structuralEditable).toBe(true); // the <b>
  });

  it('allows both children of a RETURNED fragment', () => {
    // A returned fragment is transparent for numbering, so A and B sit at depth
    // 1 — but unlike a returned element they are real siblings inside a real
    // container, and splicing between them is legal. This is why the rule tests
    // identity against the returned expressions rather than `path.length === 1`.
    const { roots } = analyzeNodes(fixture(`function C(){ return <><A/><B/></>; }`));
    expect(roots.C.children.map((c) => c.structuralEditable)).toEqual([true, true]);
  });
});

// --- imports, scenes, metadata ---------------------------------------------

describe('readImports', () => {
  it('records default, named, namespace and type-only bindings per module', () => {
    const imports = readImports(parse(`
      import React from 'react';
      import { useState, useMemo } from 'react';
      import * as ReactDOM from 'react-dom';
      import type { Props } from './types';
      import { type Variant, Button } from '@/components/ui/button';
      import './side-effect.css';`, 'x.tsx'));
    expect(imports).toEqual([
      { module: 'react', named: [], default: 'React' },
      { module: 'react', named: ['useState', 'useMemo'] },
      // A namespace import binds a name too. Recording only `named` dropped
      // `ReactDOM` entirely, so the survey claimed it was not imported.
      { module: 'react-dom', named: [], namespace: 'ReactDOM' },
      { module: './types', named: ['Props'], typeOnly: true },
      // Per-specifier `type`, distinct from the whole-clause form above.
      {
        module: '@/components/ui/button',
        named: ['Variant', 'Button'],
        typeOnlyNamed: ['Variant'],
      },
      { module: './side-effect.css', named: [] },
    ]);
  });
});

describe('analyzeScene', () => {
  const src = `
    import { Button } from '@/components/ui/button';
    export default function Page() { return <div className="bg-background"><Button/></div>; }`;

  it('resolves the default export and carries the manifest through', () => {
    const scene = analyzeScene(fixture(src), {
      id: 'page', kind: 'dom', label: 'Page', route: '/p', routePattern: '/p/:id', shell: 'app',
    });
    expect(scene.component).toBe('Page');
    expect(scene.export).toBe('default');
    expect(scene.route).toBe('/p');
    // `routePattern` is carried so the host's SceneMeta and the frame's scene
    // entry describe the same scene; it was silently dropped once.
    expect(scene.routePattern).toBe('/p/:id');
    expect(scene.shell).toBe('app');
    expect(scene.mocks).toEqual([]);
    expect(scene.imports[0].named).toEqual(['Button']);
  });

  it('honours an explicitly named export', () => {
    const scene = analyzeScene(
      fixture(`export function Sidebar(){ return <aside/>; }`),
      { id: 's', kind: 'dom', label: 'S', export: 'Sidebar' },
    );
    expect(scene.component).toBe('Sidebar');
    expect(scene.roots.Sidebar).toBeTruthy();
  });

  it('falls back to the first root when there is no default export', () => {
    // The one shape that reaches the fallback. The prototype's version
    // referenced an out-of-scope `roots` and threw `ReferenceError`, which would
    // have taken the whole /metadata response with it.
    const scene = analyzeScene(
      fixture(`function Only(){ return <div/>; }`),
      { id: 's', kind: 'dom', label: 'S' },
    );
    expect(scene.component).toBe('Only');
  });

  it('passes a mis-typed NAMED export through, with no root to match it', () => {
    // Pins a known gap rather than asserting a fix. `component` is the string
    // the manifest asked for, which is truthy, so the fallback above cannot
    // fire — the scene names a component that `roots` has no entry for.
    // Validating the manifest belongs with whatever loads it.
    const scene = analyzeScene(
      fixture(`function Only(){ return <div/>; }`),
      { id: 's', kind: 'dom', label: 'S', export: 'Missing' },
    );
    expect(scene.component).toBe('Missing');
    expect(scene.roots.Missing).toBeUndefined();
    expect(Object.keys(scene.roots)).toEqual(['Only']);
  });
});

describe('buildMetadata', () => {
  it('rolls component tokens up and counts anti-patterns', () => {
    const f = fixture(`
      export function A() { return <div className="bg-primary text-white"/>; }
      export function B() { return <div className="bg-accent #abc"/>; }`);
    const meta = buildMetadata({ files: [analyzeFile(f)] });
    expect(meta.summary.componentCount).toBe(2);
    expect(meta.summary.uniqueTokensUsed).toEqual(['accent', 'primary']);
    expect(meta.summary.antiPatternTotals.hardcodedNamedColors).toBe(1);
    expect(meta.scenes).toEqual([]);
  });

  it('publishes the vocabulary it measured against', () => {
    // A consumer whose design language is not shadcn's reads every colour as an
    // anti-pattern; shipping the role list makes that legible rather than a
    // mystery, and is the list `TokenAdapter` will supply.
    const meta = buildMetadata({ files: [] });
    expect(meta.tokenVocabulary.semanticRoles).toEqual(SEMANTIC_ROLES);
    expect(SEMANTIC_ROLES).toContain('primary');
  });
});

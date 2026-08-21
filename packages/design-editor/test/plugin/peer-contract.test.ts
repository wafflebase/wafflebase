import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * WHAT THE CONSUMER MUST SUPPLY, derived rather than restated.
 *
 * `src/scenes/scene-entry.tsx` is not reached through the `exports` map — `plugin/index.ts`
 * resolves it from the installed package root and hands that PATH to the consumer's Vite,
 * which then resolves its bare imports from the CONSUMER's `node_modules`. So reading
 * `exports` says the package needs no React, while a consumer without React fails at frame
 * load with nothing explaining why.
 *
 * Read with the TypeScript parser, not a regex over `import … from`. That form is only one of
 * the ways a runtime dependency enters a module: a side-effect import (`import 'polyfill'`), a
 * re-export (`export * from 'pkg'`), a dynamic `import()` and a `require()` all pull a package
 * in and all used to be invisible here. Type-only imports are excluded on purpose — they need
 * types at build time, not a package at run time, so they are a devDependency question.
 */
const SCENES = join(process.cwd(), 'src/scenes');

/** `@scope/pkg/sub` → `@scope/pkg`; `pkg/sub` → `pkg`. */
const packageOf = (spec: string) =>
  spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

function runtimeBareImports(): string[] {
  const found = new Set<string>();
  const record = (spec: string) => {
    if (spec.startsWith('.') || spec.startsWith('virtual:')) return;
    found.add(packageOf(spec));
  };

  for (const file of readdirSync(SCENES).filter((n) => /\.tsx?$/.test(n))) {
    const src = ts.createSourceFile(
      file,
      readFileSync(join(SCENES, file), 'utf8'),
      ts.ScriptTarget.ESNext,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit = (node: ts.Node): void => {
      // `import x from 'p'`, `import 'p'` — but not `import type { T } from 'p'`.
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
        if (ts.isStringLiteral(node.moduleSpecifier)) record(node.moduleSpecifier.text);
      }
      // `export { x } from 'p'`, `export * from 'p'` — but not `export type { T } from 'p'`.
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) {
        if (ts.isStringLiteral(node.moduleSpecifier)) record(node.moduleSpecifier.text);
      }
      // `import('p')` and `require('p')`.
      if (ts.isCallExpression(node)) {
        const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const required = ts.isIdentifier(node.expression) && node.expression.text === 'require';
        const [arg] = node.arguments;
        if ((dynamic || required) && arg && ts.isStringLiteral(arg)) record(arg.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return [...found].sort();
}

describe('the frame graph declares what the consumer must provide', () => {
  it('every runtime bare import under src/scenes is a peerDependency', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    const peers = Object.keys(pkg.peerDependencies ?? {});
    const undeclared = runtimeBareImports().filter((s) => !peers.includes(s));
    expect(undeclared).toEqual([]);
  });

  it('React is among them, because the frame entry is served by path', () => {
    // Pinned explicitly: the derived check above passes vacuously if the graph ever stops
    // importing anything, and React is the one this package was shipping undeclared.
    expect(runtimeBareImports()).toEqual(expect.arrayContaining(['react', 'react-dom']));
  });

  it('sees the import forms a regex over `from` would miss', () => {
    // The scanner is the thing under test here, not the current graph: today `src/scenes`
    // happens to contain none of these, so without this the widening is unverified.
    const scan = (src: string) => {
      const f = ts.createSourceFile('t.tsx', src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
      const out: string[] = [];
      const visit = (n: ts.Node): void => {
        if (ts.isImportDeclaration(n) && !n.importClause?.isTypeOnly && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
        if (ts.isExportDeclaration(n) && !n.isTypeOnly && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
        if (ts.isCallExpression(n)) {
          const dyn = n.expression.kind === ts.SyntaxKind.ImportKeyword;
          const req = ts.isIdentifier(n.expression) && n.expression.text === 'require';
          const [a] = n.arguments;
          if ((dyn || req) && a && ts.isStringLiteral(a)) out.push(a.text);
        }
        ts.forEachChild(n, visit);
      };
      visit(f);
      return out;
    };
    expect(scan("import 'side-effect';")).toEqual(['side-effect']);
    expect(scan("export * from 'reexport';")).toEqual(['reexport']);
    expect(scan("const m = await import('dynamic');")).toEqual(['dynamic']);
    expect(scan("const r = require('required');")).toEqual(['required']);
    // …and leaves type-only forms out, which need types rather than a runtime package.
    expect(scan("import type { T } from 'types-only';")).toEqual([]);
    expect(scan("export type { U } from 'types-only';")).toEqual([]);
  });
});

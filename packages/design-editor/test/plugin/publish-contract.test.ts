/*
 * WHAT A PUBLISHED INSTALL WOULD GET.
 *
 * `peer-contract.test.ts` already checks that `src/scenes` imports nothing undeclared,
 * because the scene runtime executes in the CONSUMER's module graph. This checks the
 * package around it: that the manifest ships the files the exports point at, and that
 * every bare import any shipped entry makes is something the install actually provides.
 *
 * The failure this prevents is silent and remote — it appears in someone else's project
 * as "cannot find module", after publish, with nothing local to reproduce it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const PKG = path.resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));

const exportTargets = (): string[] =>
  Object.values(manifest.exports as Record<string, string>);

/**
 * Every bare specifier imported under `dir`, read with the TypeScript parser.
 *
 * NOT a regex over `from '…'`. The first attempt was, and it reported a dependency
 * called `m` — from a COMMENT in `inject.mjs` explaining the `import 'm'` form. It also
 * misses the forms `peer-contract.test.ts` already enumerates: a side-effect import, a
 * re-export, a dynamic `import()`, a `require()`. Type-only imports are excluded because
 * they vanish at runtime and need no install.
 */
function bareImports(dir: string): Set<string> {
  const out = new Set<string>();
  const record = (spec: string) => {
    if (spec.startsWith('.') || spec.startsWith('node:') || spec.startsWith('virtual:')) return;
    out.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
  };

  const walkDir = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        walkDir(abs);
        continue;
      }
      if (!/\.(ts|tsx|mts|mjs)$/.test(e.name)) continue;
      const src = ts.createSourceFile(
        e.name,
        fs.readFileSync(abs, 'utf8'),
        ts.ScriptTarget.ESNext,
        true,
        e.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
          if (ts.isStringLiteral(node.moduleSpecifier)) record(node.moduleSpecifier.text);
        }
        if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) {
          if (ts.isStringLiteral(node.moduleSpecifier)) record(node.moduleSpecifier.text);
        }
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
  };
  walkDir(path.join(PKG, dir));
  return out;
}

describe('the published package', () => {
  it('is not private', () => {
    // The one field that turns every other check here into theatre.
    expect(manifest.private).toBeUndefined();
  });

  it('ships the files its exports point at', () => {
    const shipped: string[] = manifest.files;
    for (const target of exportTargets()) {
      const top = target.replace(/^\.\//, '').split('/')[0];
      expect(shipped, `exports → ${target}, but "${top}" is not in files`).toContain(top);
    }
  });

  it('has every export target on disk', () => {
    // A subpath typo resolves for nobody and is invisible until someone installs it.
    for (const target of exportTargets()) {
      expect(fs.existsSync(path.join(PKG, target)), `${target} does not exist`).toBe(true);
    }
  });

  it('declares every runtime import the shipped entries make', () => {
    /*
     * `src/shell` is deliberately excluded: it is BUNDLED into `dist/shell` by
     * `vite.shell.config.ts`, so `clsx`, `lucide-react` and `tailwind-merge` reach the
     * browser inside that artefact and are correctly dev-only. Everything else under
     * `src` is served or imported as source, so its imports must be provided.
     */
    const provided = new Set([
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.dependencies ?? {}),
    ]);
    const missing: string[] = [];
    for (const dir of ['src/plugin', 'src/client', 'src/scenes', 'src/server', 'src/tokens']) {
      for (const spec of bareImports(dir)) {
        if (!provided.has(spec)) missing.push(`${dir} → ${spec}`);
      }
    }
    // `typescript` is the one this caught: `src/server/jsx-nodes.mjs` imports it for the
    // AST work, and it was only ever a devDependency — so an install would resolve the
    // injector and then fail on its first mutation.
    expect(missing).toEqual([]);
  });

  it('builds the shell before packing, because dist is gitignored', () => {
    /*
     * `dist/shell` is the editor UI and `shellServer` serves it, so a tarball packed
     * without it installs an editor whose every URL 404s. `dist` is gitignored, so a
     * fresh clone has none — publishing from CI would have shipped exactly that.
     */
    expect(manifest.scripts?.prepack).toBeTruthy();
  });

  it('does not claim to be side-effect free', () => {
    /*
     * `scene-entry.tsx` installs the fetch guard and mounts at module top level — the
     * scene runtime IS side effects. Claiming otherwise invites a consumer's bundler to
     * drop exactly the code that makes a scene safe to render.
     */
    expect(manifest.sideEffects).toBeUndefined();
  });
});

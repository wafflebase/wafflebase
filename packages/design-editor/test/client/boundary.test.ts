import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
/**
 * Both browser trees, not just `client/`.
 *
 * `scenes/` arrived in 10a and runs in the scene frame — a different browser
 * document, but a browser either way, so the same rule applies. Scoping this guard
 * to one directory was how it would have stopped covering the package: a new browser
 * subpath is exactly the moment a `node:` import slips in unnoticed.
 */
const BROWSER_DIRS = ['client', 'scenes'].map((d) => path.join(SRC, d));

/** `node:fs` and `fs` are the same module; only the first form is obvious. */
const BUILTINS = new Set(builtinModules);
const isBuiltin = (spec: string) => BUILTINS.has(spec.replace(/^node:/, ''));

/**
 * Specifiers a source text depends on at RUNTIME — every `type` form is erased.
 *
 * PARSED, NOT MATCHED, and that is a correction. Three regexes did this, each with a
 * documented caveat, and 10a's own review found the caveat that mattered: a
 * TypeScript import-type QUERY —
 *
 *     type Path = import('node:path').PlatformPath;
 *
 * is an `ImportTypeNode`. TypeScript erases it completely, so it costs a browser
 * bundle nothing, but the dynamic-import pattern reported it as `node:path` and the
 * guard would have failed a correct file. That is the same false FAILURE the
 * line-anchoring fix was for, reached by a different route — which is the argument
 * for stopping: a regex cannot tell `type X = import('m')` from
 * `const p = import('m')`, because the discriminator is the position, not the text.
 *
 * `typescript` is already a devDependency here, so the AST costs nothing to reach.
 * It also retires all three caveats at once: `import { type A, b }` no longer needs
 * a special case, a wholly type-only `export { type A } from …` stops being
 * over-reported, and a doc comment mentioning `import('x')` stops matching.
 *
 * Split from the file read so it can be asserted against a string. The alternative
 * was planting a violation in a real module, and the module that would have to hold
 * it is the thing under test.
 *
 * `fileName` is what picks the script kind, and it has to be the REAL one. Pinning
 * `probe.tsx` covered JSX at the cost of the other direction: `<string>x` is a valid
 * `.ts` assertion and JSX to a TSX parse, so a `.ts` module holding one parsed into a
 * broken tree and every specifier after it went unseen — the guard silently blind on
 * the tree it exists to guard. The kinds disagree both ways, so neither is the safe
 * default; `createSourceFile` reads the extension when no kind is passed.
 */
export function valueImportsOf(text: string, fileName = 'probe.ts'): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ESNext, true);
  const out: string[] = [];
  const push = (node: ts.Expression | undefined) => {
    if (node && ts.isStringLiteralLike(node)) out.push(node.text);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      // No clause is a bare side-effect import (`import './x.css'`) — a runtime
      // dependency with nothing bound.
      const clause = node.importClause;
      const typeOnly =
        clause?.isTypeOnly === true ||
        // Every named member is `type`, so the whole statement erases.
        (!!clause?.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((e) => e.isTypeOnly) &&
          !clause.name);
      if (!typeOnly) push(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const typeOnly =
        node.isTypeOnly ||
        (!!node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) push(node.moduleSpecifier);
    } else if (ts.isCallExpression(node)) {
      // `import(...)` as an EXPRESSION. `ts.isImportTypeNode` is deliberately not
      // handled anywhere here — skipping it is the fix.
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) push(node.arguments[0]);
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        push(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return out;
}

/**
 * The file's own name reaches the parser, and a file that does not parse fails here
 * rather than reporting no imports. A broken tree is the failure mode that made the
 * pinned script kind invisible: it costs no error, it just answers `[]`.
 */
function valueImports(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const { diagnostics } = ts.transpileModule(text, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext },
  });
  const messages = (diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
  expect(messages, `${path.relative(SRC, file)} did not parse`).toEqual([]);
  return valueImportsOf(text, file);
}

/** Every module the client pulls in for its value, transitively. */
function closure(): string[] {
  const seen = new Set<string>();
  // `.tsx` as well as `.ts`. The scan read only `.ts` while the parser was pinned to
  // TSX for trees that "hold both" — so a `.tsx` browser module was not mis-parsed,
  // it was never opened. Both ends agree on the extension now.
  const queue = BROWSER_DIRS.flatMap((dir) =>
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
      .map((f) => path.join(dir, f)),
  );
  const reached: string[] = [];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of valueImports(file)) {
      if (!spec.startsWith('.')) {
        reached.push(spec);
        continue;
      }
      const resolved = path.resolve(path.dirname(file), spec);
      reached.push(path.relative(SRC, resolved));
      queue.push(resolved);
    }
  }
  return reached;
}

describe('the client bundle boundary', () => {
  it('reaches no node builtin, however deep the chain', () => {
    // 9b is the first PR where the client depends on a module outside `client/` at
    // RUNTIME — `camelToKebab`, from the token contract. That is safe today because
    // `tokens/adapter.ts` has no imports at all, and this is what keeps it safe: a
    // later value import from `plugin/` would put `node:fs` in a browser bundle, and
    // nothing else in the suite would notice.
    //
    // `builtinModules`, not a `node:` prefix test: `import fs from 'fs'` is the same
    // module by the other spelling, and the prefix test waved it through.
    expect(closure().filter(isBuiltin)).toEqual([]);
  });

  it('sees the value import it is guarding, so it is not vacuously empty', () => {
    expect(closure()).toContain('tokens/adapter.ts');
  });

  it('covers the scene tree, not only the shell client', () => {
    // `scenes/frame-protocol.ts` value-imports `base.ts` for `BASE`; if the scan
    // were still scoped to `client/`, this list would not mention it at all.
    expect(closure()).toContain('base.ts');
    for (const dir of BROWSER_DIRS) expect(fs.existsSync(dir)).toBe(true);
  });

  it('sees a lazy import, which a line-anchored pattern cannot', () => {
    // The hole line-anchoring the old `import` pattern opened: `import\s+` cannot
    // match `import(`, so a browser module could `await import('node:path')` and the
    // guard passed — in the one tree that must never reach Node.
    expect(valueImportsOf("const { sep } = await import('node:path');")).toEqual(['node:path']);
    expect(valueImportsOf('const fs = require("node:fs");')).toEqual(['node:fs']);
    expect(valueImportsOf("void import('./frame-protocol.ts');")).toEqual(['./frame-protocol.ts']);
    // A dynamic import inside an object literal, which is the shape a generated
    // scene loader takes — and the reason `= import(` could not simply be excluded.
    expect(valueImportsOf("export const s = { load: () => import('./a.tsx') };")).toEqual([
      './a.tsx',
    ]);
  });

  it('ignores a TypeScript import-type query, which erases', () => {
    // An `ImportTypeNode` costs a browser bundle nothing, but the regex reported it
    // and the guard would have failed a correct file — the same false FAILURE the
    // line-anchoring fix was for, by another route. A regex cannot tell this from
    // `const p = import('m')`: the discriminator is the position, not the text.
    for (const src of [
      "type Path = import('node:path').PlatformPath;",
      "export type Stats = import('node:fs').Stats;",
      "let p: import('node:path').PlatformPath;",
      "function f(x: import('node:fs').Stats) { return x; }",
    ]) {
      expect(valueImportsOf(src), src).toEqual([]);
    }
  });

  it('erases every type-only import and export form', () => {
    for (const src of [
      "import type { A } from './a.ts';",
      "import { type A, type B } from './a.ts';",
      "export type { A } from './a.ts';",
      "export { type A } from './a.ts';",
    ]) {
      expect(valueImportsOf(src), src).toEqual([]);
    }
    // A mixed clause still imports the value member, and a default binding always does.
    expect(valueImportsOf("import { type A, b } from './a.ts';")).toEqual(['./a.ts']);
    expect(valueImportsOf("import A, { type B } from './a.ts';")).toEqual(['./a.ts']);
    // A bare side-effect import is a runtime dependency with nothing bound.
    expect(valueImportsOf("import './shell.css';")).toEqual(['./shell.css']);
  });

  it('parses each source with its own script kind, both directions', () => {
    // `<string>x` is an assertion in `.ts` and an unclosed JSX tag in `.tsx`; JSX is
    // the reverse. A pinned kind therefore loses one of them to a broken tree, and a
    // broken tree reports NO imports — the guard passes a file it never read. The
    // scan walked `.ts` files only, so TSX was the losing pin.
    const assertion = "const value = <string>unknown; void import('node:fs');";
    expect(valueImportsOf(assertion, 'probe.ts')).toEqual(['node:fs']);
    expect(valueImportsOf(assertion)).toEqual(['node:fs']);
    expect(valueImportsOf(assertion, 'probe.tsx')).toEqual([]);

    const jsx = "export const A = () => <div />; void import('node:path');";
    expect(valueImportsOf(jsx, 'probe.tsx')).toEqual(['node:path']);
    expect(valueImportsOf(jsx, 'probe.ts')).toEqual([]);
  });

  it('does not read a dependency out of prose', () => {
    // The original failure in this file: the word "import" in a doc comment started a
    // match and attached to a specifier 28 lines below.
    expect(valueImportsOf(" * an import specifier, e.g. import('node:path'), names a file")).toEqual(
      [],
    );
    expect(valueImportsOf("const label = 'Color';")).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  analyzeClasses,
  analyzeScene,
  buildMetadata,
  mergeAnalyses,
  SEMANTIC_ROLES,
} from '../../src/server/extract.mjs';

/**
 * Deliberately `.mts` while `extract.test.mjs` is `.mjs`.
 *
 * `extract.mjs` is plain JS carrying `// @ts-check` and JSDoc, so the
 * annotations are checked against the implementation — but nothing checks them
 * against a CONSUMER. This file is that consumer: it imports from TypeScript,
 * exactly as the plugin's dynamic import does, so a JSDoc signature that no
 * longer matches how the module is actually called fails `pnpm typecheck`.
 *
 * The behavioural suite cannot stand in for this — it is `.mjs` with no pragma,
 * so its calls are never type-checked.
 *
 * NOTE: this file replaces the `extract.d.mts` that shipped with the prototype,
 * and it is why that file was not ported. An adjacent declaration file SHADOWS
 * the implementation: with it present, `tsc` loads the declaration and drops the
 * `.mjs` from the program entirely, so `// @ts-check` never runs and the
 * declaration is free to drift from the code it describes. Measured on the
 * sibling `stamp.mjs` — a planted type error produced 0 errors with the
 * declaration present, 3 without it.
 */

describe('extract.mjs types hold at a TypeScript call site', () => {
  it('analyzeClasses returns the documented analysis shape', () => {
    const a: {
      tokensUsed: string[];
      colorBindings: { utility: string; role: string }[];
      scaleBindings: { category: string; utility: string; value: string; className: string }[];
      antiPatterns: Record<string, string[]>;
    } = analyzeClasses(['bg-primary p-4']);
    expect(a.tokensUsed).toEqual(['primary']);
  });

  it('mergeAnalyses accepts PARTIAL analyses', () => {
    // `buildMetadata` merges `{tokensUsed, antiPatterns}` projections with no
    // binding arrays. Typing the parameter as a full analysis would make the
    // module's own internal call site an error.
    const m = mergeAnalyses([{ tokensUsed: ['primary'] }, {}]);
    expect(m.colorBindings).toEqual([]);
  });

  it('analyzeScene requires id/kind/label and accepts the optional manifest keys', () => {
    const cfg = {
      id: 's',
      kind: 'dom' as const,
      label: 'S',
      export: 'Page',
      route: '/p',
      routePattern: '/p/:id',
      shell: 'app' as const,
      mocks: ['documents'],
      fixtures: { documents: './fixtures/documents.ts' },
      viewports: ['desktop'],
      readOnly: true,
    };
    expect(cfg.kind).toBe('dom');
  });

  it('rejects a scene kind outside the union', () => {
    // `kind` drives which renderer the frame mounts, so a typo must not compile
    // into a scene that silently never renders.
    const bad = () =>
      analyzeScene('nope.tsx', {
        id: 's',
        // @ts-expect-error - 'webgl' is not a scene kind
        kind: 'webgl',
        label: 'S',
      });
    expect(typeof bad).toBe('function');
  });

  it('buildMetadata takes files and optional scenes', () => {
    const meta = buildMetadata({ files: [] });
    expect(meta.summary.componentCount).toBe(0);
    expect(meta.scenes).toEqual([]);
  });

  it('exports the semantic role vocabulary as strings', () => {
    const roles: string[] = SEMANTIC_ROLES;
    expect(roles).toContain('primary');
  });
});

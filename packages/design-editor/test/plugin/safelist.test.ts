import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createSafelist, isTailwindV4Entry } from '../../src/plugin/safelist.ts';
import { designEditor } from '../../src/plugin/index.ts';
import type { Plugin } from 'vite';

/**
 * The safelist is the only path by which a class the editor COMPOSES gets a CSS rule,
 * and it was silently dead in the one place it matters. Two independent causes, one
 * regression test each — both stated as behaviour rather than as implementation, so a
 * refactor that keeps the behaviour keeps the test.
 *
 * 1. THE ENTRY WAS NOT RECOGNISED. The frame's stylesheet reaches Tailwind through an
 *    `@import` of the app's own entry and declares its content roots with `@source`; it
 *    never spells `tailwindcss`, which was the only thing the detector looked for.
 *
 * 2. THE HOOK LOST A RACE. `@tailwindcss/vite` registers every one of its plugins
 *    `enforce: "pre"`, so a consumer writing `tailwindcss()` above `designEditor()` had
 *    the stylesheet compiled before the directive was appended. `load` cannot lose that
 *    race — Tailwind defines no `load` — which is why the injection lives there.
 *
 * Symptom of either: forcing a `hover:` state applies `bg-primary/90`, no rule exists,
 * tailwind-merge has already dropped `bg-primary`, and the button renders transparent.
 */

const dir = mkdtempSync(path.join(tmpdir(), 'wb-safelist-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const cssFile = (body: string): string => {
  const p = path.join(dir, `s${Math.random().toString(36).slice(2)}.css`);
  writeFileSync(p, body, 'utf8');
  return p;
};

describe('isTailwindV4Entry', () => {
  it('accepts the plain v4 import', () => {
    expect(isTailwindV4Entry('@import "tailwindcss";\n')).toBe(true);
  });

  it('accepts an entry that only re-imports another one and declares @source', () => {
    // Exactly the shape of the sandbox's `scene.css`, the file this whole path exists
    // to reach. It matched nothing before.
    expect(isTailwindV4Entry("@import '@/index.css';\n@source '../x/**/*.tsx';\n")).toBe(true);
  });

  it('rejects plain CSS and a v3 entry', () => {
    expect(isTailwindV4Entry('.a { color: red }\n')).toBe(false);
    expect(isTailwindV4Entry('@tailwind base;\n@tailwind utilities;\n')).toBe(false);
  });

  it('does not treat @apply as an entry marker', () => {
    // `@apply` lives in component stylesheets that are not entries; appending a
    // `@source` to one of those writes v4 syntax into a file Tailwind never compiles.
    expect(isTailwindV4Entry('.btn { @apply px-2; }\n')).toBe(false);
  });
});

describe('createSafelist', () => {
  it('emits one @source inline directive holding every candidate', () => {
    const s = createSafelist();
    s.register(['bg-primary/90', 'gap-3']);
    expect(s.directive()).toBe('@source inline("bg-primary/90 gap-3");\n');
  });

  it('emits nothing at all when nothing is registered', () => {
    expect(createSafelist().directive()).toBe('');
  });
});

describe('the plugin that injects it', () => {
  const plugins = designEditor({ root: dir }) as Plugin[];
  const safelist = plugins.find((p) => p.name === 'wafflebase-design-editor:safelist-css');

  it('runs pre, and injects through `load` rather than `transform`', () => {
    // `transform` is what lost the race to `@tailwindcss/vite:generate:serve`. Pinning
    // the hook is pinning the fix: every `load` runs before every `transform`.
    expect(safelist).toBeDefined();
    expect(safelist?.enforce).toBe('pre');
    expect(typeof safelist?.load).toBe('function');
    expect(safelist?.transform).toBeUndefined();
  });

  it('is ordered ahead of scene-patch, which loads the same files', () => {
    const names = plugins.map((p) => p.name);
    expect(names.indexOf('wafflebase-design-editor:safelist-css')).toBeLessThan(
      names.indexOf('wafflebase-design-editor:scene-patch'),
    );
  });

  it('claims a Tailwind entry and leaves everything else alone', () => {
    const load = safelist?.load as (this: unknown, id: string) => string | null;
    const entry = cssFile('@import "tailwindcss";\n');
    const plain = cssFile('.a { color: red }\n');
    expect(load.call(null, entry)).toContain('@import "tailwindcss"');
    expect(load.call(null, plain)).toBeNull();
    expect(load.call(null, path.join(dir, 'nope.tsx'))).toBeNull();
    // `?raw` asks for the file as DATA — handing back a doctored string would corrupt
    // the consumer's own asset.
    expect(load.call(null, `${entry}?raw`)).toBeNull();
  });
});

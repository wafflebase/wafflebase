import { describe, expect, it } from 'vitest';
import { joinPosix, resolveImport } from '../../src/scenes/import-paths.ts';
import type { AliasEntry } from '../../src/scenes/import-paths.ts';

/** What `GET /health` reports for a project whose `@` points at `app/`. */
const ALIASES: AliasEntry[] = [{ find: '@', replacement: 'app' }];

describe('joinPosix', () => {
  it('walks `.` and `..` without touching the filesystem', () => {
    expect(joinPosix('app/pages', '../components/badge')).toBe('app/components/badge');
    expect(joinPosix('app/pages', './sibling')).toBe('app/pages/sibling');
    expect(joinPosix('', 'a/b')).toBe('a/b');
    // The empty replacement a root alias resolves to, which is why it is kept.
    expect(joinPosix('', 'components/badge')).toBe('components/badge');
  });

  it('collapses empty segments rather than emitting `//`', () => {
    expect(joinPosix('a', 'b//c')).toBe('a/b/c');
  });

  it('returns null when the walk escapes the root', () => {
    // `out.pop()` on an empty array is a no-op, so this used to return a path INSIDE
    // the root that the specifier never named — `shared/y` for a `..` chain three
    // deep, which a monorepo sibling import makes exist. A drill-in landing there
    // anchors every later staged edit at the wrong file.
    expect(joinPosix('a', '../..')).toBeNull();
    expect(joinPosix('app/pages', '../../../shared/y')).toBeNull();
  });
});

describe('resolveImport', () => {
  it('resolves a relative specifier against the importing file', () => {
    expect(resolveImport('app/pages/home.tsx', '../components/badge')).toBe(
      'app/components/badge.tsx',
    );
  });

  it('assumes `.tsx`, because a drill-in target always returns JSX', () => {
    expect(resolveImport('a/b.tsx', './c')).toBe('a/c.tsx');
  });

  it('honours an explicit extension', () => {
    // `@/types/users.ts` is a real specifier; appending `.tsx` resolves to nothing.
    expect(resolveImport('a/b.tsx', './types.ts', ALIASES)).toBe('a/types.ts');
    expect(resolveImport('a/b.tsx', '@/types/users.ts', ALIASES)).toBe('app/types/users.ts');
    for (const ext of ['.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']) {
      expect(resolveImport('a/b.tsx', `./x${ext}`)).toBe(`a/x${ext}`);
    }
  });

  it('resolves through the consumer’s own alias, whatever it is called', () => {
    // The prototype hardcoded `@/` → `packages/frontend/src`, so a project using
    // any other name resolved nothing and every drill-in row came back empty.
    expect(resolveImport('a/b.tsx', '@/components/badge', ALIASES)).toBe(
      'app/components/badge.tsx',
    );
    expect(resolveImport('a/b.tsx', '~/components/badge', [{ find: '~', replacement: 'src' }])).toBe(
      'src/components/badge.tsx',
    );
    expect(resolveImport('a/b.tsx', '#app/x', [{ find: '#app', replacement: 'lib' }])).toBe(
      'lib/x.tsx',
    );
  });

  it('returns null for a bare specifier, which lives in node_modules', () => {
    // Offering a drill-in there invites editing a dependency, and the write boundary
    // refuses it anyway.
    for (const bare of ['react', 'lucide-react', '@tanstack/react-query']) {
      expect(resolveImport('a/b.tsx', bare, ALIASES), bare).toBeNull();
    }
  });

  it('does not read a scoped package as an alias plus a path', () => {
    // `@scope/pkg` and the alias `@` both start with `@`. Matching on the prefix
    // alone pointed the drill-in at `app/scope/pkg.tsx`, a file inside the project
    // that does not exist — which produces an empty outline, not an error.
    expect(resolveImport('a/b.tsx', '@scope/pkg', ALIASES)).toBeNull();
    // The alias still matches its own path segments.
    expect(resolveImport('a/b.tsx', '@/x', ALIASES)).toBe('app/x.tsx');
  });

  it('returns null for a bare alias root, which names a directory', () => {
    // `@` alone resolves to the replacement itself. That used to be reported as
    // `app.tsx` — the alias DIRECTORY dressed as a file, so the metadata route 404s
    // and the row shows an empty outline. Certain enough to refuse, unlike
    // `@/components` (see the module header's NOT COVERED note).
    expect(resolveImport('a/b.tsx', '@', ALIASES)).toBeNull();
  });

  it('resolves a bare alias that points straight at a file', () => {
    // The reason the check is on the extension rather than a flat refusal: an alias
    // aimed at one module is a real config, and it names a file unambiguously.
    expect(
      resolveImport('a/b.tsx', '@cfg', [{ find: '@cfg', replacement: 'app/config.ts' }]),
    ).toBe('app/config.ts');
  });

  it('returns null when an aliased specifier escapes the root', () => {
    expect(resolveImport('a/b.tsx', '@/../../x', ALIASES)).toBeNull();
  });

  it('takes the FIRST matching alias, as the bundler does', () => {
    // Order decides anything only when one find is a path-segment prefix of another.
    // `@` vs `@ui` is NOT that case — `@ui/button` does not start with `@/`, so the
    // segment check excludes `@` whatever the order. `@app` vs `@app/design` is.
    //
    // The two orders are asserted to give DIFFERENT answers, which is the point:
    // `@rollup/plugin-alias` resolves with `entries.find(...)`, so the file on screen
    // is whichever alias the consumer listed first. A longest-first sort returned the
    // same file for both orders, and therefore disagreed with the bundler for one of
    // them — a drill-in opening a file other than the one rendering.
    const outerFirst: AliasEntry[] = [
      { find: '@app', replacement: 'app' },
      { find: '@app/design', replacement: 'packages/design/src' },
    ];
    expect(resolveImport('a/b.tsx', '@app/design/button', outerFirst)).toBe(
      'app/design/button.tsx',
    );
    expect(resolveImport('a/b.tsx', '@app/design/button', [...outerFirst].reverse())).toBe(
      'packages/design/src/button.tsx',
    );
    // A non-matching alias is skipped, so a later one still gets its turn.
    expect(resolveImport('a/b.tsx', '@app/pages/home', [...outerFirst].reverse())).toBe(
      'app/pages/home.tsx',
    );
  });

  it('resolves nothing but relative paths when the project has no aliases', () => {
    // A project with none is the ordinary case, not a degraded one.
    expect(resolveImport('a/b.tsx', '@/x')).toBeNull();
    expect(resolveImport('a/b.tsx', './x')).toBe('a/x.tsx');
  });
});

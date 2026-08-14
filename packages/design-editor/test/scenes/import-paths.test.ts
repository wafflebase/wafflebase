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
    expect(joinPosix('a', '../..')).toBe('');
  });

  it('collapses empty segments rather than emitting `//`', () => {
    expect(joinPosix('a', 'b//c')).toBe('a/b/c');
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
    // The alias still matches its own exact form and its own path segments.
    expect(resolveImport('a/b.tsx', '@', ALIASES)).toBe('app.tsx');
    expect(resolveImport('a/b.tsx', '@/x', ALIASES)).toBe('app/x.tsx');
  });

  it('prefers the longest matching alias when one NESTS inside another', () => {
    // The sort only decides the case where two aliases both match at a segment
    // boundary, which needs one find to be a path-prefix of the other. `@` vs `@ui`
    // is NOT that case — `@ui/button` does not start with `@/`, so the segment
    // check already excludes `@` and the order is irrelevant. `@app` vs
    // `@app/design` is, and there the consumer meant the more specific one.
    const nested: AliasEntry[] = [
      { find: '@app', replacement: 'app' },
      { find: '@app/design', replacement: 'packages/design/src' },
    ];
    expect(resolveImport('a/b.tsx', '@app/design/button', nested)).toBe(
      'packages/design/src/button.tsx',
    );
    // Reversing the input must not change the answer.
    expect(resolveImport('a/b.tsx', '@app/design/button', [...nested].reverse())).toBe(
      'packages/design/src/button.tsx',
    );
    // The outer alias still resolves everything the inner one does not claim.
    expect(resolveImport('a/b.tsx', '@app/pages/home', nested)).toBe('app/pages/home.tsx');
  });

  it('resolves nothing but relative paths when the project has no aliases', () => {
    // A project with none is the ordinary case, not a degraded one.
    expect(resolveImport('a/b.tsx', '@/x')).toBeNull();
    expect(resolveImport('a/b.tsx', './x')).toBe('a/x.tsx');
  });
});

/**
 * `scenes.config.json` as DATA — a rot guard, not a parser test.
 *
 * The manifest names eleven files in `packages/frontend/src/app/**` and an exported symbol
 * in each. Nothing imports it yet (the scene runtime is PRs 10-12), so nothing would notice
 * if the frontend renamed a page — and the frontend moves weekly. The failure that would
 * follow is the worst kind: the editor lists a scene, the frame requests a module that does
 * not resolve, and the symptom is a blank iframe rather than a message.
 *
 * So this suite checks the manifest against the repository, and it is the only automated
 * statement that population C still matches the app it describes. Deliberately NOT a test
 * of `readManifest` / `renderScenesModule`: those are `@wafflebase/design-editor`'s and are
 * tested there. This file only ever asserts about the JSON and the files it points at.
 *
 * The export check is a REGEX, not a parse. A false pass is possible (a commented-out
 * export would satisfy it); a false failure is not, which is the direction that matters for
 * a guard whose whole job is to notice a rename.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../../scenes.config.json' with { type: 'json' };

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

const scenes = manifest.scenes as {
  id: string;
  kind: string;
  label: string;
  file: string;
  export?: string;
  route?: string;
  routePattern?: string;
  shell?: string;
  mocks?: string[];
  deferred?: boolean;
}[];

/** Does `file` export `name`? Regex, per the header — no false failures. */
function exportsSymbol(file: string, name: string): boolean {
  const text = read(file);
  if (name === 'default') return /export\s+default/.test(text);
  return (
    new RegExp(`export\\s+(async\\s+)?(function|const|class|let)\\s+${name}\\b`).test(text) ||
    new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`).test(text)
  );
}

describe('scenes.config.json', () => {
  it('is not empty, so a silently-truncated manifest fails here', () => {
    expect(scenes.length).toBeGreaterThan(0);
    expect(manifest.components.length).toBeGreaterThan(0);
  });

  it.each(scenes.map((s) => [s.id, s.file] as const))(
    'scene %s points at a file that exists',
    (_id, file) => {
      expect(exists(file), `${file} is gone — the frontend moved and the manifest did not`).toBe(
        true,
      );
    },
  );

  it.each(manifest.components)('component %s exists', (file) => {
    expect(exists(file)).toBe(true);
  });

  it.each(scenes.map((s) => [s.id, s.file, s.export ?? 'default'] as const))(
    'scene %s still finds its `%s` export `%s`',
    (_id, file, name) => {
      expect(exportsSymbol(file, name), `${file} no longer exports ${name}`).toBe(true);
    },
  );

  it('has unique ids', () => {
    // `renderScenesModule` keys its loader table by `${id}|${side}`, so a duplicate id
    // silently overwrites the earlier entry while both scenes stay in the exported list —
    // the outline shows two rows and one of them loads the other's file. That package warns
    // and drops; the fix belongs here, where the duplicate would be introduced.
    const ids = scenes.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only the two kinds the plugin dispatches on', () => {
    for (const s of scenes) expect(['dom', 'canvas']).toContain(s.kind);
  });

  it('gives every scene a route and a label', () => {
    for (const s of scenes) {
      expect(s.label, `${s.id} needs a label — it is what the picker shows`).toBeTruthy();
      expect(s.route, `${s.id} needs a route`).toMatch(/^\//);
    }
  });

  it('keeps routePattern shaped like its route', () => {
    // `route` is the navigable fixture path, `routePattern` the pattern the page's own
    // `useParams()` needs present in the matched route. They must describe the same path or
    // the router matches neither: registering the literal path as both is what made a page
    // read `{}` from `useParams` and silently disable every param-gated query.
    // A scene with no `route` is skipped rather than asserted on: the dedicated case above
    // reports that, by id, and a non-null assertion here would pre-empt it with a
    // `TypeError` on `undefined.split` that names no scene at all.
    for (const s of scenes) {
      if (!s.routePattern || !s.route) continue;
      const route = s.route.split('/');
      const pattern = s.routePattern.split('/');
      expect(pattern.length, `${s.id}: route and routePattern differ in depth`).toBe(route.length);
      pattern.forEach((seg, i) => {
        if (!seg.startsWith(':')) expect(seg, `${s.id}: segment ${i} diverges`).toBe(route[i]);
      });
    }
  });

  it('declares a routePattern wherever the route carries a fixture id', () => {
    // The rule the previous test cannot state: a route with a `ws-fixture` or `fixture`
    // segment is standing in for a parameter, so the page reads that parameter and the
    // pattern is mandatory.
    for (const s of scenes) {
      if (!s.route || !/(^|\/)(ws-)?fixture(\/|$)/.test(s.route)) continue;
      expect(s.routePattern, `${s.id}: a fixture segment needs a routePattern`).toBeTruthy();
    }
  });

  it('gives every app-shell scene what the shell itself fetches', () => {
    // `shell: "app"` mounts the real Layout.tsx, which fetches /workspaces,
    // /analytics/enabled and /auth/me on its own behalf. A shell scene missing any of these
    // renders the chrome and then fails inside it, which reads as the scene being broken.
    for (const s of scenes) {
      if (s.shell !== 'app') continue;
      expect(s.mocks, `${s.id} mounts the app shell`).toEqual(
        expect.arrayContaining(['router', 'query', 'auth', 'tooltip']),
      );
    }
  });

  it('defers every scene, because the runtime that mounts them is not here yet', () => {
    // THIS ASSERTION IS EXPECTED TO CHANGE, and that is its purpose. 8c ships the token
    // pipeline; the frame entry, SceneHost, providers.tsx and the fixtures are PRs 10-12.
    // Until then a loader would be generated for a scene that cannot mount, and Vite's
    // dependency scanner crawls its specifier at startup regardless of whether anyone
    // clicks it. Un-deferring is a deliberate line in the PR that supplies what the scene
    // was waiting for, rather than something that happens by omission.
    const live = scenes.filter((s) => !s.deferred).map((s) => s.id);
    expect(live).toEqual([]);
  });
});

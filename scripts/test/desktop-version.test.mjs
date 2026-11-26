// The desktop app carries the repository's release version.
//
// WHY. `desktop-release.yml` builds the app from the same GitHub release
// that publishes the server image, and attaches it to that release. The app
// reports the version in `packages/desktop/package.json` (tauri.conf.json
// reads it) and the updater compares it against the release's
// `latest.json`. If a release bump misses the desktop files, the workflow
// refuses the release; this catches it in the bump PR instead. Cargo.lock is
// checked too: `cargo --locked` in CI fails on a stale one.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(path.join(REPO, p), "utf8");

test("desktop versions match the root package version", () => {
  const root = JSON.parse(read("package.json")).version;
  const desktop = JSON.parse(read("packages/desktop/package.json")).version;
  const crate = read("packages/desktop/src-tauri/Cargo.toml").match(
    /^\[package\][^[]*?^version = "([^"]+)"/m,
  )?.[1];
  const lock = read("packages/desktop/src-tauri/Cargo.lock").match(
    /^name = "wafflebase-desktop"\nversion = "([^"]+)"/m,
  )?.[1];
  assert.deepEqual({ desktop, crate, lock }, { desktop: root, crate: root, lock: root });
});

test("tauri.conf.json takes its version from package.json", () => {
  const conf = JSON.parse(read("packages/desktop/src-tauri/tauri.conf.json"));
  assert.equal(conf.version, "../package.json");
});

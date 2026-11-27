// The desktop app's release contract: its version, and the assets
// `.github/workflows/desktop-release.yml` must agree on.
//
// VERSION. The workflow builds the app from the same GitHub release that
// publishes the server image and attaches it to that release. The app reports
// the version in `packages/desktop/package.json` (tauri.conf.json reads it)
// and the updater compares it against the release's `latest.json`. If a
// release bump misses the desktop files, the workflow refuses the release;
// this catches it in the bump PR instead. Cargo.lock is checked too:
// `cargo --locked` in CI fails on a stale one.
//
// ASSETS. Installed apps fetch `releases/latest/download/latest.json` and
// then the URLs inside it. A name that differs between the Collect steps, the
// manifest and the upload is a 404 every installed app logs and nobody sees.
// Line-based, like `release-guard.test.mjs`: `scripts/` has no YAML parser to
// import.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(path.join(REPO, p), "utf8");
const WORKFLOW = read(".github/workflows/desktop-release.yml");

/** The text of every step whose `- name:` matches, up to the next step. */
function steps(name) {
  const lines = WORKFLOW.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)- name: (.*)$/);
    if (!m || !name.test(m[2])) continue;
    const body = [];
    for (let k = i + 1; k < lines.length; k++) {
      if (new RegExp(`^${m[1]}- `).test(lines[k]) || /^\S/.test(lines[k])) break;
      body.push(lines[k]);
    }
    out.push(body.join("\n"));
  }
  assert.ok(out.length > 0, `no step named ${name}`);
  return out.join("\n");
}

const names = (text, re) => new Set([...text.matchAll(re)].map((m) => m[1]));
const ASSET = String.raw`(Wafflebase_[\w.-]+)`;

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

test("every asset the manifest or the upload names is one a build collected", () => {
  const collected = names(steps(/^Collect$/), new RegExp(`out/${ASSET}"?\\s*$`, "gm"));
  const manifest = steps(/^Write the update manifest$/);
  const uploaded = names(steps(/^Attach to the release$/), new RegExp(`out/${ASSET}`, "g"));

  const packages = names(manifest, new RegExp(`\\$base/${ASSET}`, "g"));
  const signatures = names(manifest, new RegExp(`out/${ASSET}\\.sig`, "g"));

  assert.ok(packages.size > 0 && uploaded.size > 0);
  for (const name of uploaded) assert.ok(collected.has(name), `uploads ${name}, which no Collect step produces`);
  for (const name of packages) assert.ok(uploaded.has(name), `latest.json points at ${name}, which is not uploaded`);
  for (const name of packages) assert.ok(signatures.has(name), `latest.json carries no signature read from ${name}.sig`);
  for (const name of signatures) assert.ok(collected.has(`${name}.sig`), `${name}.sig is not collected`);
});

test("the manifest covers every platform the app ships on", () => {
  const manifest = steps(/^Write the update manifest$/);
  for (const key of ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]) {
    assert.match(manifest, new RegExp(`"${key}":`), key);
  }
});

// Every place that links a download: the package README, the docs guide,
// and the homepage, which builds its URLs from a `RELEASES` base it must keep
// pointed at the latest release.
test("every download link names an asset the release uploads", () => {
  const uploaded = names(steps(/^Attach to the release$/), new RegExp(`out/${ASSET}`, "g"));
  const fullUrl = new RegExp(`releases/latest/download/${ASSET}`, "g");
  const sources = {
    "packages/desktop/README.md": names(read("packages/desktop/README.md"), fullUrl),
    "packages/documentation/start/desktop.md": names(read("packages/documentation/start/desktop.md"), fullUrl),
  };
  const homepage = read("packages/frontend/src/app/home/desktop-download.ts");
  assert.match(
    homepage,
    // Tolerant of a reformat (quotes, a wrapped assignment): it is the URL
    // that matters, not the line.
    /RELEASES\s*=\s*["'`]https:\/\/github\.com\/wafflebase\/wafflebase\/releases\/latest\/download["'`]/,
    "the homepage's RELEASES base must be the latest-release download URL",
  );
  sources["packages/frontend/src/app/home/desktop-download.ts"] = names(
    homepage,
    new RegExp(`\\$\\{RELEASES\\}/${ASSET}`, "g"),
  );
  for (const [file, linked] of Object.entries(sources)) {
    assert.ok(linked.size > 0, `${file} links no download`);
    for (const name of linked) assert.ok(uploaded.has(name), `${file} links ${name}, which is not uploaded`);
  }
});

test("both release builds turn the updater package on", () => {
  const builds = WORKFLOW.match(/pnpm tauri build[^\n]*(?:\n\s+--[^\n]*)*/g) ?? [];
  assert.equal(builds.length, 2, builds.join("\n"));
  for (const b of builds) assert.match(b, /--config src-tauri\/tauri\.release\.conf\.json/, b);
});

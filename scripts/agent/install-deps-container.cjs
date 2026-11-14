// What runs INSIDE the container `install-deps.mjs` starts: set the branch's
// `.npmrc` files aside, run pnpm, put them back.
//
// WHY THIS IS IN HERE AND NOT ON THE RUNNER. Setting a file aside and putting
// it back are writes into the workspace, and the second one happens after the
// install has had the workspace to itself. Done from the runner, a write like
// that goes wherever the tree then leads it. Done from in here, the furthest it
// can reach is what the container was given: the workspace and its store. So
// the runner writes nothing under the workspace once the container has run,
// and every write the install needs is made by this file.
//
// It is mounted read-only, by itself, and is plain CommonJS with no
// dependencies: the image provides Node and nothing else.
//
// Usage (in the container, cwd = the workspace):
//   node install-deps-container.cjs <pnpm.cjs> <pnpm arguments…>
// Environment: INSTALL_DEPS_NPMRC — optional, a file to use as the root
// `.npmrc` during the install (main's own, when main has one).

"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** Every `.npmrc` in the tree (file, directory or link), relative to the root; nothing is followed. */
function findNpmrc(root) {
  const found = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.name === ".npmrc") found.push(path.relative(root, full));
      else if (entry.isDirectory() && !(dir === root && entry.name === ".git") && entry.name !== "node_modules") stack.push(full);
    }
  }
  return found;
}

function main() {
  const [pnpm, ...args] = process.argv.slice(2);
  const root = process.cwd();
  const stash = fs.mkdtempSync(path.join(os.tmpdir(), "npmrc-"));
  const setAside = findNpmrc(root);
  const links = new Map();
  let status = 1;
  try {
    setAside.forEach((rel, i) => {
      // A copy and a removal rather than a rename: the stash is the
      // container's own scratch space, on another filesystem. A link is
      // remembered by where it points, not followed.
      const from = path.join(root, rel);
      if (fs.lstatSync(from).isSymbolicLink()) links.set(i, fs.readlinkSync(from));
      else fs.cpSync(from, path.join(stash, String(i)), { recursive: true, verbatimSymlinks: true });
      fs.rmSync(from, { recursive: true, force: true });
    });
    if (setAside.length > 0) console.log(`install-deps: set aside ${setAside.length} .npmrc for the install`);
    if (process.env.INSTALL_DEPS_NPMRC) fs.copyFileSync(process.env.INSTALL_DEPS_NPMRC, path.join(root, ".npmrc"));
    const r = spawnSync(process.execPath, [pnpm, ...args], { cwd: root, stdio: "inherit" });
    status = r.status ?? 1;
  } finally {
    fs.rmSync(path.join(root, ".npmrc"), { recursive: true, force: true });
    setAside.forEach((rel, i) => {
      const from = path.join(stash, String(i));
      const to = path.join(root, rel);
      if (!links.has(i) && !fs.lstatSync(from, { throwIfNoEntry: false })) return;
      try {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.rmSync(to, { recursive: true, force: true });
        if (links.has(i)) fs.symlinkSync(links.get(i), to);
        else fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
      } catch (error) {
        // The tree no longer has a place for it. The runner sees the file
        // missing from the working tree and fails the step.
        console.error(`install-deps: could not put ${rel} back (${error.code ?? error.message})`);
        status = status || 1;
      }
    });
    fs.rmSync(stash, { recursive: true, force: true });
  }
  process.exitCode = status;
}

main();

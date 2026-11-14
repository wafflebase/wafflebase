// Third-party packages for the arms, loaded from the CORE's install.
//
// The arms live outside `scripts/agent` so that the shared harness core can be
// copied over that directory byte for byte. Their few third-party imports — the
// Agent SDK and zod — did not move with them: they are the core's dependencies,
// installed by `npm ci` in `scripts/agent`. A bare `import("zod")` from here
// walks up from `scripts/agent-arms/` and never looks inside
// `scripts/agent/node_modules`, so it would not find them.
//
// WHY NOT A SECOND package.json HERE. That would be a second install and a
// second copy of each package — and the hunters hand an MCP server built with
// the arm's SDK to `ask.mjs`, which runs it with the core's. Two copies in one
// process can disagree at any version bump, and nothing would say so. This
// loads the very file the core's own `import()` loads, so there is one.
//
// HOW. Node's ESM resolver takes no parent to resolve from (that needs a flag),
// and `createRequire(...).resolve` resolves with the `require` condition, which
// for zod is a different file — its CommonJS build — from the one the SDK
// imports. So this finds the package where `require` would look from
// `scripts/agent`, and then reads its `exports` the way `import` does: the `.`
// entry, conditions `node`, `import` and `default`, first match in key order.
// `core-deps.test.mjs` compares the answer with Node's own resolver, run from
// `scripts/agent`.
//
// A missing package throws `ERR_MODULE_NOT_FOUND`, as a bare `import()` would,
// so the callers' "run `npm ci` in scripts/agent" fallbacks still apply.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The core's package manifest; resolution starts beside it. */
export const CORE_PACKAGE = new URL("../agent/package.json", import.meta.url);

const CONDITIONS = new Set(["node", "import", "default"]);

/** Resolve one `exports` target against the ESM conditions, or null. */
function target(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const v of value) {
      const t = target(v);
      if (t !== null) return t;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (!CONDITIONS.has(key)) continue;
      const t = target(v);
      if (t !== null) return t;
    }
  }
  return null;
}

/** The `.` entry of a package's `exports`, whichever form it is written in. */
function rootEntry(exportsField) {
  if (typeof exportsField === "string" || Array.isArray(exportsField)) return exportsField;
  if (exportsField && typeof exportsField === "object") {
    const keys = Object.keys(exportsField);
    if (keys.some((k) => k.startsWith("."))) return exportsField["."];
    return exportsField; // conditions only: sugar for `{ ".": { … } }`
  }
  return undefined;
}

function notFound(name, why) {
  const err = new Error(`Cannot find package '${name}' from the core's install (${why}) — run \`npm ci\` in scripts/agent`);
  err.code = "ERR_MODULE_NOT_FOUND";
  return err;
}

/**
 * The file URL `import(name)` would load from `scripts/agent`.
 * Bare package names only: no subpath, no relative or absolute specifier.
 */
export function resolveCoreDep(name, { corePackage = CORE_PACKAGE } = {}) {
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name)) {
    throw new TypeError(`resolveCoreDep takes a bare package name, not ${JSON.stringify(name)}`);
  }
  const lookup = [];
  for (let d = path.dirname(fileURLToPath(corePackage)); ; d = path.dirname(d)) {
    if (path.basename(d) !== "node_modules") lookup.push(path.join(d, "node_modules", name));
    if (path.dirname(d) === d) break;
  }
  const dir = lookup.find((d) => existsSync(path.join(d, "package.json")));
  if (!dir) throw notFound(name, "not installed");
  const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  let rel;
  if (manifest.exports !== undefined) {
    rel = target(rootEntry(manifest.exports));
    if (rel === null || rel === undefined) throw notFound(name, "no `.` export for import");
  } else {
    rel = manifest.main ?? "index.js";
  }
  return pathToFileURL(path.join(dir, rel)).href;
}

/** `import(name)`, resolved from the core's install. */
export function importCoreDep(name, options) {
  return import(resolveCoreDep(name, options));
}

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
// HOW: NODE'S OWN RESOLVER, ASKED FROM `scripts/agent`. Resolution is not
// re-implemented here: `exports` conditions (`module-sync` among them),
// `main` without an extension or naming a directory, symlinked installs —
// every rule is Node's, at whatever version runs this. `import.meta.resolve`
// takes no parent to resolve from (its second argument needs a flag), so a
// synchronous resolve hook (`module.registerHooks`, Node 22.15+) re-parents
// the one call made below, and only while that call runs: it acts on nothing
// but a resolution whose parent is this file, with an anchor set. The answer
// is a file URL, so `importCoreDep` loads exactly what `ask.mjs`'s
// `import(name)` loads. `core-deps.test.mjs` compares the two on a fixture
// install of every package shape.
//
// A missing package throws `ERR_MODULE_NOT_FOUND`, as a bare `import()` would,
// so the callers' "run `npm ci` in scripts/agent" fallbacks still apply.

import { registerHooks } from "node:module";

/** The core's package manifest; resolution is asked from beside it. */
export const CORE_PACKAGE = new URL("../agent/package.json", import.meta.url);

const SELF = import.meta.url;
/** The parent to resolve from, set only for the duration of one synchronous resolve. */
let anchor = null;
let hooked = false;

function hook() {
  if (hooked) return;
  if (typeof registerHooks !== "function") {
    throw new Error(`core-deps.mjs needs module.registerHooks (Node 22.15 or later); this is Node ${process.version}`);
  }
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (anchor !== null && context.parentURL === SELF) {
        return nextResolve(specifier, { ...context, parentURL: anchor });
      }
      return nextResolve(specifier, context);
    },
  });
  hooked = true;
}

/**
 * The file URL `import(name)` loads when asked from `scripts/agent`.
 * Bare package names only: no subpath, no relative or absolute specifier.
 */
export function resolveCoreDep(name, { corePackage = CORE_PACKAGE } = {}) {
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name)) {
    throw new TypeError(`resolveCoreDep takes a bare package name, not ${JSON.stringify(name)}`);
  }
  hook();
  anchor = String(corePackage);
  try {
    return import.meta.resolve(name);
  } finally {
    anchor = null;
  }
}

/** `import(name)`, resolved from the core's install. */
export function importCoreDep(name, options) {
  return import(resolveCoreDep(name, options));
}

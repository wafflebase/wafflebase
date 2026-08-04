// Lint for `scripts/**` — the agent control plane, which until now had NONE.
//
// WHY THIS EXISTS. `verify:fast` lints `packages/frontend` and nothing else, so
// ~30 modules that decide whether a PR may merge got no static analysis at all:
// only `node --test`, and only over paths a test happens to reach. #657 shipped
// `retryAt` — an undeclared identifier on the round-cap page path — straight
// through green CI, because no test exercises that page. `no-undef` names it in
// milliseconds. The review panel caught it, which is the expensive way to catch a
// typo.
//
// `js.configs.recommended`, not a hand-picked rule list. The whole directory
// produced nine violations against the full baseline (seven dead bindings, one
// redundant escape, one literal run of spaces in a regex), all fixed in the commit
// that turned this on. A curated subset would have to justify each omission, and
// the omissions are where the next silent bug lives.
//
// SCOPED AND ROOTED HERE, deliberately. `scripts/agent/package.json` is an
// npm-managed island — the `deps` job runs `npm ci` there and uploads the tree as
// an artifact every panel run — so adding eslint to it would bloat that artifact
// for a check that never runs in that job. The root already carries the toolchain;
// `files` keeps this config from claiming the TypeScript packages, which have their
// own.
//
// `eslint`, `@eslint/js` and `globals` are declared as ROOT devDependencies rather
// than borrowed from `packages/frontend` by hoisting. Hoisting is not a contract:
// pnpm may stop lifting them, and the failure mode is this lint silently not
// running — the exact shape of the gap it closes.

import js from "@eslint/js";
import globals from "globals";

export default [
  {
    files: ["scripts/**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      // These scripts are Node CLIs and Node test files: `process`, `console`,
      // `URL`, `setTimeout`, `Buffer`. Without this every one of them is an
      // undefined global and `no-undef` is pure noise instead of a signal.
      globals: { ...globals.node },
    },
    rules: {
      // SPREAD, not replaced. `...js.configs.recommended` above sets `rules`, and a
      // bare `rules: {…}` here overwrites that whole object — which silently left
      // this config running one rule and NOT `no-undef`, the rule the whole file
      // exists for. It was caught by re-introducing #657's bug and watching the
      // lint stay green; the `agent:lint catches an undeclared identifier` test
      // below now pins it, because a config that lints nothing reports success.
      ...js.configs.recommended.rules,
      // An underscore prefix is this codebase's existing way of saying "this
      // parameter exists to hold a position" — e.g. a test stub that must accept an
      // argument it ignores. Renaming those to satisfy a linter would lose the
      // signal; exempting them keeps `no-unused-vars` pointed at real dead code,
      // which is what it found seven of.
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
];

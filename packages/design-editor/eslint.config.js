import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * This package had no lint at all — no config, no script, no lane — while carrying ~17 React
 * files. That is how a `useState` below an early return reached `main`: `react-hooks` lives in
 * `packages/frontend`'s config and was never going to see this tree.
 *
 * Deliberately NOT a copy of the frontend's config. Two differences matter:
 *
 *   - `react-refresh` is absent. It exists to keep HMR boundaries clean in an app; the shell
 *     is a prebuilt bundle and the frame is the consumer's own HMR, so the rule would only
 *     produce noise about our panel exports.
 *   - `scripts/**` and `src/server/**` are `.mjs` running in Node, so they get Node globals
 *     rather than browser ones. Getting that wrong reports `process` as undefined across the
 *     gates.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'fixtures/**', 'node_modules/**'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      /*
       * `_props`, `_cb`: the underscore is this repo's existing convention for a binding kept
       * for its position in a signature. Reporting it would ask for the parameter to be
       * deleted, which changes the signature the caller relies on.
       */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      /*
       * `warn` and `error` only. A published package should not leak a stray `console.log`,
       * and the three calls this tree actually makes are all `console.warn` reporting
       * something a developer needs to see — a manifest that would not parse, a duplicate
       * scene id, a frame mounted twice. Forbidding those would buy an injected logger for
       * no gain; forbidding `log` is the part worth keeping.
       */
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    /*
     * The gates and the injector: Node scripts, no React.
     *
     * Node globals AND browser ones, which is not sloppiness — the gates are full of
     * `page.evaluate(() => window.…)` closures whose bodies are serialised and run in the
     * BROWSER. Node-only globals reported nine `window`/`getComputedStyle` as undefined:
     * a config artefact, not nine defects, and the kind of noise that makes a new lane get
     * ignored on its first run.
     */
    extends: [js.configs.recommended],
    files: ['scripts/**/*.mjs', 'src/server/**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.node, ...globals.browser } },
  },
);

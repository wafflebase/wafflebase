import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { LanguageSupport, StreamLanguage } from '@codemirror/language';
import { c, cpp, java } from '@codemirror/legacy-modes/mode/clike';
import { go } from '@codemirror/legacy-modes/mode/go';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { shell } from '@codemirror/legacy-modes/mode/shell';

/**
 * Every language pack the source pane can highlight inside a fenced code
 * block, in ONE module. `code-languages.ts` reaches it only through a dynamic
 * `import()`, so the bundler emits a single lazy chunk that loads the first
 * time a note shows a fence in a known language — not one chunk per
 * language, which is what `@codemirror/language-data` costs and what the
 * frontend chunk-count gate would refuse.
 */
const stream = (parser: Parameters<typeof StreamLanguage.define>[0]) =>
  new LanguageSupport(StreamLanguage.define(parser));

export const packs = {
  javascript: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  typescript: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  json: () => json(),
  python: () => python(),
  css: () => css(),
  html: () => html(),
  sql: () => sql(),
  yaml: () => yaml(),
  shell: () => stream(shell),
  go: () => stream(go),
  rust: () => stream(rust),
  c: () => stream(c),
  cpp: () => stream(cpp),
  java: () => stream(java),
} satisfies Record<string, () => LanguageSupport>;

export type PackName = keyof typeof packs;

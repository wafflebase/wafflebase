import { LanguageDescription } from '@codemirror/language';
// Type-only, so the packs module stays behind the dynamic import below.
import type { PackName } from './code-language-packs.js';

/**
 * Fence info strings the source pane recognizes, by pack name. Kept apart
 * from the packs themselves (`code-language-packs.ts`) so only this small
 * table rides in the editor bundle; the grammars load on first use.
 * Aliases are the common spellings of each language's fence; most are the
 * ones highlight.js accepts in the preview, which covers more languages than
 * this set, so some fences are coloured only in the preview.
 */
const ALIASES: Record<PackName, string[]> = {
  javascript: ['js', 'mjs', 'cjs', 'node'],
  jsx: [],
  typescript: ['ts', 'mts', 'cts'],
  tsx: [],
  json: ['jsonc', 'json5'],
  python: ['py'],
  css: [],
  html: ['htm', 'xml', 'svg'],
  sql: ['postgres', 'postgresql', 'mysql'],
  yaml: ['yml'],
  shell: ['sh', 'bash', 'zsh', 'console', 'shellsession'],
  go: ['golang'],
  rust: ['rs'],
  c: ['h'],
  cpp: ['c++', 'cc', 'cxx', 'hpp'],
  java: [],
};

const descriptions: LanguageDescription[] = (
  Object.entries(ALIASES) as [PackName, string[]][]
).map(([name, alias]) =>
  LanguageDescription.of({
    name,
    alias,
    load: () => import('./code-language-packs.js').then((m) => m.packs[name]()),
  }),
);

/**
 * The fence's language for `markdown({ codeLanguages })`: the first word of
 * the info string, matched exactly. lang-markdown's default lookup is fuzzy
 * — any alias longer than two letters found anywhere in the info string
 * wins — so ```graphql parsed as SQL and ```typescript-old as JavaScript.
 * The preview reads the same first word, exactly.
 */
export function noteCodeLanguage(info: string): LanguageDescription | null {
  const name = info.trim().split(/\s+/)[0] ?? '';
  if (!name) return null;
  return LanguageDescription.matchLanguageName(descriptions, name, false);
}

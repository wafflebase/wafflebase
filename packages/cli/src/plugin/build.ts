import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProgram } from '../cli.js';
import { buildSafetyTable } from './safety-table.js';
import { version } from '../../package.json';

const here = fileURLToPath(new URL('.', import.meta.url));

/** `packages/cli/skills/` — the single source of the CLI's agent docs. */
export const CLI_SKILLS_DIR = resolve(here, '../../skills');
/** `plugins/wafflebase/` at the repository root. */
export const PLUGIN_DIR = resolve(here, '../../../../plugins/wafflebase');

/**
 * Which plugin skill carries which CLI skill file as a reference. Every
 * file in `packages/cli/skills/` except its index must appear exactly once
 * — the drift test enforces it, so a new CLI skill cannot be forgotten.
 */
export const PLUGIN_REFERENCES: Record<string, readonly string[]> = {
  wafflebase: ['files-upload-download.md'],
  'wafflebase-sheets': [
    'sheets-read-cells.md',
    'sheets-write-cells.md',
    'sheets-import-export.md',
    'recipe-csv-pipeline.md',
    'recipe-data-collect.md',
  ],
  'wafflebase-docs': [
    'docs-manage.md',
    'docs-read-content.md',
    'docs-import-docx.md',
    'docs-export-docx.md',
    'docs-export-pdf.md',
    'recipe-doc-to-markdown.md',
    'recipe-docx-to-pdf.md',
  ],
  'wafflebase-slides': [
    'slides-manage.md',
    'slides-read-content.md',
    'slides-import-pptx.md',
    'slides-export-pptx.md',
  ],
};

/** CLI skill files that are not references (the index of the others). */
const CLI_SKILLS_INDEX = 'SKILL.md';

export function listCliSkillFiles(): string[] {
  return readdirSync(CLI_SKILLS_DIR)
    .filter((f) => f.endsWith('.md') && f !== CLI_SKILLS_INDEX)
    .sort();
}

/** `manifest` with `version` set, placed right after `displayName`. */
function withVersion(
  manifest: Record<string, unknown>,
  v: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(manifest)) {
    if (k === 'version') continue;
    out[k] = val;
    if (k === 'displayName') out.version = v;
  }
  out.version ??= v;
  return out;
}

/**
 * Every generated plugin file, keyed by its path relative to
 * `plugins/wafflebase/`. `pnpm cli build:plugin` writes these; the drift
 * test compares them with what is committed.
 */
export function generatePluginFiles(): Map<string, string> {
  const files = new Map<string, string>();

  // The plugin ships in lockstep with the CLI whose commands it classifies.
  const manifest = JSON.parse(
    readFileSync(join(PLUGIN_DIR, '.claude-plugin/plugin.json'), 'utf8'),
  ) as Record<string, unknown>;
  files.set(
    '.claude-plugin/plugin.json',
    `${JSON.stringify(withVersion(manifest, version), null, 2)}\n`,
  );

  const table = buildSafetyTable(buildProgram(), version);
  files.set(
    'hooks/command-safety.json',
    `${JSON.stringify(table, null, 2)}\n`,
  );

  for (const [skill, refs] of Object.entries(PLUGIN_REFERENCES)) {
    for (const ref of refs) {
      files.set(
        join('skills', skill, 'references', ref),
        readFileSync(join(CLI_SKILLS_DIR, ref), 'utf8'),
      );
    }
  }
  return files;
}

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

/** Where the plugin mirrors `packages/cli/skills/`, relative to the plugin. */
export const REFERENCES_DIR = 'references';

/**
 * The CLI's agent docs, mirrored whole into one directory rather than split
 * per skill: they link to each other by relative path (`[x](sheets-read-cells.md)`),
 * and a mirror keeps every one of those links working.
 */
export function listCliSkillFiles(): string[] {
  return readdirSync(CLI_SKILLS_DIR)
    .filter((f) => f.endsWith('.md'))
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

  for (const ref of listCliSkillFiles()) {
    files.set(
      join(REFERENCES_DIR, ref),
      readFileSync(join(CLI_SKILLS_DIR, ref), 'utf8'),
    );
  }
  return files;
}

// Regenerate the Claude Code plugin's files that restate CLI facts:
// the guard's command-safety table and the skills' reference copies.
// `test/plugin.test.ts` fails when the committed copies are stale.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  PLUGIN_DIR,
  PLUGIN_REFERENCES,
  generatePluginFiles,
} from '../src/plugin/build.js';

// Drop references that are no longer mapped, so a removed CLI skill does
// not linger in the plugin.
for (const skill of Object.keys(PLUGIN_REFERENCES)) {
  const dir = join(PLUGIN_DIR, 'skills', skill, 'references');
  try {
    for (const f of readdirSync(dir)) rmSync(join(dir, f));
  } catch {
    // Directory does not exist yet.
  }
}

for (const [rel, content] of generatePluginFiles()) {
  const path = join(PLUGIN_DIR, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`wrote plugins/wafflebase/${rel}`);
}

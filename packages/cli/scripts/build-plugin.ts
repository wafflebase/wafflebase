// Regenerate the Claude Code plugin's files that restate CLI facts:
// the guard's command-safety table and the skills' reference copies.
// `test/plugin.test.ts` fails when the committed copies are stale.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  PLUGIN_DIR,
  REFERENCES_DIR,
  generatePluginFiles,
} from '../src/plugin/build.js';

// Generate first: if it throws, nothing on disk has been touched.
const files = generatePluginFiles();

// The mirror is rebuilt from scratch, so a removed CLI skill does not
// linger in the plugin.
rmSync(join(PLUGIN_DIR, REFERENCES_DIR), { recursive: true, force: true });

for (const [rel, content] of files) {
  const path = join(PLUGIN_DIR, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`wrote plugins/wafflebase/${rel}`);
}

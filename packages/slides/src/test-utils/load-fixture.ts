import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { SlidesDocument } from '../model/presentation';

// `__dirname` isn't available in ESM, so resolve the fixture root
// relative to this module's URL. Fixture decks live at
// `packages/slides/test-fixtures/decks/<name>.json`.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_ROOT = join(__dirname, '..', '..', 'test-fixtures', 'decks');

/**
 * Load a reference deck fixture by name. Returns a plain JS
 * `SlidesDocument` — themes / masters / layouts are usually empty
 * arrays, with the visual-test injecting the real registries at render
 * time so a single fixture can be swept across N themes.
 */
export function loadDeckFixture(name: string): SlidesDocument {
  const path = join(FIXTURE_ROOT, `${name}.json`);
  const parsed = JSON.parse(readFileSync(path, 'utf-8'));
  if (!parsed?.meta || !Array.isArray(parsed?.slides)) {
    throw new Error(
      `Invalid deck fixture '${name}': missing meta or slides`,
    );
  }
  return parsed as SlidesDocument;
}

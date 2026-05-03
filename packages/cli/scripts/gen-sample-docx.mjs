// One-shot generator for the docs CLI integration fixture. The
// integration test (`packages/backend/test/docs-cli-roundtrip.e2e-spec.ts`)
// reads the produced `.docx` so the test itself doesn't need to
// import `@wafflebase/docs` — that import path runs through ts-jest's
// strict CommonJS interop, which trips on JSZip's default-export shape.
//
// Run via `pnpm --filter @wafflebase/cli exec tsx scripts/gen-sample-docx.mjs`
// (the script depends on tsx/ESM resolution from inside the CLI's
// node_modules tree). Re-run only when the desired fixture content
// changes — the produced `.docx` is committed to the repo.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DocxExporter,
  DEFAULT_BLOCK_STYLE,
} from '@wafflebase/docs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const OUT_PATH = resolve(
  REPO_ROOT,
  'packages/backend/test/fixtures/docs-cli-sample.docx',
);

const HEADING_TEXT = 'Integration Test Heading';

function paragraph(id, text) {
  return {
    id,
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

function heading(id, level, text) {
  return {
    id,
    type: 'heading',
    headingLevel: level,
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

const doc = {
  blocks: [
    heading('h1', 1, HEADING_TEXT),
    paragraph('p1', 'First paragraph of the sample document.'),
    paragraph('p2', 'Second paragraph with a bit more content.'),
  ],
};

const blob = await DocxExporter.export(doc);
const bytes = new Uint8Array(await blob.arrayBuffer());
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, bytes);
console.log(`wrote ${bytes.length} bytes → ${OUT_PATH}`);

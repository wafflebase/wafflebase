// One-shot generator for the slides CLI integration fixture. The
// integration test (`packages/backend/test/slides-pptx-import.e2e-spec.ts`)
// reads the produced `.pptx` so the test itself doesn't need to import
// `@wafflebase/slides`'s fixture builder — that import path runs through
// ts-jest's strict CommonJS interop, which trips on JSZip's default-
// export shape (the same trap that forced the docs `.docx` to be
// pre-generated; see `gen-sample-docx.mjs`).
//
// Run via `pnpm --filter @wafflebase/cli exec tsx scripts/gen-sample-pptx.mjs`
// (the script depends on tsx/ESM resolution from inside the CLI's
// node_modules tree). Re-run only when the desired fixture content
// changes — the produced `.pptx` is committed to the repo.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Relative import — `__fixtures__/` is not in the slides package's
// public exports map (and shouldn't be), but `tsx` resolves the TS
// source directly across workspace boundaries.
import { buildMinimalPptx } from '../../slides/test/import/pptx/__fixtures__/build-minimal-pptx.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const OUT_PATH = resolve(
  REPO_ROOT,
  'packages/backend/test/fixtures/slides-cli-sample.pptx',
);

const arrayBuf = await buildMinimalPptx();
const bytes = new Uint8Array(arrayBuf);
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, bytes);
console.log(`wrote ${bytes.length} bytes → ${OUT_PATH}`);

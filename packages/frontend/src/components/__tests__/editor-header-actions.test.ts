import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../../app');

/**
 * Every editor layout that mounts `SiteHeader`.
 *
 * `SiteHeader` fixes the order of the document controls (Present, Comments,
 * History, Export, Share, presence), but only for a caller that passes them
 * as `actions` slots. The free-form `children` row still exists for the
 * static-file viewers, and an editor that drifted back onto it would be free
 * to reorder its controls again — which is how sheet, docs, slides and board
 * each ended up with a different header. So the editors are pinned to the
 * slots here.
 */
const EDITORS = [
  'documents/document-detail.tsx',
  'docs/docs-detail.tsx',
  'slides/slides-detail.tsx',
  'board/board-detail.tsx',
  'notes/notes-detail.tsx',
];

describe('editor header actions', () => {
  it.each(EDITORS)('%s fills the header slots instead of a free-form row', (file) => {
    const source = readFileSync(path.join(appDir, file), 'utf8');

    expect(source.includes('<SiteHeader'), `${file} no longer mounts SiteHeader`).toBe(
      true,
    );
    expect(source.includes('actions={{'), `${file} should pass actions slots`).toBe(
      true,
    );
    // A closing tag means children were passed.
    expect(
      source.includes('</SiteHeader>'),
      `${file} passes SiteHeader children; use the actions slots`,
    ).toBe(false);
  });
});

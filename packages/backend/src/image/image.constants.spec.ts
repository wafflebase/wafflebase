import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { unsupportedFileTypeMessage } from './image.constants';

const SRC_ROOT = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('unsupportedFileTypeMessage', () => {
  it('renders the MIME type into the message', () => {
    expect(unsupportedFileTypeMessage('application/zip')).toBe(
      'Unsupported file type: application/zip',
    );
  });

  /**
   * Deduplicating the four literals fixes today; this is what keeps them from
   * coming back. Two upload routes' `fileFilter`s claim to answer exactly what
   * `ImageService.upload` would have answered, and each route's spec asserts
   * that against a **mocked** service — a test double cannot pin a claim about
   * the collaborator it replaces. So the property "there is one wording" has
   * to be asserted about the source itself, not about behaviour: a fifth site
   * spelling the message out again would restore the drift this function was
   * introduced to remove while every existing test stayed green.
   *
   * Scoped to `packages/backend/src` and to non-spec files: the specs
   * deliberately hardcode the rendered string (that is what makes them
   * independent of this function), and the frontend's
   * `app/spreadsheet/image-upload.ts` has its own client-side copy that never
   * reaches this service.
   */
  it('is the only place in backend src that spells the message out', () => {
    const offenders = sourceFiles(SRC_ROOT)
      .filter((f) => /Unsupported file type/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC_ROOT, f).split(sep).join('/'));

    expect(offenders).toEqual(['image/image.constants.ts']);
  });
});

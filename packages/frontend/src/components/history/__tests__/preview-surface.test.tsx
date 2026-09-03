import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EditingChrome, PreviewSurface } from '../preview-surface';

describe('PreviewSurface', () => {
  // `RevisionPreview` is `absolute inset-0`, so what it covers is decided by
  // which ancestor is `position: relative`. The whole point of this
  // component is that the preview's positioned ancestor is the one holding
  // the chrome it is meant to replace as well as the canvas.
  it('makes the preview cover every child, chrome included', () => {
    render(
      <PreviewSurface preview={<div data-testid="preview" />}>
        <div data-testid="canvas" />
        <button type="button">Delete sheet</button>
      </PreviewSurface>,
    );

    const surface = screen.getByTestId('preview').parentElement;
    expect(surface).not.toBeNull();
    expect(surface!.className).toContain('relative');
    expect(surface).toContainElement(screen.getByTestId('canvas'));
    expect(surface).toContainElement(
      screen.getByRole('button', { name: 'Delete sheet' }),
    );
  });

  it('renders the preview after the children so it paints on top', () => {
    render(
      <PreviewSurface preview={<div data-testid="preview" />}>
        <div data-testid="canvas" />
      </PreviewSurface>,
    );
    const surface = screen.getByTestId('preview').parentElement!;
    expect(surface.lastElementChild).toBe(screen.getByTestId('preview'));
  });

  it('renders nothing extra when no preview is open', () => {
    render(
      <PreviewSurface>
        <div data-testid="canvas" />
      </PreviewSurface>,
    );
    expect(screen.getByTestId('canvas').parentElement!.childElementCount).toBe(1);
  });

  // The base box is the row-flex wrapper the editors already had around
  // their canvas, so adopting the component changes no non-preview layout.
  // Sheets, whose surface is the grid column, passes `flex-col`.
  it('defaults to the row-flex box the editors already had', () => {
    render(
      <PreviewSurface>
        <div data-testid="canvas" />
      </PreviewSurface>,
    );
    expect(screen.getByTestId('canvas').parentElement!.className).toBe(
      'relative flex flex-1 min-w-0',
    );
  });

  it('lets a caller add to the box without losing the base classes', () => {
    render(
      <PreviewSurface className="flex-col">
        <div data-testid="canvas" />
      </PreviewSurface>,
    );
    const className = screen.getByTestId('canvas').parentElement!.className;
    expect(className).toContain('relative');
    expect(className).toContain('flex-1');
    expect(className).toContain('flex-col');
  });
});

describe('EditingChrome', () => {
  // Not rendering is strictly stronger than disabling: there is no control
  // to click, focus, or reach with a screen reader.
  it('removes its chrome while a preview is open', () => {
    render(
      <EditingChrome previewing>
        <button type="button">Delete slide</button>
      </EditingChrome>,
    );
    expect(
      screen.queryByRole('button', { name: 'Delete slide' }),
    ).not.toBeInTheDocument();
  });

  // And adds no wrapper of its own when it is not previewing, so the
  // non-preview DOM is exactly what it was before the component existed.
  it('renders its chrome unwrapped when no preview is open', () => {
    const { container } = render(
      <EditingChrome previewing={false}>
        <button type="button">Delete slide</button>
      </EditingChrome>,
    );
    expect(
      screen.getByRole('button', { name: 'Delete slide' }),
    ).toBeInTheDocument();
    expect(container.firstElementChild).toBe(
      screen.getByRole('button', { name: 'Delete slide' }),
    );
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../../../app');

/**
 * Each wired editor's file, and the editing chrome a preview must contain,
 * split by which of the two mechanisms contains it.
 *
 * Before this was enforced, every one of these components stayed live and
 * clickable underneath an open preview: the overlay was mounted beside the
 * canvas alone, so the toolbar above it (slides, notes) and the tab bar
 * below it (sheets) still mutated the real document.
 *
 * - `covered` — inside `<PreviewSurface>`, hidden because the overlay
 *   paints over it.
 * - `removed` — inside `<EditingChrome>`, not rendered at all. This is for
 *   chrome that must stay full-width above the row that also holds the
 *   right-slot panels; pulling it into the surface would narrow it by the
 *   panel's width whenever one is open.
 *
 * **This is an allowlist, and it has to be maintained.** It can only catch
 * chrome it has been told about, so a component added to one of these files
 * outside both `PreviewSurface` and `EditingChrome` passes silently until
 * its tag is listed here. Add every new interactive control that can reach
 * the live document to the right column when you add it to the layout.
 *
 * `board-detail` is here for completeness — `BoardToolbar` is rendered by
 * `BoardView` itself, so board was already covered — and it pins that,
 * rather than leaving the one editor that happens to be correct unguarded.
 */
const WIRED_EDITORS: Array<{
  file: string;
  covered: string[];
  removed: string[];
}> = [
  {
    file: 'slides/slides-detail.tsx',
    covered: ['<SlidesView'],
    removed: ['<SlidesToolbar'],
  },
  {
    file: 'notes/notes-detail.tsx',
    covered: ['<NotesView'],
    removed: ['<NotesToolbar'],
  },
  {
    file: 'documents/document-detail.tsx',
    covered: ['<SheetView', '<TabBar'],
    removed: [],
  },
  { file: 'board/board-detail.tsx', covered: ['<BoardView'], removed: [] },
];

/** Index of `tag`, asserted to fall strictly between `open` and `close`. */
function assertBetween(
  source: string,
  tag: string,
  open: number,
  close: number,
  message: string,
) {
  const at = source.indexOf(tag);
  expect(at, `renders no ${tag}`).toBeGreaterThan(-1);
  expect(at > open && at < close, message).toBe(true);
}

describe('the preview containment of every wired editor', () => {
  it.each(WIRED_EDITORS)(
    '$file contains all of its editing chrome while a preview is open',
    ({ file, covered, removed }) => {
      const source = readFileSync(path.join(appDir, file), 'utf8');

      const surfaceOpen = source.indexOf('<PreviewSurface');
      const surfaceClose = source.indexOf('</PreviewSurface>');
      expect(surfaceOpen, `${file} does not use PreviewSurface`).toBeGreaterThan(
        -1,
      );
      expect(surfaceClose).toBeGreaterThan(surfaceOpen);

      // The overlay is the surface's `preview`, so it is declared inside the
      // opening tag — before the children it must cover.
      const overlay = source.indexOf('<RevisionPreviewOverlay');
      expect(overlay).toBeGreaterThan(surfaceOpen);
      expect(overlay).toBeLessThan(surfaceClose);

      for (const tag of covered) {
        assertBetween(
          source,
          tag,
          surfaceOpen,
          surfaceClose,
          `${file} renders ${tag} outside <PreviewSurface>, so an open ` +
            `preview leaves it live and clickable`,
        );
      }

      if (removed.length === 0) return;

      const chromeOpen = source.indexOf('<EditingChrome');
      const chromeClose = source.indexOf('</EditingChrome>');
      expect(chromeOpen, `${file} does not use EditingChrome`).toBeGreaterThan(
        -1,
      );
      expect(chromeClose).toBeGreaterThan(chromeOpen);

      for (const tag of removed) {
        assertBetween(
          source,
          tag,
          chromeOpen,
          chromeClose,
          `${file} renders ${tag} outside <EditingChrome>, so an open ` +
            `preview leaves it live and clickable`,
        );
      }
    },
  );

  // The two mechanisms must be driven by one expression. Wired to two
  // conditions that could disagree, a preview could paint over a toolbar
  // that was never removed — the original bug — or remove the toolbar with
  // no preview painted.
  it.each(WIRED_EDITORS.filter((e) => e.removed.length > 0))(
    '$file drives both mechanisms from one `previewing` flag',
    ({ file }) => {
      const source = readFileSync(path.join(appDir, file), 'utf8');
      expect(source).toContain('const previewing = Boolean(');
      expect(source).toContain('<EditingChrome previewing={previewing}>');
      expect(source).toMatch(/preview=\{\s*previewing &&/);
    },
  );
});

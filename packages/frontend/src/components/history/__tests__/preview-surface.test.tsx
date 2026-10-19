import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CommentPopover } from '@/app/spreadsheet/components/comments/CommentPopover';
import { CommentSidePanel } from '@/components/comments/components/CommentSidePanel';
import type { SheetCellAnchor, Thread } from '@/types/comments';

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

/**
 * The comment surfaces, rendered for real through the containment component
 * the editors withhold them with.
 *
 * The source assertions further down pin the *wiring* — which expression
 * gates which render site — and they cannot see what the DOM ends up with:
 * a grep passes just as well if the surface escapes through a portal, since
 * a portal still renders its children into `document.body`. So these mount
 * the real `CommentPopover` and the real `CommentSidePanel` and ask the
 * document itself, by role and by text, whether any control that writes the
 * live CRDT survived.
 *
 * Mounting `SheetView` or `DocsView` around them is not reachable here —
 * each needs a Yorkie document, a Canvas engine and a router — so the
 * assertion is placed on the mechanism plus the real comment UI, and the
 * wiring tests keep the editors attached to it.
 */
const commentAuthor = { userId: 'u1', username: 'alice' };

function sheetThread(): Thread<SheetCellAnchor> {
  return {
    id: 't1',
    anchor: { kind: 'sheet-cell', tabId: 'tab1', rowId: 'r1', colId: 'c1' },
    comments: [
      {
        id: 'c1',
        author: commentAuthor,
        body: 'the comment body',
        createdAt: 1_700_000_000_000,
      },
    ],
    resolved: false,
    createdAt: 1_700_000_000_000,
  };
}

const popoverHandlers = () => ({
  onAddThread: vi.fn().mockResolvedValue(undefined),
  onReply: vi.fn().mockResolvedValue(undefined),
  onResolve: vi.fn().mockResolvedValue(undefined),
  onEditComment: vi.fn().mockResolvedValue(undefined),
  onDeleteComment: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
});

describe('withholding the comment surfaces from a preview', () => {
  it('leaves no sheet comment popover control in the document', () => {
    render(
      <EditingChrome previewing>
        <CommentPopover
          threads={[sheetThread()]}
          currentUser={commentAuthor}
          {...popoverHandlers()}
        />
      </EditingChrome>,
    );

    // Every control here is a `doc.update()` on the LIVE document behind the
    // preview: the reply box, Resolve, and the menu holding Edit / Delete.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resolve thread' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    // Asked of the whole document, not of a subtree: a surface that escaped
    // through a portal would still land in `document.body`.
    expect(document.body.textContent).not.toContain('the comment body');
  });

  it('restores every one of them when no preview is open', () => {
    render(
      <EditingChrome previewing={false}>
        <CommentPopover
          threads={[sheetThread()]}
          currentUser={commentAuthor}
          {...popoverHandlers()}
        />
      </EditingChrome>,
    );

    // The other half of the promise: withholding is for the duration of the
    // preview only, so none of this is lost.
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resolve thread' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
    expect(document.body.textContent).toContain('the comment body');
  });

  it('leaves no comments panel row in the document', () => {
    render(
      <EditingChrome previewing>
        <CommentSidePanel<SheetCellAnchor>
          threads={[sheetThread()]}
          onJumpTo={vi.fn()}
          onClose={vi.fn()}
        />
      </EditingChrome>,
    );

    // Jump-to-comment is the panel's live-document control: it moves the
    // real grid behind the preview and opens the live popover over it.
    expect(
      screen.queryByRole('button', { name: 'Jump to comment by alice' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Close comments panel' }),
    ).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull();
    expect(document.body.textContent).not.toContain('the comment body');
  });

  it('restores the comments panel when no preview is open', () => {
    render(
      <EditingChrome previewing={false}>
        <CommentSidePanel<SheetCellAnchor>
          threads={[sheetThread()]}
          onJumpTo={vi.fn()}
          onClose={vi.fn()}
        />
      </EditingChrome>,
    );

    expect(
      screen.getByRole('button', { name: 'Jump to comment by alice' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Close comments panel' }),
    ).toBeTruthy();
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
    // The comments toggle, by its icon — the one tag in the header button
    // that is unique to it. It goes with the panel it owns: left rendered,
    // it reports `aria-pressed` for a panel that is not there, and clicking
    // it flips the toggle off so closing the preview gives nothing back.
    removed: ['<IconMessage'],
  },
  { file: 'board/board-detail.tsx', covered: ['<BoardView'], removed: [] },
];

/** Every `useEffect(...)` call in `source`, sliced on balanced parentheses. */
function effectBodies(source: string): string[] {
  const bodies: string[] = [];
  for (
    let at = source.indexOf('useEffect(');
    at > -1;
    at = source.indexOf('useEffect(', at + 1)
  ) {
    let depth = 0;
    let i = at + 'useEffect'.length;
    for (; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')' && --depth === 0) break;
    }
    bodies.push(source.slice(at, i + 1));
  }
  return bodies;
}

/**
 * The attribute block of the self-closing `<Tag … />` element in `source`.
 *
 * Asserting on the whole file instead is a fail-open: every host in this
 * suite also renders `<EditingChrome previewing={previewing}>`, so a
 * file-wide `/previewing=\{previewing\}/` matches with the prop missing from
 * the editor it is supposed to be on.
 */
function jsxElement(source: string, tag: string): string {
  // `[\s/>]` after the name, so `<UserPresenceType["activeCell"]>` — a type
  // cast earlier in the same file — is not mistaken for the element.
  const open = source.search(new RegExp(`<${tag}[\\s/>]`));
  expect(open, `renders no <${tag}`).toBeGreaterThan(-1);
  const close = source.indexOf('/>', open);
  expect(close, `<${tag} is not self-closing`).toBeGreaterThan(-1);
  return source.slice(open, close + 2);
}

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

  /**
   * The comment surfaces are the third case, and neither mechanism above
   * reaches them.
   *
   * Containment by covering only works for children that paint *below* the
   * overlay, and both comment surfaces are z-indexed above its `z-20`: the
   * panel is `z-40` and lives outside the surface entirely (sheets), and the
   * sheet comment popover is `absolute z-30` inside it. Both stayed clickable
   * under a banner reading "Viewing a version", and every control on them —
   * Reply, Resolve, Edit, Delete — is a `doc.update()` on the LIVE document.
   * So they are withheld, like `EditingChrome`'s toolbars.
   *
   * Asserted on the source because mounting either editor means mounting a
   * Yorkie document, a canvas engine and a router; the conditional is the
   * whole fix, and it is one line in each file.
   */
  it.each(['docs/docs-detail.tsx', 'documents/document-detail.tsx'])(
    '%s withholds its comments panel while a preview is open',
    (file) => {
      const source = readFileSync(path.join(appDir, file), 'utf8');
      expect(source).toContain('commentsPanelOpen && !previewing');
      // And the flag is the same one the overlay is driven by, so the panel
      // cannot be withheld with no preview painted, or left live under one.
      expect(source).toContain('const previewing = Boolean(');
      expect(source).toMatch(/preview=\{\s*previewing &&/);
    },
  );

  // The panel's own toggle state is never written from the preview: a preview
  // is a view, not a preference, so closing it has to give the panel back.
  it('writes the sheet panel toggle only from a user action, never from a preview', () => {
    const source = readFileSync(
      path.join(appDir, 'documents/document-detail.tsx'),
      'utf8',
    );
    // The literal shape: the preview flag read straight into the setter.
    expect(source).not.toMatch(/setCommentsPanelOpen\([^)]*previewing/);
    // And the shape that regex cannot see, which is the one a "repair" of the
    // next bug reported against this area would actually take: an effect
    // keyed on `previewing` that closes the panel. The regex above misses it
    // because the setter call and the flag sit on different lines. So the
    // rule is asserted structurally instead — the panel's state is written
    // only by a click or a shortcut, never by a render-time reaction.
    for (const body of effectBodies(source)) {
      expect(
        body.includes('setCommentsPanelOpen'),
        'an effect writes commentsPanelOpen, so a preview could close the ' +
          'panel for good instead of withholding it',
      ).toBe(false);
    }
  });

  // The keyboard twin of the header toggle `EditingChrome` withholds. It is
  // bound on `window` by `SheetView` itself, so the preview's capture-phase
  // suppressor only covers it once that lazy chunk has mounted — and flipping
  // `commentsPanelOpen` from under a preview is exactly the state write the
  // wrapper exists to prevent.
  it('sheet-view refuses the comments-panel shortcut while previewing', () => {
    const source = readFileSync(
      path.join(appDir, 'spreadsheet/sheet-view.tsx'),
      'utf8',
    );
    const handler = source.indexOf('const handleKeyDown');
    const toggle = source.indexOf('onToggleCommentsPanel?.()');
    expect(handler).toBeGreaterThan(-1);
    expect(toggle).toBeGreaterThan(handler);
    expect(source.slice(handler, toggle)).toContain('if (previewing) return;');
  });

  // The other two sheet surfaces that outrank the overlay. The mobile cell
  // editor is the worst of them: `fixed inset-x-0 z-50` leaves the surface
  // box entirely, and its commit is a write to the live sheet.
  it('sheet-view withholds every surface that paints above the overlay', () => {
    const source = readFileSync(
      path.join(appDir, 'spreadsheet/sheet-view.tsx'),
      'utf8',
    );
    expect(source).toContain('{isMobile && mobileEditState && !previewing && (');
    expect(source).toContain('{linkHover && !previewing && (');
  });

  // Docs has the same hole in two more places: its comment popover and its
  // insert-comment dialog are both `fixed … z-50`, so the host withholding
  // the *panel* alone left the live-write controls reachable.
  it('docs-view withholds its comment popover and compose dialog', () => {
    const source = readFileSync(path.join(appDir, 'docs/docs-view.tsx'), 'utf8');
    expect(source).toContain('previewing = false');
    expect(source).toContain('{comments.active && !previewing && (');
    expect(source).toContain('{comments.composeOpen && !previewing && (');
    // And the shortcut that opens either of them, for the same reason the
    // sheet's is guarded.
    const handler = source.indexOf('// Keyboard shortcuts for comments.');
    const toggle = source.indexOf('comments.togglePanel()', handler);
    expect(handler).toBeGreaterThan(-1);
    expect(toggle).toBeGreaterThan(handler);
    expect(source.slice(handler, toggle)).toContain('if (previewing) return;');
  });

  /**
   * The comment surfaces were not the only `fixed` descendants of this view,
   * and the rule the gate states — withhold every surface that escapes the
   * surface box, regardless of its `z-index` — applies verbatim to four more.
   * Each is `fixed z-50`, two of them through a `document.body` portal, and
   * each carries a control that writes the LIVE document: the find bar's
   * Replace / Replace All (which drive `FindReplaceState` at the store
   * directly, bypassing the editor's read-only neutralization), the link
   * popover's Edit / Remove link, and the two context menus' spell
   * corrections, paste, insert link and table row/column operations.
   *
   * None of them is reachable by *opening* one under a preview — the overlay
   * takes the pointer — but every one survives into the preview if it was
   * already open when it opened, which is what a pointer-driven "open the
   * version panel" does.
   */
  it.each([
    ['DocsLinkPopover', '{!previewing && (\n        <DocsLinkPopover'],
    ['DocsFindBar', '{findBarOpen && !previewing && (\n        <DocsFindBar'],
    [
      'DocsTableContextMenu',
      '{!previewing && (\n        <DocsTableContextMenu',
    ],
    ['DocsContextMenu', '{!previewing && (\n        <DocsContextMenu'],
  ])('docs-view withholds %s while a preview is open', (_name, guard) => {
    const source = readFileSync(path.join(appDir, 'docs/docs-view.tsx'), 'utf8');
    expect(source).toContain(guard);
  });

  // Withholding the find bar unmounts it, and its query is its own component
  // state — so the highlights it pushed onto the editor would outlive the bar
  // that explains them unless the view clears them, and a staged link-edit
  // request would reopen the popover at pre-preview coordinates.
  it('docs-view clears the find highlights it withholds the bar for', () => {
    const source = readFileSync(path.join(appDir, 'docs/docs-view.tsx'), 'utf8');
    const reset = effectBodies(source).find((b) =>
      b.includes('clearSearchMatches'),
    );
    expect(reset, 'no effect clears the search highlights').toBeTruthy();
    expect(reset!).toContain('if (!previewing) return;');
    expect(reset!).toContain('setFindBarOpen(false)');
    expect(reset!).toContain('setLinkInputRequest(null)');
    // Not `clearSearchMatches(true)`: moving the caret to the last match
    // publishes presence from a document the user is no longer looking at.
    expect(reset!).not.toContain('clearSearchMatches(true)');
  });

  it('docs-detail hands docs-view the same previewing flag', () => {
    const source = readFileSync(path.join(appDir, 'docs/docs-detail.tsx'), 'utf8');
    expect(jsxElement(source, 'DocsView')).toMatch(/previewing=\{previewing\}/);
  });

  // The sheet popover is the one editing control a preview covers in the DOM
  // tree but not on screen.
  it('sheet-view withholds the comment popover while a preview is open', () => {
    const source = readFileSync(
      path.join(appDir, 'spreadsheet/sheet-view.tsx'),
      'utf8',
    );
    expect(source).toContain('previewing = false');
    expect(source).toContain(
      'const commentPopoverVisible = commentPopoverOpen && !previewing;',
    );
    // The three surfaces that put the popover on screen key off that one
    // value: the element itself and the two effects that place it. A
    // placement effect still running off `commentPopoverOpen` would measure
    // against a grid behind the preview.
    //
    // The `commentPopoverOpenRef` sync effect deliberately still reads
    // `commentPopoverOpen`, and must: the pinned anchor is what lets the
    // selection-change handler tell a remote repaint from a real move, so
    // dropping it during a preview would make the popover reopen on the
    // wrong cell. Only the three placement/render surfaces are gated.
    //
    // Narrow by construction — this catches the literal revert, not a
    // ternary or a newly added reader.
    expect(source).not.toMatch(/\{commentPopoverOpen &&/);
    expect(source).toMatch(/\{commentPopoverVisible && activeCellForComment &&/);
    expect(source).toContain('if (!commentPopoverVisible) setCommentPopoverPos(null);');
    expect(source).toContain(
      'if (!commentPopoverVisible || !activeCellForComment) return;',
    );
  });

  // The keyboard path to the composer writes axis IDs to the live root before
  // anything is typed, and the capture-phase suppressor that normally stops it
  // only exists once the lazily-loaded overlay has mounted. So the composer
  // refuses on its own as well, which also covers the window in between.
  it('sheet-view refuses the comment composer shortcut while previewing', () => {
    const source = readFileSync(
      path.join(appDir, 'spreadsheet/sheet-view.tsx'),
      'utf8',
    );
    const open = source.indexOf('const openCommentComposerForActiveCell');
    expect(open).toBeGreaterThan(-1);
    // Up to the first live write in the callback, so the guard has to come
    // before it rather than merely somewhere in the function.
    const body = source.slice(
      open,
      source.indexOf('storeRef.current?.ensureAxisOrder', open),
    );
    expect(body).toContain('if (previewing) return;');
  });

  // The host has to actually pass it; the prop defaults to `false`, so a
  // missing one fails open — the exact bug, silently.
  it('document-detail hands sheet-view the same previewing flag', () => {
    const source = readFileSync(
      path.join(appDir, 'documents/document-detail.tsx'),
      'utf8',
    );
    expect(jsxElement(source, 'SheetView')).toMatch(/previewing=\{previewing\}/);
  });

  // `UserPresence` sits in the header, OUTSIDE `EditingChrome`, so neither
  // half of the containment reaches it — and its peer jump moves the LIVE
  // grid/editor behind the preview and republishes this user's selection
  // there, the same live `doc.update()` the comments panel was withheld for.
  // The avatars are read-only and stay; the two callbacks that make one
  // clickable are what a preview withholds (`UserPresence` disables the
  // trigger and drops the jump hint without them).
  it.each([
    { file: 'documents/document-detail.tsx' },
    { file: 'docs/docs-detail.tsx' },
  ])('$file withholds the peer jump while previewing', ({ file }) => {
    const element = jsxElement(readFileSync(path.join(appDir, file), 'utf8'), 'UserPresence');
    expect(element).toContain('onSelectPeer={previewing ? undefined : handleSelectPeer}');
    expect(element).toContain('getJumpHint={previewing ? undefined : getJumpHint}');
  });

  // Belt to the host's braces: a jump staged in the instant before the
  // preview opened would otherwise land under the banner.
  it('sheet-view drops a staged peer jump while previewing', () => {
    const source = readFileSync(
      path.join(appDir, 'spreadsheet/sheet-view.tsx'),
      'utf8',
    );
    const effect = effectBodies(source).find((b) =>
      b.includes('sheet.focusCell(parseRef(peerJumpTarget.activeCell))'),
    );
    expect(effect, 'no effect applies the peer jump').toBeTruthy();
    // Consumed, not deferred: a jump left pending fires when the preview
    // closes, to wherever the peer was at an unrelated moment.
    expect(effect!).toMatch(
      /if \(previewing\) \{\s*lastHandledPeerJumpRequestIdRef\.current = peerJumpTarget\.requestId;\s*return;/,
    );
    expect(effect!.indexOf('if (previewing)')).toBeLessThan(
      effect!.indexOf('sheet.focusCell('),
    );
    expect(effect!).toContain('previewing, sheetRenderVersion');
  });

  // A restore remounts `SheetView` (`key={historyResetToken}`), which resets
  // the mount-local ref that remembers a jump was handled — so a peer jump
  // target that survives the restore is replayed onto the restored document.
  it('document-detail drops jump targets on restore', () => {
    const source = readFileSync(
      path.join(appDir, 'documents/document-detail.tsx'),
      'utf8',
    );
    const start = source.indexOf('const handleHistoryRestored = useCallback(');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('}, [doc]);', start));
    expect(body).toContain('setUndoJumpTarget(null);');
    expect(body).toContain('setPeerJumpTarget(null);');
    expect(body).toContain('setHistoryResetToken(');
  });

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

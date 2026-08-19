// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SceneNodeDetail } from '../../src/shell/scenes/SceneNodeDetail.tsx';
import type { Analysis, SceneNodeMeta } from '../../src/types.ts';
import type { StampRef } from '../../src/scenes/frame-protocol.ts';

/**
 * The read-only "what am I looking at" panel.
 *
 * WHY IT IS TESTED AT ALL, GIVEN IT ONLY READS. It is the only place the three
 * outcomes of `anchorFromStamp` become visible, and collapsing them is a silent
 * failure: an ambiguous click rendered as a plain node row invites the designer to
 * edit a node the tool has NOT identified, and a `created` node rendered as an
 * ordinary one invites an edit that has nowhere to be written. So each outcome is
 * pinned to a distinguishable output rather than to "renders without throwing".
 *
 * The two `instances`/`visibleRect` states are pinned for the same reason: they are
 * the difference between "this node is fine, just off-screen" and "you are about to
 * edit something you cannot see", and the measuring-in-progress case must claim
 * NEITHER.
 */

let root: Root | null = null;
let host: HTMLElement;

function render(ui: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(ui));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const analysis = (over: Partial<Analysis> = {}): Analysis => ({
  tokensUsed: [],
  colorBindings: [],
  scaleBindings: [],
  antiPatterns: {
    hardcodedPaletteColors: [],
    hardcodedNamedColors: [],
    hexLiterals: [],
    rgbHslLiterals: [],
    arbitraryPx: [],
  },
  ...over,
});

const stamp = (over: Partial<StampRef> = {}): StampRef => ({
  id: 'app/a.tsx#Page:0.1',
  component: 'Page',
  path: [0, 1],
  fp: 'fp1',
  tag: 'div',
  file: 'app/a.tsx',
  instances: 1,
  ...over,
});

const node = (over: Partial<SceneNodeMeta> = {}): SceneNodeMeta => ({
  path: [0, 1],
  tag: 'div',
  attrs: [],
  className: 'p-2',
  classNameExpr: null,
  identity: {},
  text: null,
  fp: 'fp1',
  fpx: 'fp1x',
  analysis: analysis(),
  scope: 'static',
  structuralEditable: true,
  repeated: false,
  clickSelectable: true,
  children: [],
  ...over,
});

const text = () => host.textContent ?? '';

describe('the three outcomes are distinguishable', () => {
  it('resolved — reports the node, and no warning banner', () => {
    render(
      <SceneNodeDetail
        selection={{ stamp: stamp(), anchor: { file: 'app/a.tsx', component: 'Page', path: [0, 1], tag: 'div', fp: 'fp1' }, node: node() }}
      />,
    );
    expect(text()).toContain('<div>');
    expect(text()).toContain('app/a.tsx');
    expect(text()).toContain('p-2');
    expect(text()).not.toContain('Ambiguous');
    expect(text()).not.toContain('Created this session');
  });

  it('ambiguous — REFUSES, names the count, and lists every candidate', () => {
    // The panel must not present one of them as the answer.
    render(
      <SceneNodeDetail
        selection={{ stamp: stamp(), candidates: [[0, 0], [0, 1]], reason: '2 candidates' }}
      />,
    );
    expect(text()).toContain('Ambiguous — 2 nodes match');
    const paths = [...host.querySelectorAll('button')].map((b) => b.textContent);
    expect(paths).toEqual(['path 0.0', 'path 0.1']);
  });

  it('ambiguous — reports which candidate the human picked', () => {
    const onPick = vi.fn();
    render(
      <SceneNodeDetail
        selection={{ stamp: stamp(), candidates: [[0, 0], [0, 1]] }}
        onPickCandidate={onPick}
      />,
    );
    act(() =>
      host
        .querySelectorAll('button')[1]
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(onPick).toHaveBeenCalledWith([0, 1]);
  });

  it('a single candidate is not "ambiguous"', () => {
    // One match is a resolution, and calling it ambiguous would block an edit that
    // is perfectly attributable.
    render(<SceneNodeDetail selection={{ stamp: stamp(), candidates: [[0, 0]] }} />);
    expect(text()).not.toContain('Ambiguous');
  });

  it('created — says so, and explains rather than looking like a failure', () => {
    render(
      <SceneNodeDetail
        selection={{ stamp: stamp(), created: true, reason: 'created by a staged insert' }}
      />,
    );
    expect(text()).toContain('Created this session');
    expect(text()).toContain('created by a staged insert');
    expect(text()).not.toContain('Ambiguous');
  });

  it('falls back to the bare reason only when nothing else applies', () => {
    render(<SceneNodeDetail selection={{ stamp: stamp(), reason: 'no root named Page' }} />);
    expect(text()).toContain('no root named Page');
    // …and NOT alongside a created/ambiguous banner, which would double-report.
    render(<SceneNodeDetail selection={{ stamp: stamp(), created: true, reason: 'because' }} />);
    expect(host.textContent!.match(/because/g)).toHaveLength(1);
  });

  it('says it is still resolving instead of reporting a verdict', () => {
    render(
      <SceneNodeDetail selection={{ stamp: stamp(), pending: true, reason: 'VERDICT' }} />,
    );
    expect(text()).toContain('Resolving against source…');
    expect(text()).not.toContain('VERDICT');
  });

  it('with no selection, says how to make one', () => {
    render(<SceneNodeDetail selection={null} />);
    expect(text()).toContain('Picking must be on');
  });
});

describe('how many of it are painted', () => {
  it('marks a node rendered many times, because an edit changes all of them', () => {
    render(<SceneNodeDetail selection={{ stamp: stamp({ instances: 4 }) }} />);
    expect(text()).toContain('×4 rendered');
  });

  it('marks a node that is not painted, WITHOUT calling it a problem', () => {
    // A node behind a falsy conditional is a legitimate edit target.
    //
    // `visibleRect={null}` is what makes the `instances > 0` guard observable: a node
    // that is never painted HAS no box, so without the guard it would also collect
    // the alarming "not currently visible" banner — the same fact reported twice in
    // two different tones, one of which is wrong about the cause.
    render(<SceneNodeDetail selection={{ stamp: stamp({ instances: 0 }) }} visibleRect={null} />);
    expect(text()).toContain('not rendered');
    expect(text()).not.toContain('Not currently visible');
  });

  it('warns when it IS painted but has no visible box', () => {
    // The frame already scrolls a scrolled-away node into view, so a zero box after
    // that means hidden — collapsed, inactive tab, `display: none`.
    render(
      <SceneNodeDetail
        selection={{ stamp: stamp() }}
        visibleRect={{ x: 0, y: 0, width: 0, height: 0 }}
      />,
    );
    expect(text()).toContain('Not currently visible');
    render(<SceneNodeDetail selection={{ stamp: stamp() }} visibleRect={null} />);
    expect(text()).toContain('Not currently visible');
  });

  it('claims NOTHING while the measurement is still outstanding', () => {
    // `undefined` is "not measured yet". Treating it as "not visible" would flash a
    // false warning on every selection, which trains the designer to ignore it.
    render(<SceneNodeDetail selection={{ stamp: stamp() }} visibleRect={undefined} />);
    expect(text()).not.toContain('Not currently visible');
  });

  it('does not warn about a visible box', () => {
    render(
      <SceneNodeDetail
        selection={{ stamp: stamp() }}
        visibleRect={{ x: 1, y: 2, width: 30, height: 10 }}
      />,
    );
    expect(text()).not.toContain('Not currently visible');
  });
});

describe('className — the corrected report', () => {
  const show = (over: Partial<SceneNodeMeta>) =>
    render(<SceneNodeDetail selection={{ stamp: stamp(), node: node(over) }} />);

  it('prints a literal, editable', () => {
    show({ className: 'flex gap-2' });
    expect(text()).toContain('flex gap-2');
    expect(text()).not.toContain('read-only');
  });

  it('prints the expression VERBATIM, not a guessed joiner name', () => {
    // The prototype printed `expression — cn(…)` for every non-literal, which is a
    // claim about source it had not read. These two are both "not a literal" and
    // neither is `cn`.
    show({ className: null, classNameExpr: 't("nav.home")', attrs: ['className'] });
    expect(text()).toContain('t("nav.home")');
    expect(text()).not.toContain('cn(…)');
    expect(text()).toContain('read-only');

    show({ className: null, classNameExpr: 'styles.row', attrs: ['className'] });
    expect(text()).toContain('styles.row');
  });

  it('distinguishes "no className at all" from "one I cannot edit"', () => {
    show({ className: null, classNameExpr: null, attrs: [] });
    expect(text()).toContain('(none)');
    expect(text()).not.toContain('read-only');
  });

  it('prints (none) for an empty literal rather than an empty box', () => {
    show({ className: '' });
    expect(text()).toContain('(none)');
  });
});

describe('node facts', () => {
  it('explains a relocated node instead of leaving two paths unexplained', () => {
    render(
      <SceneNodeDetail
        selection={{
          stamp: stamp({ path: [0, 5] }),
          anchor: { file: 'app/a.tsx', component: 'Page', path: [0, 1], tag: 'div', fp: 'fp1' },
          node: node(),
        }}
      />,
    );
    expect(text()).toContain('a staged structural edit shifted it');
  });

  it('stays quiet when the paths agree', () => {
    render(
      <SceneNodeDetail
        selection={{
          stamp: stamp({ path: [0, 1] }),
          anchor: { file: 'app/a.tsx', component: 'Page', path: [0, 1], tag: 'div', fp: 'fp1' },
          node: node(),
        }}
      />,
    );
    expect(text()).not.toContain('structural edit shifted it');
  });

  it('reports a blocked scope as blocked, and why', () => {
    // The server enforces this; showing it here is what stops a designer from
    // reaching for a structural control that will be refused.
    render(
      <SceneNodeDetail
        selection={{ stamp: stamp(), node: node({ scope: 'iteration', structuralEditable: false }) }}
      />,
    );
    expect(text()).toContain('iteration');
    expect(text()).toContain('blocked (not static JSX)');
  });

  it('lists bindings and off-token values', () => {
    render(
      <SceneNodeDetail
        selection={{
          stamp: stamp(),
          node: node({
            text: 'Save',
            attrs: ['className', 'onClick'],
            analysis: analysis({
              colorBindings: [{ utility: 'bg', role: 'primary' } as never],
              scaleBindings: [{ className: 'p-4' } as never],
              antiPatterns: {
                hardcodedPaletteColors: ['bg-red-500'],
                hardcodedNamedColors: [],
                hexLiterals: ['#fff'],
                rgbHslLiterals: [],
                arbitraryPx: [],
              },
            }),
          }),
        }}
      />,
    );
    expect(text()).toContain('bg:primary');
    expect(text()).toContain('p-4');
    expect(text()).toContain('Off-token values');
    expect(text()).toContain('bg-red-500');
    expect(text()).toContain('#fff');
    expect(text()).toContain('Save');
    expect(text()).toContain('className onClick');
  });

  it('omits the empty sections rather than printing empty headings', () => {
    render(<SceneNodeDetail selection={{ stamp: stamp(), node: node() }} />);
    expect(text()).not.toContain('Colour bindings');
    expect(text()).not.toContain('Off-token values');
    expect(text()).not.toContain('attributes');
    expect(text()).not.toContain('Text');
  });
});

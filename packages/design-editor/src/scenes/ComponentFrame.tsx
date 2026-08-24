/*
 * ONE COMPONENT, RENDERED ACROSS ITS VARIANTS.
 *
 * The recipe paired `components` mode with a `PreviewPane` and the prototype backed it
 * with a hand-written renderer per component — a registry that carried two entries. The
 * reason that looked unavoidable was never measured; measuring it settles the design:
 *
 *   Of the 13 components the analyser reads, 9 require props — and all 9 have no CVA.
 *   The 2 that DO have a variant table require no props at all.
 *
 * Those two sets are disjoint, and they are disjoint for a reason rather than by luck:
 * a component with a variant table is a styled primitive, and a styled primitive takes
 * its content as children. So the preview can import the real component and render it,
 * and the registry the prototype needed is not needed here.
 *
 * A component that does throw is caught per cell, so one unrenderable variant reports
 * itself instead of blanking the pane.
 */
import { Component, Suspense, lazy, useCallback, useMemo, type ReactNode } from 'react';
import { previewChildren, type IconSlot } from './preview-icons.tsx';

interface Props {
  file: string;
  component: string;
  /** axisName → the values to render, in order. Empty renders the component once. */
  axes: Record<string, string[]>;
  /** Classes applied on top, to force an interaction state. */
  forced?: string;
  /** What to render as the component's children. Defaults to its own name. */
  label?: string;
  /** Stand-in values for the component's required props. */
  mockProps?: Record<string, unknown>;
  /** Required props that are callbacks — supplied as no-ops, never carried as data. */
  noopProps?: string[];
  /** Where a stand-in glyph sits inside the component, and which one. */
  iconSlot?: IconSlot;
  icon?: string;
  loadComponentFile: (file: string, side: string) => Promise<unknown[]>;
  side: string;
  hasProviders: boolean;
  /** Forwarded to the consumer's providers, which take it as part of their contract. */
  theme: 'light' | 'dark';
  onReady: () => void;
  onError: (message: string) => void;
}

/**
 * How the consumer wants ONE of their components mounted. Every field optional; a
 * component with no recipe gets the generic mount.
 */
export interface PreviewRecipe {
  /** Props merged UNDER the generated ones, so an edited value still wins. */
  props?: Record<string, unknown>;
  /**
   * Replace the mount entirely — the only thing that can preview a composite's part.
   * Receives the component and the props the generic path would have used.
   */
  render?: (C: (p: Record<string, unknown>) => ReactNode, props: Record<string, unknown>) => ReactNode;
  /** A box the mount sits in: a width for a slider, a dark ground for a light chip. */
  frame?: { width?: number | string; height?: number | string };
  /**
   * `false` for a component that renders a VOID element.
   *
   * The generic mount always passes children — the component's own name, so a Button has
   * something to say. React refuses that outright for `<input>`, `<img>`, `<hr>` and
   * friends ("is a void element tag and must neither have `children`"), so `Input` and
   * `Separator` reported a crash where the real defect was the preview handing them a
   * label they cannot hold. Nothing in the metadata says which element a component
   * renders, so the consumer says it here.
   */
  children?: false;
}

/** One cell: the recipe's mount if there is one, the generic mount otherwise. */
function PreviewCell({
  C,
  recipe,
  props,
  children,
}: {
  C: (p: Record<string, unknown>) => ReactNode;
  recipe?: PreviewRecipe;
  props: Record<string, unknown>;
  children: ReactNode;
}) {
  const inner = recipe?.render ? (
    recipe.render(C, props)
  ) : recipe?.children === false ? (
    <C {...props} />
  ) : (
    <C {...props}>{children}</C>
  );
  return recipe?.frame ? <div style={recipe.frame}>{inner}</div> : inner;
}

/** Every combination of the axes, as prop objects. `{}` when there are none. */
export function variantCombos(axes: Record<string, string[]>): Record<string, string>[] {
  const names = Object.keys(axes);
  if (!names.length) return [{}];
  return names.reduce<Record<string, string>[]>(
    (acc, name) => acc.flatMap((row) => axes[name].map((v) => ({ ...row, [name]: v }))),
    [{}],
  );
}

/**
 * Catches a render throw for ONE cell.
 *
 * A component whose required props are missing throws while rendering, and React tears
 * down the whole tree for an uncaught one — so a single bad variant would take the
 * other eleven with it. The boundary is per cell so the rest still paint.
 */
class CellBoundary extends Component<{ label: string; children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { err: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.err) {
      /*
       * NAME THE CATEGORY, not just the throw.
       *
       * `useSidebar must be used within a SidebarProvider` is accurate and reads as a
       * crash. It is not: it is a component that needs app-level context, mounted alone
       * on purpose. Saying so is the difference between "the editor broke" and "this one
       * cannot be previewed on its own", and only the second tells you what to do.
       */
      const needsContext = /must be used within|useContext|Provider/i.test(this.state.err);
      return (
        <div style={{ maxWidth: 320, font: '11px ui-monospace, monospace', lineHeight: 1.5 }}>
          <p style={{ margin: 0, color: needsContext ? '#8a6d3b' : '#b91c1c' }}>
            {needsContext
              ? `${this.props.label} needs app context this preview does not mount.`
              : `${this.props.label}: ${this.state.err}`}
          </p>
          {needsContext && (
            <p style={{ margin: '4px 0 0', opacity: 0.65 }}>
              Open it inside a scene that renders it instead. {this.state.err}
            </p>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

export function ComponentFrame({
  file,
  component,
  axes,
  forced,
  label,
  mockProps,
  noopProps,
  iconSlot = 'none',
  icon = 'plus',
  loadComponentFile,
  side,
  hasProviders,
  theme,
  onReady,
  onError,
}: Props) {
  /*
   * THE LOADER IS A CALLBACK AND THE LAZY TYPE IS MEMOISED, neither built during render.
   *
   * A bare `lazy(...)` in the body mints a new component TYPE on every render, so React
   * unmounts the previewed subtree and remounts it whenever this frame re-renders — the
   * component loses its own state and re-runs its effects. It survived only because
   * nothing re-rendered this frame; the first prop change would have exposed it.
   *
   * The object-valued deps are compared by CONTENT. `axes` and `mockProps` are rebuilt
   * by the caller, and keying on identity would remount on every render again.
   */
  const key = JSON.stringify([axes, mockProps, noopProps, iconSlot, icon]);
  const loader = useCallback(async () => {
    const mods = (await loadComponentFile(file, side)) as (Record<string, unknown> | null)[];
    const [mod, providersMod, previewsMod] = mods;
    const Target = mod?.[component] ?? mod?.default;
    if (typeof Target !== 'function' && typeof Target !== 'object') {
      const names = Object.keys(mod ?? {}).slice(0, 8).join(', ');
      throw new Error(`${file} exports no \`${component}\` (has: ${names || 'nothing'})`);
    }
    /*
     * The consumer's providers wrap the grid, not each cell. A primitive can read theme
     * or tooltip context, and mounting one provider per cell would give each its own —
     * which is how a theme toggle starts applying to one swatch at a time.
     */
    const Providers = (hasProviders ? providersMod?.default : null) as
      | ((p: Record<string, unknown>) => ReactNode)
      | null;

    const C = Target as (p: Record<string, unknown>) => ReactNode;
    /*
     * THE CONSUMER'S RECIPE FOR THIS COMPONENT, if they wrote one.
     *
     * The generic mount is `<C {...props}>{label}</C>`, which is exactly right for a
     * styled primitive and wrong for most of a shadcn `ui/` directory: a menu ITEM
     * outside its menu throws, a `Slider` with no width is a zero-pixel line. Those are
     * facts about the consumer's design system, so the answer is theirs to supply — see
     * `options.previews`. Absent, everything falls through to the generic mount.
     */
    const recipe = (previewsMod?.default as Record<string, PreviewRecipe> | undefined)?.[component];
    const combos = variantCombos(axes);
    const grid = (
      /*
       * CENTRED ON A GRID, the way a design tool shows one object.
       *
       * The pane used to stack cells from the top-left with a caption over each, which
       * suited a matrix of 24. It shows the SELECTED variant now — usually one thing —
       * and one thing pinned to a corner of a white rectangle reads as a rendering
       * accident. The grid gives it a ground to sit on and makes a transparent or white
       * component visible as an object.
       *
       * The caption is gone with it: the toolbar already says `variant=default
       * size=default`, and repeating it over the component was the same fact twice.
       * It survives on the error boundary, where naming the failing cell still matters.
       */
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 24,
          padding: 24,
          minHeight: '100%',
          /*
           * FILL WHATEVER THE PROVIDERS PUT ABOVE US.
           *
           * Measured: one of the wrappers the consumer's providers render is a ROW flex
           * container, so this box became a flex item and took its content's width —
           * 127px inside 964. `justify-content: center` then centred within 127px, which
           * is why the component sat at the left edge while being vertically centred.
           *
           * `width: 100%` covers a block parent and `flex: 1` covers a flex one. Both,
           * because the preview cannot know which the consumer wraps it in.
           */
          width: '100%',
          flex: '1 1 auto',
          boxSizing: 'border-box',
          alignItems: 'center',
          alignContent: 'center',
          justifyContent: 'center',
          // TRANSPARENT. The grid is painted by the host, on the container this frame
          // moves across — see `SceneHost`. Painting it here again would clip it to the
          // frame's box and drag it along, which is the opposite of a canvas.
          background: 'transparent',
        }}
      >
        {combos.map((props, i) => {
          // `caption`, not `label`: the prop of that name is the component's CHILDREN.
          const caption = Object.entries(props).map(([k, v]) => `${k}=${v}`).join(' · ') || component;
          return (
            /*
             * `data-wb-cell` marks the component's own box, and the marker is what lets a
             * plain drag mean two things: inside a cell it belongs to the component (a
             * slider, a text selection), outside it the canvas pans. See `view-gestures`.
             */
            <div key={i} data-wb-cell="" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <CellBoundary label={caption}>
                {/*
                  `className` on top of the variant props. Most styled primitives merge
                  it (cva + `cn`), which is what lets a forced state override the resting
                  rule rather than sit beside it.
                */}
                {/*
                  MOCKS FIRST, variant props second: a variant is the thing being
                  previewed and must win if a component happens to take a prop of the
                  same name. Callbacks are rebuilt here rather than carried — a function
                  cannot cross a query string.
                */}
                <PreviewCell
                  C={C}
                  recipe={recipe}
                  props={{
                    ...(recipe?.props ?? {}),
                    ...(mockProps ?? {}),
                    ...Object.fromEntries((noopProps ?? []).map((n) => [n, () => {}])),
                    ...props,
                    className: forced,
                  }}
                >
                  {previewChildren(label ?? component, iconSlot, icon)}
                </PreviewCell>
              </CellBoundary>
            </div>
          );
        })}
      </div>
    );
    /*
     * The providers module takes the SCENE's shape — `mocks`, `theme`, optionally a
     * route and a shell. A component preview has no route and no mocks, and passing
     * nothing at all is what broke the first attempt: the consumer's implementation
     * does `mocks.includes(...)` and threw before anything rendered.
     *
     * So the contract is met with its empty case: no mocks, no route, no shell — the
     * providers still supply theme and whatever context a primitive reads, which is
     * the reason to mount them at all.
     */
    return {
      default: () =>
        Providers ? (
          /*
           * THE SAME CONTEXT A SCENE GETS.
           *
           * `mocks: []` was the empty case, and it is why `NavUser` threw on
           * `useLocation()` and `AppSidebar` on `useSidebar()`: those are not broken
           * components, they are components that live inside an app. Asking for the
           * router — and for whatever else the consumer wraps a preview in — makes them
           * mountable without the preview having to know which ones they are.
           *
           * A `route` is supplied for the same reason: `useLocation` needs somewhere to
           * be, and "/" is the honest default for a component with no page of its own.
           */
          <Providers mocks={['router', 'theme', 'query', 'tooltip', 'sidebar']} route="/" theme={theme}>
            {grid}
          </Providers>
        ) : (
          grid
        ),
    };
    // `key` stands in for the object-valued deps it serialises (`axes`, `mockProps`,
    // `noopProps`, `iconSlot`, `icon`): the caller rebuilds those every render, so
    // listing them by identity would remount the preview continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, component, side, forced, label, hasProviders, theme, loadComponentFile, key]);

  const Loaded = useMemo(() => lazy(loader), [loader]);

  return (
    /*
     * NO FALLBACK. The host paints a "mounting <Component>…" overlay over the whole
     * frame until `wb:ready` arrives, so anything rendered here shows THROUGH it — the
     * pane said "loading Button…" and "mounting login…" at once, which reads as two
     * different things loading.
     */
    <Suspense fallback={null}>
      <Ready onReady={onReady} onError={onError}>
        <Loaded />
      </Ready>
    </Suspense>
  );
}

/** Reports mount once the lazy child has actually rendered, and a load failure as one. */
class Ready extends Component<
  { onReady: () => void; onError: (m: string) => void; children: ReactNode },
  { err: string | null }
> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { err: e instanceof Error ? e.message : String(e) };
  }
  componentDidMount() {
    if (!this.state.err) this.props.onReady();
  }
  componentDidCatch(e: unknown) {
    this.props.onError(e instanceof Error ? e.message : String(e));
  }
  render() {
    if (this.state.err) {
      return (
        <p style={{ padding: 24, font: '12px ui-monospace, monospace', color: '#b91c1c' }}>
          {this.state.err}
        </p>
      );
    }
    return this.props.children;
  }
}

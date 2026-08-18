/**
 * What the frame decides, separated from how it boots.
 *
 * WHY THIS IS ITS OWN MODULE. `scene-entry.tsx` imports `virtual:wb-scenes`, a module
 * the plugin generates at serve time — so it does not exist on disk, and a test cannot
 * resolve it without a bundler alias. Putting the decisions here means they are tested
 * against a plain function instead of against test infrastructure: every failure kind,
 * which export is mounted, whether providers wrap. The entry keeps only the parts that
 * are genuinely environmental — the query string, the guards, `createRoot`.
 *
 * It is also the honest boundary. Nothing below reads `window` except through what it
 * is given, which is what makes "the frame mounted the wrong export" a testable claim
 * rather than something to be inspected in a browser this environment cannot run.
 */
import { Component, useEffect, useState, type ReactNode } from 'react';
import type { FrameMessage, FrameSide } from './frame-protocol.ts';

/** The manifest fields the frame reads. A superset lives in `plugin/scenes.ts`. */
export interface SceneConfigLike {
  id: string;
  export?: string;
  route?: string;
  routePattern?: string;
  shell?: boolean;
  mocks?: unknown[];
}

type SceneComponent = (props: Record<string, unknown>) => ReactNode;
type ProvidersComponent = (props: Record<string, unknown> & { children: ReactNode }) => ReactNode;

export interface Picked {
  Scene: SceneComponent;
  Providers?: ProvidersComponent;
}

/**
 * `loadScene` resolves an ARRAY — `Promise.all([sceneModule, providersModule?])` — not
 * the `{ Scene, SceneProviders }` object the prototype destructured. That shape belongs
 * to `renderScenesModule`, so the frame adapts rather than the generator.
 *
 * The component is named by the manifest's own `export` field, defaulting to `default`.
 * Naming it there is what lets a consumer point at a named export without renaming
 * their route file. A missing one THROWS rather than rendering nothing, because a blank
 * frame is indistinguishable from a scene that renders nothing.
 */
export function pickScene(mods: unknown, config: SceneConfigLike | undefined): Picked {
  const [sceneMod, providersMod] = (mods ?? []) as [
    Record<string, unknown> | undefined,
    Record<string, unknown> | undefined,
  ];
  const name = config?.export ?? 'default';
  const Scene = sceneMod?.[name];
  if (typeof Scene !== 'function') {
    const what = name === 'default' ? 'default export' : `export "${name}"`;
    throw new Error(`scene "${config?.id ?? '?'}" has no ${what}`);
  }
  const Providers = providersMod?.default ?? providersMod?.SceneProviders;
  return {
    Scene: Scene as SceneComponent,
    Providers: typeof Providers === 'function' ? (Providers as ProvidersComponent) : undefined,
  };
}

/**
 * A load failure's KIND, because the two have different recoveries.
 *
 * A transform or parse error means our own write broke the consumer's file, and the
 * host offers an inline undo for it. Anything else is a missing dependency or a bad
 * declaration — the consumer's to fix. Reporting both as one kind would put an undo
 * button in front of a problem undo cannot solve.
 */
export const loadFailureKind = (message: string): 'compile' | 'mount' =>
  /transform|parse|expected|unexpected/i.test(message) ? 'compile' : 'mount';

/**
 * A throw from the scene's own render, kept distinct from a MOUNT failure: a render
 * throw is usually the staged edit being wrong, a mount failure is the declaration.
 */
class SceneErrorBoundary extends Component<
  { send: (m: FrameMessage) => void; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.send({ type: 'wb:error', kind: 'render', message: error.message });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <FrameFailure kind="render" message={this.state.error.message} />;
  }
}

/**
 * Inline styles, not classes. This is the one piece of frame UI that is OURS, and the
 * frame carries no stylesheet of ours — a `text-destructive` here would render
 * unstyled in a project that never defined it, which is the failure this element
 * exists to report.
 */
export function FrameFailure({ kind, message }: { kind: string; message: string }) {
  return (
    <div style={{ padding: '2rem', font: '13px/1.6 ui-monospace, Menlo, monospace' }}>
      <p style={{ margin: 0, fontWeight: 600, color: '#b3261e' }}>Scene {kind} error</p>
      <pre style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap', color: '#5f6368' }}>{message}</pre>
    </div>
  );
}

export interface SceneFrameProps {
  sceneId: string;
  side: FrameSide;
  theme: 'light' | 'dark';
  config: SceneConfigLike | undefined;
  loadScene: (id: string, side: FrameSide) => Promise<unknown>;
  send: (m: FrameMessage) => void;
  /** The ids the picker found in the DOM, read after paint. */
  selectableIds: () => string[];
  /** Class strings the scene rendered, for Tailwind candidate registration. */
  renderedClasses: () => string[];
}

export function SceneFrame({
  sceneId,
  side,
  theme,
  config,
  loadScene,
  send,
  selectableIds,
  renderedClasses,
}: SceneFrameProps) {
  const [loaded, setLoaded] = useState<Picked | null>(null);
  const [mountError, setMountError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!config) {
      setMountError(`no scene "${sceneId}" in the scene manifest`);
      return;
    }
    loadScene(sceneId, side).then(
      (mods) => {
        if (!alive) return;
        try {
          setLoaded(pickScene(mods, config));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          send({ type: 'wb:error', kind: 'mount', message });
          setMountError(message);
        }
      },
      (err: unknown) => {
        if (!alive) return;
        const message = err instanceof Error ? err.message : String(err);
        send({ type: 'wb:error', kind: loadFailureKind(message), message });
        setMountError(message);
      },
    );
    return () => {
      alive = false;
    };
  }, [config, loadScene, sceneId, side, send]);

  /**
   * Announce readiness once the scene has PAINTED, not when the module lands — the host
   * lifts its loading veil on this and takes the selectable set from it, and a set read
   * before paint is empty.
   */
  useEffect(() => {
    if (!loaded) return;
    const id = window.requestAnimationFrame(() => {
      send({ type: 'wb:ready', scene: sceneId, side, selectable: selectableIds() });
      send({ type: 'wb:classes', classes: renderedClasses() });
    });
    return () => window.cancelAnimationFrame(id);
  }, [loaded, renderedClasses, sceneId, selectableIds, send, side]);

  if (mountError) return <FrameFailure kind="mount" message={mountError} />;
  // The host shows the veil; a spinner here would double up.
  if (!loaded) return null;

  const { Scene, Providers } = loaded;
  const scene = (
    <SceneErrorBoundary send={send}>
      <Scene />
    </SceneErrorBoundary>
  );
  // A consumer with no providers module gets the scene bare, which is the ordinary
  // case — `hasProviders` is false for any project that did not declare one.
  if (!Providers) return scene;
  return (
    <Providers
      mocks={config?.mocks ?? []}
      route={config?.route}
      routePattern={config?.routePattern}
      shell={config?.shell}
      theme={theme}
    >
      {scene}
    </Providers>
  );
}

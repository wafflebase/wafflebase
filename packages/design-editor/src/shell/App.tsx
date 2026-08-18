/**
 * The shell's first screen: what the plugin says about this project.
 *
 * WHY THIS AND NOT AN EMPTY DIV. 11a's subject is the build — a prebuilt shell,
 * served by `shellServer`, with its own React and its own compiled Tailwind. A
 * placeholder would prove the bytes arrived and nothing else. This proves the
 * chain a panel will depend on: React mounts, the compiled stylesheet applies,
 * `cn()` resolves, and `createBridgeClient()` reaches `GET /health` across the
 * plugin's own mount. Every one of those is a separate way the build can be wrong
 * while still producing a 200.
 *
 * It also survives 11b rather than being deleted by it. "Is my config actually
 * wired?" is the first question a consumer has — §5 calls the answer the real
 * onboarding cliff — and the four facts below are exactly the ones a missing
 * `scenes.config.json` or an absent `TokenAdapter` gets wrong. The layout moves
 * into a status strip; the readout stays.
 */
import { useEffect, useState } from 'react';
import { createBridgeClient, type HealthResult, type MetadataResult } from '../client/index.ts';
import { cn } from './lib/cn.ts';
import { SceneHost } from './scenes/SceneHost.tsx';
import { SceneOutline, type OutlineFile } from './scenes/SceneOutline.tsx';
import type { StampRef } from '../scenes/frame-protocol.ts';
import type { SceneMeta, FileMeta } from '../types.ts';
import { resolveImport } from '../scenes/import-paths.ts';

const bridge = createBridgeClient();

/** One `label: value` line, with the value's own verdict colour. */
function Fact({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-wb-border py-2 last:border-b-0">
      <span className="w-40 shrink-0 text-sm text-wb-muted">{label}</span>
      <code
        className={cn(
          'font-mono text-sm break-all',
          ok === false ? 'text-wb-danger' : 'text-wb-fg',
        )}
      >
        {value}
      </code>
    </div>
  );
}

/**
 * The first scene in the manifest, which is all the shell can choose until the outline
 * panel lands. `virtual:wb-scenes` is the frame's own import, not the shell's — the shell
 * is prebuilt and cannot read a module the consumer's server generates — so the id comes
 * from `GET /health`'s manifest path being present, and the frame reports what it found.
 * Until then this is a single hardcoded id, and it is named here rather than hidden.
 */
const FIRST_SCENE = 'dashboard';

export function App() {
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [meta, setMeta] = useState<MetadataResult | null>(null);
  /**
   * SELECTION IS AN ID, and the frame's `StampRef` is extra detail about it.
   *
   * Both views select, and only one of them knows a node's `tag`/`fp`/`instances`: the
   * outline has a tree and an id, the frame has the live element. Storing a `StampRef` as
   * the single source of truth meant the outline had to invent one — carrying the previous
   * selection's fields under a new id, which rendered `undefined — …` and would have made
   * `instances` a lie about a different node. The id is what both agree on; `detail` is
   * cleared when the id changes and refilled when the frame reports on it.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StampRef | null>(null);
  const selectFromFrame = (node: StampRef) => {
    setSelectedId(node.id);
    setDetail(node);
  };
  const selectById = (id: string | null) => {
    setSelectedId(id);
    // The outline knows no more than the id, so anything the frame told us about a
    // different node is dropped rather than shown against this one.
    setDetail((d) => (d && d.id === id ? d : null));
  };
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [selectable, setSelectable] = useState<string[]>([]);
  /**
   * The drill-in breadcrumb, as root-relative files. `[0]` is always the scene's own file;
   * opening a component pushes, and a breadcrumb click pops.
   */
  const [trail, setTrail] = useState<string[]>([]);

  useEffect(() => {
    // No cleanup guard: the shell mounts once per document and there is nothing to
    // race with. `health()` never rejects — the client turns a dead bridge into
    // `{ok: false, error}` — so there is no failure path to catch here either.
    bridge.health().then(setHealth);
    bridge.metadata().then(setMeta);
  }, []);

  const scene: SceneMeta | undefined = meta?.metadata?.scenes?.find((s) => s.id === FIRST_SCENE);
  const files: FileMeta[] = meta?.metadata?.files ?? [];

  /**
   * The breadcrumb's files, resolved to trees. A drilled-into component comes from
   * `metadata.files`, which is what the manifest's `components` list produces — so a
   * component the consumer never declared is not drillable, and the row simply has no
   * button rather than opening an empty tree.
   */
  const outlineTrail: OutlineFile[] = [];
  if (scene) outlineTrail.push({ file: scene.file, roots: scene.roots });
  for (const f of trail) {
    const found = files.find((x) => x.file === f);
    if (found?.roots) outlineTrail.push({ file: found.file, roots: found.roots });
  }

  /**
   * tag → the file that tag's component lives in.
   *
   * Resolved through the scene's own import list and the consumer's own aliases, which is
   * the whole point of 10a's alias seam: a project whose alias is `~` or `#app` resolves
   * here exactly as `@` does. A tag with no matching import is not drillable.
   */
  const fileOfTag = (tag: string): string | null => {
    if (!scene) return null;
    const imported = scene.imports?.find(
      (i) => i.default === tag || i.named?.includes(tag),
    );
    if (!imported) return null;
    const resolved = resolveImport(scene.file, imported.module, health?.aliases ?? []);
    // Only offer a drill-in for a file the analyser actually read: otherwise the
    // breadcrumb pushes a file whose tree is empty, which reads as a component with no
    // nodes rather than as one nobody declared.
    return resolved && files.some((f) => f.file === resolved) ? resolved : null;
  };

  return (
    <main className="flex h-full flex-col gap-3 p-4">
      <header className="shrink-0">
        <h1 className="text-lg font-semibold tracking-tight">Design editor</h1>
        <p className="mt-1 text-sm text-wb-muted">
          A live scene frame with the host protocol wired. The three-pane layout and the
          outline panel replace this arrangement.
        </p>
      </header>

      {/*
        Outline beside frame, mounted directly rather than through the layout.
        `SandboxLayout` is the next step and owns the three-pane arrangement; wiring these
        two together first makes the protocol checkable in a browser at the point it was
        written, instead of after 1,609 more lines of chrome.

        `hoverId` is ONE piece of state driving both views, which is what keeps them from
        disagreeing about what is under the pointer: the outline sets it on mouse-enter and
        the frame reports its own hover into the same setter.
      */}
      <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,18rem)_1fr] gap-3">
        <aside className="min-h-0 overflow-hidden rounded-lg border border-wb-border bg-wb-panel p-2">
          {meta && !meta.ok ? (
            <p className="p-2 text-[11px] text-wb-danger">{meta.error}</p>
          ) : (
            <SceneOutline
              trail={outlineTrail}
              selectable={new Set(selectable)}
              selectedId={selectedId}
              hoverId={hoverId}
              onSelect={selectById}
              onHover={setHoverId}
              onDrillIn={(file) => setTrail((t) => (t.includes(file) ? t : [...t, file]))}
              onTrailTo={(i) => setTrail((t) => t.slice(0, i))}
              fileOfTag={fileOfTag}
            />
          )}
        </aside>

        <div className="min-h-0">
          <SceneHost
            sceneId={FIRST_SCENE}
            dark={false}
            selectedId={selectedId}
            hoverId={hoverId}
            onSelect={selectFromFrame}
            onHover={(n) => setHoverId(n?.id ?? null)}
            onDeselect={() => selectById(null)}
            onReady={setSelectable}
            onClasses={setClasses}
          />
        </div>
      </section>

      {/* What the protocol reported, so a wrong contract is visible rather than silent. */}
      <section className="shrink-0 rounded-lg border border-wb-border bg-wb-panel px-4 py-2">
        <Fact
          label="Selected"
          value={selectedId ?? 'nothing selected'}
        />
        <Fact
          label="Tag"
          value={detail ? detail.tag : selectedId ? 'not painted in the frame' : '—'}
          ok={detail ? undefined : !selectedId}
        />
        <Fact
          label="Instances"
          value={detail ? String(detail.instances) : '—'}
        />
        <Fact label="Selectable nodes" value={String(selectable.length)} />
        <Fact label="Classes the scene rendered" value={String(classes.length)} />
      </section>

      <section className="shrink-0 rounded-lg border border-wb-border bg-wb-panel px-4 py-2">
        {health === null ? (
          <p className="py-2 text-sm text-wb-muted">Asking the plugin…</p>
        ) : health.ok ? (
          <>
            <Fact label="Editing" value={health.root ?? '(unreported)'} />
            <Fact
              label="Scene manifest"
              value={health.scenes ?? 'none declared'}
              ok={!!health.scenes}
            />
            <Fact
              label="Token adapter"
              value={health.tokens === 'configured' ? 'configured' : 'none — panels read-only'}
              ok={health.tokens === 'configured'}
            />
            <Fact
              label="Aliases"
              value={
                health.aliases?.length
                  ? health.aliases.map((a) => `${a.find} → ${a.replacement || '.'}`).join('  ')
                  : 'none configured'
              }
            />
          </>
        ) : (
          <Fact label="Bridge" value={health.error ?? 'unreachable'} ok={false} />
        )}
      </section>
    </main>
  );
}

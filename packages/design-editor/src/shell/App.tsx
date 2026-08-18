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
import { createBridgeClient, type HealthResult } from '../client/index.ts';
import { cn } from './lib/cn.ts';
import { SceneHost } from './scenes/SceneHost.tsx';
import type { StampRef } from '../scenes/frame-protocol.ts';

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
  const [selected, setSelected] = useState<StampRef | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [selectable, setSelectable] = useState<string[]>([]);

  useEffect(() => {
    // No cleanup guard: the shell mounts once per document and there is nothing to
    // race with. `health()` never rejects — the client turns a dead bridge into
    // `{ok: false, error}` — so there is no failure path to catch here either.
    bridge.health().then(setHealth);
  }, []);

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
        The frame, mounted directly rather than through the layout. `SandboxLayout` is the
        next step and owns the three-pane arrangement; putting `SceneHost` here first makes
        the protocol checkable in a browser at the point it was written, instead of after
        1,609 more lines of chrome.
      */}
      <section className="min-h-0 flex-1">
        <SceneHost
          sceneId={FIRST_SCENE}
          dark={false}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
          onDeselect={() => setSelected(null)}
          onReady={setSelectable}
          onClasses={setClasses}
        />
      </section>

      {/* What the protocol reported, so a wrong contract is visible rather than silent. */}
      <section className="shrink-0 rounded-lg border border-wb-border bg-wb-panel px-4 py-2">
        <Fact
          label="Selected"
          value={selected ? `${selected.tag} — ${selected.id}` : 'nothing selected'}
        />
        <Fact
          label="Instances"
          value={selected ? String(selected.instances) : '—'}
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

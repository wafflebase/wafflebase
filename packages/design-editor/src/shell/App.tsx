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

export function App() {
  const [health, setHealth] = useState<HealthResult | null>(null);

  useEffect(() => {
    // No cleanup guard: the shell mounts once per document and there is nothing to
    // race with. `health()` never rejects — the client turns a dead bridge into
    // `{ok: false, error}` — so there is no failure path to catch here either.
    bridge.health().then(setHealth);
  }, []);

  return (
    <main className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-6 px-8">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Design editor</h1>
        <p className="mt-1 text-sm text-wb-muted">
          The shell is served. Panels and the scene canvas land next.
        </p>
      </header>

      <section className="rounded-lg border border-wb-border bg-wb-panel px-4 py-2">
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

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, ShieldCheck, Loader2, TriangleAlert, FileCode, PlugZap, Undo2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.tsx';
import { cn } from '../lib/cn.ts';
// Interpolated, never written out. This copy tells a consumer which route to look for,
// and a hand-typed second copy is exactly how it came to name the prototype's namespace
// — one the shipped plugin has never served. `panels.test.tsx` guards the rule.
import { BASE } from '../../base.ts';
import type { ComponentMeta } from '../../types.ts';
import type { VariantState } from '../../client/edits.ts';
import {
  familyMetaOf,
  utilityFor,
  affectedByToken,
  defaultVariantState,
  tokenOverrideStyle,
  type EditRef,
  type PendingClassEdit,
  type PendingLayoutEdit,
  type PendingPaletteEdit,
  type PendingTokenAdd,
  type PendingTokenEdit,
  type PendingTokenRebind,
  type PlanItem,
} from '../../client/edits.ts';
import type { BridgeClient, TokensResult } from '../../client/bridge.ts';
import type { TokenRef } from '../../tokens/adapter.ts';

interface ReviewApproveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dark: boolean;
  /**
   * The write plan from `saveDiff(baseline, state)` — the intents that make disk
   * match the editor. It can contain `revert` items when the edit history moved
   * back past a save; those are shown separately because they *undo* previous
   * writes rather than adding new ones.
   */
  plan: PlanItem[];
  classEdits: PendingClassEdit[];
  tokenEdits: PendingTokenEdit[];
  tokenAdds: PendingTokenAdd[];
  rebinds: PendingTokenRebind[];
  paletteEdits: PendingPaletteEdit[];
  /**
   * The floating class editor's output — and the reason this prop exists at all.
   *
   * The card builder handled the five token/class maps and nothing else, so a class edit made
   * in the frame produced ZERO cards: the header said "1 file change staged", the diff list
   * below showed the real change, and the card area said "No changes to review." Measured on a
   * wafflebase scene. The staging path (11b) and this modal (12a) were wired independently and
   * never met.
   */
  layoutEdits: PendingLayoutEdit[];
  /** `GET /tokens`, for the palette swatches and the cascade-impact line. */
  tokens: TokensResult | null;
  /**
   * The bridge, as a PROP. The prototype imported `previewMutation`/`commitMutations` as
   * module functions bound to one hardcoded mount; the shell owns the client now, which is
   * also what lets a test drive this modal without a dev server.
   */
  bridge: BridgeClient;
  allComponents: ComponentMeta[];
  /** Called after every edit is written successfully. */
  onApproved: () => void;
  /**
   * Forget an edit whose target code no longer exists. This modal is where an
   * external file change actually surfaces ("could not locate"), so the way out
   * belongs here as well as in the header. Never touches files.
   */
  onDiscard: (refs: EditRef[]) => void;
  /**
   * How this modal reports a result. A CALLBACK, not the prototype's `toast` module: the
   * shell shows notices in its header strip, and a modal that owned its own toast layer
   * would render a floating element over the very plan the user is reading.
   */
  notify: (kind: 'info' | 'error', title: string, detail?: string) => void;
}

interface PreviewCard {
  componentName: string;
  title: string;
  subtitle: string;
  variant: VariantState;
  overrideClass: string;
  /** The same, on the disk side — what the replacements are replacing. */
  baseClass: string;
  tokenStyle: CSSProperties;
  /** For a new-token card: a single color swatch instead of a component preview. */
  swatch?: string;
  /**
   * The variable the new-token card names, carried rather than recovered from `title`.
   * The title is built from the ADAPTER's label, so the literal it used to be parsed
   * against (`New token · --`) matched nothing and the card rendered `--New color · primary`.
   */
  cssVar?: string;
  /** For a rebind/palette card: before → after color swatches. */
  swatchBefore?: string;
  swatchAfter?: string;
  /** Cascade impact line (palette edits). */
  impact?: string;
}

const stripCr = (s: string) => s.replace(/\r/g, '');

export function ReviewApproveModal({
  open,
  onOpenChange,
  dark,
  plan,
  classEdits,
  tokenEdits,
  tokenAdds,
  rebinds,
  paletteEdits,
  layoutEdits,
  tokens,
  bridge,
  allComponents,
  onApproved,
  onDiscard,
  notify,
}: ReviewApproveModalProps) {
  const byName = useMemo(
    () => Object.fromEntries(allComponents.map((c) => [c.name, c])),
    [allComponents],
  );

  // Current source color for a palette ref (for before/after swatches) + how
  // many semantic tokens reference it across both themes (cascade impact).
  const colorByRef = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of (tokens?.bindings?.refs ?? []) as TokenRef[]) m.set(c.ref, c.value);
    return m;
  }, [tokens]);
  const usageOf = (ref: string) => {
    if (!tokens?.bindings) return 0;
    let n = 0;
    for (const t of ['light', 'dark'] as const)
      for (const b of Object.values(tokens.bindings.themed[t] ?? {})) if (b.kind === 'ref' && b.value === ref) n++;
    return n;
  };

  // Build the ordered preview cards. The intents come from the PLAN (which also
  // knows about reverts); these cards visualise the editor's current state.
  const cards = useMemo(() => {
    const cards: PreviewCard[] = [];

    for (const e of classEdits) {
      cards.push({
        componentName: e.componentName,
        title: e.componentName,
        subtitle: `${e.property}: ${e.fromLabel} → ${e.toLabel} (${e.scopeLabel})`,
        variant: e.revealVariant,
        overrideClass: e.replacements.map((r) => r.to).join(' '),
        baseClass: e.replacements.map((r) => r.from).join(' '),
        tokenStyle: {},
      });
    }

    /*
     * One card per staged layout edit. `classOps` is the only op the UI can produce today —
     * the structural controls are not built — so a card for anything else names the op rather
     * than inventing a diff for it.
     */
    for (const e of layoutEdits) {
      const adds = e.classOps?.additions ?? [];
      const removes = e.classOps?.removals ?? [];
      cards.push({
        componentName: '',
        title: `<${e.anchor.tag}> · ${e.anchor.component}`,
        /*
         * The op goes in the SUBTITLE when there is no class change, not in `impact` — that
         * field is only rendered by the palette-rebind branch, so a layout card setting it says
         * nothing at all. Reachable once the structural controls exist: a `props` edit that
         * only sets an attribute would otherwise show two empty class lists and read as a
         * change that does nothing.
         */
        subtitle:
          `${e.anchor.file} · path ${e.anchor.path.join('.') || '(root)'} (${e.scopeLabel})` +
          (adds.length || removes.length ? '' : ` · ${e.op} — no class change staged`),
        variant: {},
        // The class lists are the substance, and `ClassList` renders them: what the node has on
        // disk, and what it would have after the write.
        baseClass: removes.join(' '),
        overrideClass: adds.join(' '),
        tokenStyle: {},
      });
    }

    if (tokenEdits.length) {
      const tokenStyle = tokenOverrideStyle(tokenEdits);
      const affected = new Set<string>();
      for (const e of tokenEdits) affectedByToken(e, allComponents).forEach((n) => affected.add(n));
      const summary = tokenEdits.map((e) => `--${e.cssVar}`).join(', ');
      for (const name of affected) {
        const comp = byName[name];
        if (!comp) continue;
        cards.push({
          componentName: name,
          title: name,
          subtitle: `Global token change → ${summary}`,
          variant: defaultVariantState(comp),
          overrideClass: '',
          baseClass: '',
          tokenStyle,
        });
      }
    }

    // New tokens: a swatch card for the three-point coordinated injection.
    for (const a of tokenAdds) {
      const meta = familyMetaOf(tokens?.families ?? [], a.family);
      cards.push({
        componentName: '',
        title: `New ${(meta?.label ?? a.family).toLowerCase()} · ${a.cssVar}`,
        // The file comes from the ADAPTER now, so this line names the consumer's own source
        // rather than `packages/core/src/tokens/*.ts`.
        subtitle: meta
          ? `${meta.file.split('/').pop()} + the token emitter + the theme alias (${utilityFor(meta, a.kebabKey)})`
          : `a new ${a.family} token`,
        variant: {},
        overrideClass: '',
        baseClass: '',
        tokenStyle: {},
        swatch: a.value,
        cssVar: a.cssVar,
      });
    }

    // Palette rebinds (semantic → palette.*) — before/after swatch card.
    for (const r of rebinds) {
      cards.push({
        componentName: '',
        title: `Rebind --${r.cssVar}`,
        subtitle: `${r.fromRef} → ${r.toRef} (${r.constName})`,
        variant: {},
        overrideClass: '',
        baseClass: '',
        tokenStyle: {},
        swatchBefore: colorByRef.get(r.fromRef) ?? undefined,
        swatchAfter: r.previewValue,
      });
    }

    // Palette-value edits (palette.ts) — before/after + cascade impact.
    for (const p of paletteEdits) {
      const n = usageOf(p.ref);
      cards.push({
        componentName: '',
        title: `Palette · ${p.label}`,
        subtitle: `${p.oldValue} → ${p.newValue}`,
        variant: {},
        overrideClass: '',
        baseClass: '',
        tokenStyle: {},
        swatchBefore: p.oldValue,
        swatchAfter: p.newValue,
        impact: `Cascades to ${n} semantic token${n === 1 ? '' : 's'} + external consumers (color pickers, canvas/slide themes).`,
      });
    }
    return cards;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classEdits, layoutEdits, tokenEdits, tokenAdds, rebinds, paletteEdits, allComponents, byName, colorByRef]);

  const reverts = useMemo(() => plan.filter((p) => p.mode === 'revert'), [plan]);

  interface DiffRow {
    file: string;
    diff: string;
    located: boolean;
    reason?: string;
    /** Transport-level failure (bridge down / network), distinct from "node not found". */
    error?: string;
    mode?: 'apply' | 'revert';
    label?: string;
    /** Which staged edit produced this row, so an unlocatable one can be dropped. */
    ref?: EditRef;
  }
  const [index, setIndex] = useState(0);
  const [diffs, setDiffs] = useState<DiffRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  // Dry-run every intent when the modal opens to gather diffs + locate checks.
  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setLoading(true);
    let cancelled = false;
    (async () => {
      const out: DiffRow[] = [];
      for (const { intent, label, mode, map, key } of plan) {
        // A dry run of ONE intent — the plan is previewed row by row so a single
        // unlocatable edit is attributed to its own row rather than failing the batch.
        const res = await bridge.mutate(intent, { dryRun: true });
        out.push({
          // `intent.file` is optional on the wire, and a layout intent carries its file on
          // the anchor instead — so the label is the last resort rather than a blank cell.
          file: res.files?.[0] ?? ('file' in intent ? intent.file : undefined) ?? label,
          diff: stripCr(res.diff ?? ''),
          located: res.ok,
          /*
           * ONE field, two sources, because the UI has one place for it: `/mutate` puts a
           * LOCATED intent's caveat in `notes`, and an UNLOCATABLE one's reason in `error`
           * alongside a 409. A separate field for the second would have been read by
           * nothing — the row already renders `reason` under "could not locate".
           */
          reason: res.ok ? res.notes?.[0] : res.error,
          /*
           * ONLY a transport failure counts as `error`, which is what `bridgeDown` below
           * means. A 409 is the server saying THIS edit no longer matches its file, and
           * showing that as "bridge unreachable" sends the user to restart a dev server
           * that is running fine. `status` is absent exactly when no response arrived.
           */
          error: res.ok || res.status !== undefined ? undefined : res.error,
          mode,
          label,
          ref: { map, key },
        });
      }
      if (!cancelled) {
        setDiffs(out);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, plan, bridge]);

  // Bridge unreachable (dev server down / network) — a transport error on ANY
  // dry-run. This is a different, louder failure than "couldn't locate a node".
  const bridgeDown = diffs.some((d) => !!d.error);
  /**
   * ONE derivation, three readers. The banner's visibility, its count and its button each
   * had their own filter and two of them omitted `d.ref` — so a row with no ref was counted,
   * was not discarded, and kept the banner up after the click.
   */
  const unmatched = useMemo(() => diffs.filter((d) => !d.located && !d.error && d.ref), [diffs]);
  const anyMissing = unmatched.length > 0;
  const card = cards[index];

  const approve = async () => {
    setApplying(true);
    // One batched commit = one entry in the write log.
    const res = await bridge.commit(plan.map((p) => p.intent));
    setApplying(false);

    if (!res.ok) {
      const err = res.error ?? 'commit failed';
      /*
       * SAME TEST AS THE DRY RUN ABOVE. `/commit` is all-or-nothing and answers a refusal
       * with a 409 — the same `ok: false` a dead server produces, which is why `status`
       * exists. Reporting both as transport told the user to restart a dev server that is
       * running, and set `error` on every row, which flips `bridgeDown` and locks the
       * button at "Bridge offline" until the modal is reopened.
       */
      if (res.status === undefined) {
        notify('error', 'Mutation bridge unreachable', `${err} — is the Vite dev server running?`);
        setDiffs((prev) => prev.map((d) => ({ ...d, error: err })));
      } else {
        // A refusal: the write did not happen, and the reason belongs on the rows as a
        // reason, not as a transport error.
        notify('error', 'Nothing was written', err);
        setDiffs((prev) => prev.map((d) => ({ ...d, located: false, reason: d.reason ?? err })));
      }
      return;
    }

    let okCount = 0;
    for (const r of res.results ?? []) {
      if (r.located) {
        okCount++;
        notify('info', `Updated ${r.file}`, `${r.label}${res.regenerated ? ' · tokens.css regenerated' : ''}`);
      } else {
        notify('error', `Failed: ${r.label}`, r.reason ?? 'could not apply');
      }
    }
    // A failed regeneration used to be invisible, which reads as "I saved but the
    // page didn't change". Say so instead.
    if (res.regenError) notify('error', 'tokens.css was not regenerated', res.regenError);
    onOpenChange(false);
    if (okCount > 0) onApproved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-w-2xl', dark && 'dark')}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" /> Review &amp; Approve
          </DialogTitle>
          <DialogDescription>
            {plan.length} file change{plan.length === 1 ? '' : 's'} staged
            {reverts.length > 0 && `, ${reverts.length} of them undoing a previous write`}. Nothing is written until
            you approve.
          </DialogDescription>
        </DialogHeader>

        {/* Reverts have no "after" preview — they restore a prior value, so they
            are listed explicitly rather than hidden among the diffs. */}
        {reverts.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
            <p className="flex items-center gap-1.5 font-medium">
              <Undo2 className="size-3.5" />
              Undoing {reverts.length} earlier change{reverts.length === 1 ? '' : 's'}
            </p>
            <ul className="mt-1 list-inside list-disc font-code">
              {reverts.map((r, i) => (
                <li key={i} className="truncate">
                  {r.label.replace(/^revert /, '')}
                </li>
              ))}
            </ul>
            <p className="mt-1">
              These edits were written earlier but are no longer in the editor (you stepped back past a save), so
              approving restores their previous values.
            </p>
          </div>
        )}

        {/* Bridge unreachable — the loud, unmistakable failure state (#1). */}
        {bridgeDown && !loading && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <PlugZap className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">Mutation bridge unreachable.</p>
              <p className="mt-0.5 text-destructive/90">
                The dev server middleware (<span className="font-code">POST {BASE}/mutate</span>) didn&apos;t
                respond. Make sure your Vite dev server is running with the{' '}
                <span className="font-code">designEditor()</span> plugin registered, then reopen this
                dialog. No files were touched.
              </p>
            </div>
          </div>
        )}

        {/* Visual preview of affected component(s) */}
        {card ? (
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">{card.title}</p>
                <p className="truncate text-[11px] text-muted-foreground">{card.subtitle}</p>
              </div>
              {cards.length > 1 && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <button
                    onClick={() => setIndex((i) => (i - 1 + cards.length) % cards.length)}
                    className="rounded-sm border border-border p-1 hover:bg-accent hover:text-accent-foreground"
                    aria-label="Previous component"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <span className="tabular-nums">
                    {index + 1} / {cards.length}
                  </span>
                  <button
                    onClick={() => setIndex((i) => (i + 1) % cards.length)}
                    className="rounded-sm border border-border p-1 hover:bg-accent hover:text-accent-foreground"
                    aria-label="Next component"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              )}
            </div>

            {card.swatchAfter !== undefined ? (
              // Rebind / palette-value card: before → after swatches + impact.
              <div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="size-12 shrink-0 rounded-md border border-border" style={{ background: card.swatchBefore ?? 'transparent' }} aria-hidden />
                    <ChevronRight className="size-4 text-muted-foreground" />
                    <span className="size-12 shrink-0 rounded-md border border-border" style={{ background: card.swatchAfter }} aria-hidden />
                  </div>
                  <div className="min-w-0 font-code text-[11px] text-muted-foreground">
                    <p className="truncate">{card.swatchBefore ?? '—'}</p>
                    <p className="mt-0.5 truncate text-foreground">{card.swatchAfter}</p>
                  </div>
                </div>
                {card.impact && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    {card.impact}
                  </p>
                )}
              </div>
            ) : card.swatch !== undefined ? (
              // New-token card: no before/after component — show the swatch.
              <div className="flex items-center gap-3">
                <span
                  className="size-16 shrink-0 rounded-md border border-border"
                  style={{ background: card.swatch }}
                  aria-hidden
                />
                <div className="min-w-0 font-code text-xs text-muted-foreground">
                  <p className="text-foreground">--{card.cssVar}</p>
                  <p className="mt-0.5 truncate">{card.swatch}</p>
                  <p className="mt-1 text-[10px]">
                    Created as a CSS variable. Map it to a Tailwind utility
                    (<span className="text-foreground">--color-*</span>) to use it as a class.
                  </p>
                </div>
              </div>
            ) : (
              /*
                THE CLASSES, not a live render.
                
                The prototype rendered the real component here through `previewRegistry` —
                a hand-written renderer per component, with sample children a human chose.
                That map is the consumer's own code and cannot be derived from source, so it
                is not part of this rollout. Two empty boxes would be the literal port; the
                class strings are what a class rewrite actually IS, and they are exact
                rather than illustrative. The live judgement happens in the scene frame,
                against the real page.
              */
              <div className="grid grid-cols-2 gap-3">
                <PreviewCell label="Before">
                  <ClassList value={card.baseClass} empty="no classes on this node" />
                </PreviewCell>
                <PreviewCell label="After" style={card.tokenStyle}>
                  <ClassList value={card.overrideClass} empty="classes removed" />
                </PreviewCell>
              </div>
            )}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">No changes to review.</p>
        )}

        {/* Diffs (secondary) */}
        <div className="max-h-40 space-y-2 overflow-y-auto">
          {loading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Computing changes…
            </p>
          ) : (
            diffs.map((d, i) => (
              <div key={i} className="overflow-hidden rounded-md border border-border">
                <div className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-2 py-1 font-code text-[10px] text-muted-foreground">
                  <FileCode className="size-3" />
                  {d.file}
                  {d.mode === 'revert' && (
                    <span className="rounded-full bg-amber-500/20 px-1.5 text-amber-700 dark:text-amber-400">revert</span>
                  )}
                  {d.error ? (
                    <span className="text-destructive">· bridge error: {d.error}</span>
                  ) : (
                    !d.located && (
                      <>
                        <span className="text-destructive">
                          · could not locate: {d.reason ?? 'no matching AST node'}
                        </span>
                        {d.ref && (
                          <button
                            onClick={() => onDiscard([d.ref!])}
                            title="Forget this edit. Your files are not touched."
                            className="ml-auto shrink-0 rounded-sm border border-border px-1.5 py-px text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            Discard
                          </button>
                        )}
                      </>
                    )
                  )}
                </div>
                {d.located && (
                  <pre className="overflow-x-auto p-2 font-code text-[10px] leading-relaxed">
                    {d.diff.split('\n').map((line, j) => (
                      <div
                        key={j}
                        className={cn(
                          line.startsWith('+') && 'text-emerald-600 dark:text-emerald-400',
                          line.startsWith('-') && 'text-destructive',
                        )}
                      >
                        {line}
                      </div>
                    ))}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>

        {anyMissing && !loading && (
          <div className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0">
              <p>Some edits no longer match the code and will be skipped.</p>
              <p className="mt-0.5 text-[11px]">
                Usually this means the file was changed outside the sandbox. A skipped edit stays staged, so the editor
                will keep reporting unsaved changes until you re-make it or discard it.
              </p>
              <button
                onClick={() => onDiscard(unmatched.map((d) => d.ref!))}
                className="mt-1 rounded-sm border border-amber-500/50 px-1.5 py-0.5 text-[11px] transition-colors hover:bg-amber-500/15"
              >
                Discard the {unmatched.length} unmatched edit
                {unmatched.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            Cancel
          </button>
          <button
            onClick={approve}
            disabled={applying || loading || plan.length === 0 || bridgeDown}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
          >
            {applying ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            {applying ? 'Writing…' : bridgeDown ? 'Bridge offline' : 'Approve & Write'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One side of a class rewrite, as text.
 *
 * `break-all` because a class list is one long unbroken token stream and truncating it
 * hides the part being changed; an empty value is NAMED rather than left blank, since a
 * blank cell reads as "the preview failed" instead of "there is nothing there".
 */
function ClassList({ value, empty }: { value: string; empty: string }) {
  const classes = value.split(/\s+/).filter(Boolean);
  if (!classes.length) return <span className="text-[10px] text-wb-muted italic">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {classes.map((c) => (
        <span key={c} className="rounded-full bg-wb-border px-1.5 py-0.5 font-mono text-[10px] text-wb-fg">
          {c}
        </span>
      ))}
    </div>
  );
}

function PreviewCell({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div
        style={style}
        className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border bg-background bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:14px_14px] p-4"
      >
        {children}
      </div>
    </div>
  );
}

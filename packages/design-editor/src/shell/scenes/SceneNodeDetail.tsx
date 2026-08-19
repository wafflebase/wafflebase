/**
 * What the selected node IS, read-only.
 *
 * This is the surface that reports the outcome of `client/anchors.ts#anchorFromStamp`,
 * and the reason it exists before any editing control does: the three outcomes of
 * mapping a click back to source are not interchangeable, and a panel that silently
 * showed only the happy one would make the other two look like the tool had simply
 * failed to notice the click.
 *
 *   resolved   — one baseline node matches. It has an anchor; the editing controls
 *                hang off exactly this state.
 *   ambiguous  — several baseline nodes share the fingerprint. We REFUSE and show the
 *                candidates. Picking the first of two identical `<span>·</span>`s
 *                would write to the wrong one with no visible symptom, which is the
 *                worst failure mode this tool has.
 *   created    — no baseline node matches, so a staged `layout-insert` produced it.
 *                Such a node has no anchor of its own and is edited through the
 *                parent insert's payload.
 *
 * Staying read-only is deliberate: it makes the anchoring layer observable on its
 * own, so a mis-resolution is caught as a wrong node name rather than as a wrong
 * write.
 *
 * PORTED with the consumer's `@/lib/utils` and shadcn colour names replaced by the
 * shell's own `wb-*` layer, and with one behaviour CORRECTED — see `ClassNameBlock`.
 */
import { AlertTriangle, FileCode2, Sparkles } from 'lucide-react';
import { cn } from '../lib/cn.ts';
import { antiPatternList, type SceneNodeMeta } from '../../types.ts';
import type { NodeAnchor } from '../../plugin/protocol.ts';
import type { FrameRect, StampRef } from '../../scenes/frame-protocol.ts';

/** The host's resolved view of one selection. */
export interface SceneSelection {
  stamp: StampRef;
  anchor?: NodeAnchor;
  node?: SceneNodeMeta;
  created?: boolean;
  candidates?: number[][];
  reason?: string;
  /** Set while the file's metadata is still being fetched. */
  pending?: boolean;
}

export function SceneNodeDetail({
  selection,
  visibleRect,
  onPickCandidate,
}: {
  selection: SceneSelection | null;
  /** `undefined` = still measuring; `null` = the frame reports no visible box for
   *  this node right now (as opposed to merely scrolled away, which the frame
   *  already corrects for on its own — see `SceneHost`'s measure handling). */
  visibleRect?: FrameRect | null;
  onPickCandidate?: (path: number[]) => void;
}) {
  if (!selection) {
    return (
      <p className="px-1 py-2 text-[11px] leading-relaxed text-wb-muted">
        Click a node in the frame, or a row in the outline. Picking must be on for
        clicks in the frame to select rather than activate.
      </p>
    );
  }

  const { stamp, node, anchor, created, candidates, reason, pending } = selection;

  return (
    <div className="flex flex-col gap-2 px-0.5">
      <div>
        <p className="flex items-center gap-1.5 font-mono text-xs text-wb-fg">
          {`<${stamp.tag}>`}
          {stamp.instances > 1 && (
            <span
              title="This one source node is rendered this many times — an edit changes all of them"
              className="rounded-full bg-wb-border px-1.5 text-[10px] text-wb-muted"
            >
              ×{stamp.instances} rendered
            </span>
          )}
          {/* Not a warning: a node behind a falsy conditional or an empty-state
              branch is a legitimate edit target that simply is not on screen.
              Saying so beats leaving the frame's blank highlight unexplained. */}
          {stamp.instances === 0 && (
            <span
              title="Editable, but not currently painted — a conditional branch, or a component that does not spread {...props}"
              className="rounded-full bg-wb-border px-1.5 text-[10px] text-wb-muted"
            >
              not rendered
            </span>
          )}
        </p>
        <p className="mt-0.5 flex items-center gap-1 truncate font-mono text-[10px] text-wb-muted">
          <FileCode2 className="size-3 shrink-0" />
          {stamp.file}
        </p>
        <p className="font-mono text-[10px] text-wb-muted">
          {stamp.component} · path {stamp.path.join('.') || '(root)'} · fp {stamp.fp}
        </p>
      </div>

      {pending && <p className="text-[11px] text-wb-muted">Resolving against source…</p>}

      {/*
        `instances === 0` (above) already covers "never painted at all" — this is the
        OTHER hidden case: the frame reports at least one DOM instance, but right now
        none of them have a visible box (a collapsed accordion, an inactive tab panel,
        `display: none`). `wb:set-selection` already scrolls a scrolled-away node back
        into view frame-side, so if it is STILL not visible after that, scrolling
        cannot be the fix.
      */}
      {stamp.instances > 0 &&
        visibleRect !== undefined &&
        (!visibleRect || (visibleRect.width === 0 && visibleRect.height === 0)) && (
          <p className="rounded-sm border border-wb-danger/40 bg-wb-danger/10 px-2 py-1 text-[10px] leading-relaxed text-wb-danger">
            Not currently visible in the frame — likely collapsed, on an inactive tab,
            or otherwise hidden rather than merely scrolled away.
          </p>
        )}

      {created && (
        <div className="rounded-sm border border-wb-accent/40 bg-wb-accent/5 p-2">
          <p className="flex items-center gap-1 text-[11px] font-medium text-wb-accent">
            <Sparkles className="size-3" />
            Created this session
          </p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-wb-muted">{reason}</p>
        </div>
      )}

      {candidates && candidates.length > 1 && (
        <div className="rounded-sm border border-wb-danger/40 bg-wb-danger/5 p-2">
          <p className="flex items-center gap-1 text-[11px] font-medium text-wb-danger">
            <AlertTriangle className="size-3" />
            Ambiguous — {candidates.length} nodes match
          </p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-wb-muted">
            Several nodes in the source share this fingerprint, so the click cannot be
            attributed. Pick the one you meant.
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {candidates.map((p) => (
              <li key={p.join('.')}>
                <button
                  type="button"
                  onClick={() => onPickCandidate?.(p)}
                  className="w-full rounded-sm border border-wb-border px-1.5 py-1 text-left font-mono text-[10px] text-wb-muted transition-colors hover:bg-wb-accent hover:text-wb-accent-fg"
                >
                  path {p.join('.')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!created && !candidates && !anchor && !pending && reason && (
        <p className="rounded-sm border border-wb-border bg-wb-panel p-2 text-[10px] leading-relaxed text-wb-muted">
          {reason}
        </p>
      )}

      {node && (
        <NodeFacts
          node={node}
          relocated={!!anchor && anchor.path.join('.') !== stamp.path.join('.')}
        />
      )}
    </div>
  );
}

function NodeFacts({ node, relocated }: { node: SceneNodeMeta; relocated: boolean }) {
  const issues = antiPatternList(node.analysis);
  return (
    <div className="flex flex-col gap-2">
      {relocated && (
        <p className="rounded-sm bg-wb-panel px-1.5 py-1 text-[10px] leading-relaxed text-wb-muted">
          The painted node sits at a different path than the source: a staged
          structural edit shifted it. The anchor uses the <em>source</em> path, so a
          save writes to the right place.
        </p>
      )}

      <Facts
        rows={[
          ['scope', node.scope],
          ['structural edits', node.structuralEditable ? 'allowed' : 'blocked (not static JSX)'],
        ]}
      />

      <ClassNameBlock node={node} />

      {node.attrs.length > 0 && <Block label="attributes">{node.attrs.join(' ')}</Block>}

      {node.text && (
        <div>
          <p className="mb-0.5 text-[10px] font-medium text-wb-muted">Text</p>
          <p className="rounded-sm bg-wb-panel px-1.5 py-1 font-mono text-[10px] text-wb-fg">
            {node.text}
          </p>
        </div>
      )}

      {node.analysis.colorBindings.length > 0 && (
        <div>
          <p className="mb-0.5 text-[10px] font-medium text-wb-muted">Colour bindings</p>
          <ul className="flex flex-wrap gap-1">
            {node.analysis.colorBindings.map((b, i) => (
              <li
                key={`${b.utility}-${b.role}-${i}`}
                className="flex items-center gap-1 rounded-full bg-wb-border px-1.5 py-0.5 font-mono text-[10px] text-wb-muted"
              >
                {/*
                  Resolved in the SHELL's palette, not the frame's. `--<role>` is the
                  consumer's variable and the shell does not define it, so this swatch
                  paints transparent rather than the colour the frame shows. Kept
                  because the role NAME beside it is the information; the dot is a hint
                  that lands only when the two palettes happen to agree.
                */}
                <span
                  className="size-2 rounded-full border border-wb-border"
                  style={{ background: `var(--${b.role})` }}
                />
                {b.utility}:{b.role}
              </li>
            ))}
          </ul>
        </div>
      )}

      {node.analysis.scaleBindings.length > 0 && (
        <div>
          <p className="mb-0.5 text-[10px] font-medium text-wb-muted">Scale bindings</p>
          <ul className="flex flex-wrap gap-1">
            {node.analysis.scaleBindings.map((b, i) => (
              <li
                key={`${b.className}-${i}`}
                className="rounded-full bg-wb-border px-1.5 py-0.5 font-mono text-[10px] text-wb-muted"
              >
                {b.className}
              </li>
            ))}
          </ul>
        </div>
      )}

      {issues.length > 0 && (
        <div>
          <p className="mb-0.5 text-[10px] font-medium text-wb-danger">Off-token values</p>
          <ul className="flex flex-wrap gap-1">
            {issues.map((v, i) => (
              <li
                key={`${v}-${i}`}
                className="rounded-full bg-wb-danger/20 px-1.5 py-0.5 font-mono text-[10px] text-wb-danger"
              >
                {v}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * `className`, and how editable it is.
 *
 * CORRECTED FROM THE PROTOTYPE, which printed the literal string `'expression —
 * cn(…)'` whenever `className` was null and `attrs` contained `className`. That
 * guessed at the joiner: the same shape covers `t("nav.home")`, `styles.row`, and a
 * ternary, and naming `cn(…)` for those is a claim about source the panel had not
 * read. It also could not tell a class it merely cannot EDIT from one that is not
 * there.
 *
 * `classNameExpr` is the field that actually distinguishes them — it carries the
 * expression as written — so the three states are now reported as what they are:
 *
 *   a literal            → the classes, editable
 *   expression, no literal → the expression verbatim, read-only
 *   no attribute          → `(none)`
 *
 * `whitespace-pre-wrap break-all` lets long unbroken tokens wrap instead of
 * overflowing (a real class string routinely runs past 20 tokens, and `truncate` hid
 * all but the first few), and `max-h-28 overflow-y-auto` caps how much vertical space
 * one node can take.
 */
function ClassNameBlock({ node }: { node: SceneNodeMeta }) {
  const readOnly = node.className === null && node.classNameExpr !== null;
  return (
    <div>
      <p className="mb-0.5 flex items-center gap-1.5 text-[10px] font-medium text-wb-muted">
        className
        {readOnly && (
          <span
            title="An expression, not a string literal — the injector will not rewrite it"
            className="rounded-full bg-wb-border px-1.5 text-[9px] text-wb-muted"
          >
            read-only
          </span>
        )}
      </p>
      <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded-sm bg-wb-panel px-1.5 py-1 font-mono text-[10px] leading-relaxed text-wb-fg">
        {node.className !== null
          ? node.className || '(none)'
          : (node.classNameExpr ?? '(none)')}
      </pre>
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-[10px] font-medium text-wb-muted">{label}</p>
      <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded-sm bg-wb-panel px-1.5 py-1 font-mono text-[10px] leading-relaxed text-wb-fg">
        {children}
      </pre>
    </div>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px]">
      {rows.map(([k, v]) => (
        <div key={k} className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-wb-muted">{k}</dt>
          <dd className={cn('truncate font-mono text-wb-fg')} title={v}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

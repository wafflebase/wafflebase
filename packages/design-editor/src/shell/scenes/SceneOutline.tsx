/**
 * The source tree beside the frame, and the drill-in.
 *
 * WHY AN OUTLINE AT ALL, GIVEN CLICK-TO-SELECT. Clicking only reaches what is PAINTED,
 * and a scene file contains much more than that: a node behind a falsy conditional
 * (`{isLoading && <Skeleton/>}`), an empty-state branch, a node whose component swallows
 * the stamped attribute because it does not spread `{...props}`. None of those are
 * clickable and all of them are things a designer needs to edit. The outline is the
 * complete list; the frame is the subset on screen. Rows the frame reported as reachable
 * are marked, so the two views stay honest about the difference rather than pretending
 * everything is clickable.
 *
 * WHY DRILL-IN IS A FILE SWITCH AND NOT A NESTED TREE. A page renders
 * `<DocumentList data={documents}/>`; expanding that into this tree as if it were part of
 * the page would be a lie about where an edit lands, because changing a class inside
 * `DocumentList` changes EVERY render site of it. So opening it is an explicit navigation
 * to another file, with a breadcrumb and a standing warning, and the anchor it produces
 * names that file. The alternative — a seamless merged tree — is the interface that makes
 * a global change feel local.
 *
 * WHAT THIS FILE DOES NOT DO. No editing. The node detail is read-only, which is what
 * lets it be trusted as the "what am I looking at" surface.
 *
 * PORTED with two couplings removed: `cn` from the consumer's `@/lib/utils`, and the
 * amber anti-pattern badges, which named Tailwind palette colours the consumer may not
 * have. Both now come from the shell's own layer.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CornerDownRight, Layers, MousePointerClick } from 'lucide-react';
import { cn } from '../lib/cn.ts';
import { antiPatternList, type SceneNodeMeta } from '../../types.ts';
import { parseStampId, stampId } from '../../scenes/frame-protocol.ts';

export interface OutlineFile {
  /** Root-relative, so it compares equal to a stamped node's `data-wb-file`. */
  file: string;
  roots: Record<string, SceneNodeMeta>;
}

export interface SceneOutlineProps {
  /** Breadcrumb: `[0]` is the scene's own file, the last is what is shown. */
  trail: OutlineFile[];
  /** Ids the frame reported as actually reaching the DOM. */
  selectable: Set<string>;
  selectedId: string | null;
  /**
   * Hovered in EITHER view. One piece of state drives both highlights, so the outline and
   * the frame cannot disagree about what is under the pointer.
   */
  hoverId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  /** Open a component's own file. Resolved by the host from the import list. */
  onDrillIn: (file: string) => void;
  /** Pop back to `trail[index]`. */
  onTrailTo: (index: number) => void;
  /** tag → root-relative file, for the rows that can be drilled into. */
  fileOfTag: (tag: string) => string | null;
  /**
   * Rename a root for display — used in components mode to drop the composite's own
   * prefix, so `Card`'s parts read `Header` / `Title` rather than `CardHeader` /
   * `CardTitle` under a heading that already says `Card`.
   */
  labelOf?: (rootName: string) => string;
}

/** `#returns` is synthetic — a container for a root's returned JSX, not an element. */
const isSynthetic = (n: SceneNodeMeta) => n.tag === '#returns';

export function SceneOutline({
  trail,
  selectable,
  selectedId,
  hoverId,
  onSelect,
  onHover,
  onDrillIn,
  onTrailTo,
  fileOfTag,
  labelOf,
}: SceneOutlineProps) {
  const active = trail[trail.length - 1];
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const rootNames = useMemo(() => Object.keys(active?.roots ?? {}).sort(), [active]);

  /**
   * A selection made IN THE FRAME has to surface here too. Without this half, a node
   * selected under a collapsed ancestor is invisible in its own tree — not merely
   * scrolled away, since `overflow-y-auto` cannot reveal a row that `!isCollapsed` never
   * renders — which reads as "the outline did not notice the click".
   *
   * The file comparison is why `/metadata` normalises its paths: `parseStampId` yields a
   * root-relative file because that is what the stamper writes, so an absolute
   * `active.file` would make this test always fail and silently expand nothing.
   */
  useEffect(() => {
    if (!selectedId || !active) return;
    const parsed = parseStampId(selectedId);
    if (!parsed || parsed.file !== active.file) return;
    setCollapsed((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (let i = 1; i < parsed.path.length; i++) {
        const key = `${parsed.component}:${parsed.path.slice(0, i).join('.')}`;
        if (next.delete(key)) changed = true;
      }
      return changed ? next : prev;
    });
    // Deferred one frame: the ancestor expansion above has not re-rendered when this
    // effect body runs, so the row may not exist in the DOM until after that commit.
    const raf = requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector(`[data-row-id="${CSS.escape(selectedId)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedId, active]);

  if (!active) {
    return <p className="p-2 text-[11px] text-wb-muted">No metadata for this scene yet.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/*
        Breadcrumb, present even at depth 1 so the file under edit is always named — an
        anchor that says "LoginPage" is ambiguous without it.
      */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px]">
        {trail.map((t, i) => (
          <span key={t.file} className="flex items-center gap-1">
            {i > 0 && <span className="text-wb-muted">›</span>}
            <button
              onClick={() => onTrailTo(i)}
              disabled={i === trail.length - 1}
              className={cn(
                'truncate font-mono',
                i === trail.length - 1
                  ? 'text-wb-fg'
                  : 'text-wb-muted underline-offset-2 hover:underline',
              )}
            >
              {t.file.split('/').pop()}
            </button>
          </span>
        ))}
      </div>

      {trail.length > 1 && (
        <p className="shrink-0 rounded-sm border border-wb-danger/40 bg-wb-danger/10 px-2 py-1 text-[10px] leading-relaxed text-wb-danger">
          Editing here affects <strong>every render site</strong> of this component, not
          only this scene.
        </p>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {rootNames.map((rootName) => {
          const root = active.roots[rootName];
          /*
           * A ROOT THAT IS ONE ELEMENT CARRIES ITS OWN NAME, with no heading above it.
           *
           * `CardHeader` returns a single `div`, so the tree was a heading reading
           * `CardHeader()` and exactly one row reading `div` — two lines to say one
           * thing, times seven for a composite's parts. The row takes the component's
           * name instead; there is nothing else in that root it could be confused with.
           */
          const only = soleElement(root);
          if (only) {
            return (
              <Rows
                key={rootName}
                node={only}
                depth={0}
                label={labelOf?.(rootName) ?? rootName}
                file={active.file}
                rootName={rootName}
                collapsed={collapsed}
                onToggle={toggle}
                selectable={selectable}
                selectedId={selectedId}
                hoverId={hoverId}
                onSelect={onSelect}
                onHover={onHover}
                onDrillIn={onDrillIn}
                fileOfTag={fileOfTag}
              />
            );
          }
          return (
            <div key={rootName} className="mb-2">
              {/*
                One walkable root per JSX-returning function: the component plus local
                helpers like `renderRow`. Naming them is what makes `items.map(renderRow)`
                legible — the helper's JSX is `static` in its own root, so structural ops
                work there.
              */}
              <p className="sticky top-0 z-10 mb-0.5 bg-wb-panel px-1 py-0.5 font-mono text-[10px] font-medium text-wb-muted">
                {labelOf?.(rootName) ?? rootName}
                {rootNames.length > 1 && <span className="ml-1 opacity-60">()</span>}
              </p>
              <Rows
                node={root}
                depth={0}
                file={active.file}
                rootName={rootName}
                collapsed={collapsed}
                onToggle={toggle}
                selectable={selectable}
                selectedId={selectedId}
                hoverId={hoverId}
                onSelect={onSelect}
                onHover={onHover}
                onDrillIn={onDrillIn}
                fileOfTag={fileOfTag}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The one real element a root renders, or `null` when it renders more than one.
 *
 * The synthetic wrapper has no row of its own, so "one element" means: strip it, and
 * exactly one child is left with no children of its own.
 */
function soleElement(root: SceneNodeMeta): SceneNodeMeta | null {
  const top = isSynthetic(root) ? root.children : [root];
  return top.length === 1 && top[0].children.length === 0 ? top[0] : null;
}

interface RowsProps {
  node: SceneNodeMeta;
  depth: number;
  /** Shown instead of the tag — used when a row stands in for its whole root. */
  label?: string;
  file: string;
  rootName: string;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  selectable: Set<string>;
  selectedId: string | null;
  hoverId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onDrillIn: (file: string) => void;
  fileOfTag: (tag: string) => string | null;
}

function Rows(props: RowsProps) {
  const { node, depth, file, rootName, collapsed, onToggle } = props;

  // The synthetic root has no row of its own — render straight through to its children so
  // the tree starts at the first real element.
  if (isSynthetic(node)) {
    return (
      <>
        {node.children.map((c) => (
          <Rows key={c.path.join('.')} {...props} label={undefined} node={c} depth={depth} />
        ))}
      </>
    );
  }

  const id = stampId(file, rootName, node.path);
  const key = `${rootName}:${node.path.join('.')}`;
  const isCollapsed = collapsed.has(key);
  const hasChildren = node.children.length > 0;
  const selected = props.selectedId === id;
  const hovered = props.hoverId === id;
  const reachable = props.selectable.has(id);
  const drillTo = props.fileOfTag(node.tag);
  const issues = antiPatternList(node.analysis).length;

  return (
    <>
      <div
        data-row-id={id}
        onMouseEnter={() => props.onHover(id)}
        onMouseLeave={() => props.onHover(null)}
        /*
         * DOUBLE-CLICK DRILLS IN, single click still selects — the Figma convention,
         * and the reason is that a component row answers two different questions.
         * "Restyle this instance where it sits" is a selection; "go edit what it is
         * made of" is a navigation. Collapsing them onto one click would make one of
         * the two unreachable.
         *
         * The `↳` button stays: it is the discoverable form, and a double-click is
         * something you only try once you suspect it works.
         */
        onDoubleClick={drillTo ? () => props.onDrillIn(drillTo) : undefined}
        // `hovered` is driven by shared state rather than the `:hover` pseudo-class, so
        // pointing at a node IN THE FRAME lights this row too. A CSS-only hover could
        // never do that — the pointer is in another document.
        className={cn(
          'group flex items-center gap-0.5 rounded-sm pr-1 text-[11px]',
          selected
            ? 'bg-wb-accent/20 text-wb-accent'
            : cn('text-wb-muted hover:bg-wb-border/40', hovered && 'bg-wb-border/40'),
        )}
        style={{ paddingLeft: `${depth * 10}px` }}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(key)}
          disabled={!hasChildren}
          className={cn('shrink-0 p-0.5', !hasChildren && 'invisible')}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        </button>

        <button
          onClick={() => props.onSelect(selected ? null : id)}
          className="flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left"
        >
          <span className={cn('truncate font-mono', selected && 'font-medium')}>
            {props.label ?? node.tag}
          </span>
          {props.label && (
            <span className="shrink-0 font-mono text-[9px] opacity-50">{node.tag}</span>
          )}
          {/* `repeated` is the blast radius: ONE source node, N painted rows. */}
          {node.repeated && (
            <span
              title="One source node, rendered many times — an edit here changes every instance"
              className="flex shrink-0 items-center gap-0.5 rounded-full bg-wb-border px-1 text-[9px]"
            >
              <Layers className="size-2.5" />
              all
            </span>
          )}
          {/*
            `iteration` / `callback` scope allows props edits only. Mirrored server-side as
            a hard guard, so this is a hint, not the rule.
          */}
          {node.scope !== 'static' && (
            <span
              title={`Inside a ${node.scope} — class and text edits only, no insert/remove/move`}
              className="shrink-0 rounded-full bg-wb-border px-1 text-[9px] opacity-70"
            >
              {node.scope}
            </span>
          )}
          {reachable && (
            <MousePointerClick
              className="size-2.5 shrink-0 opacity-50"
              aria-label="Clickable in the frame"
            />
          )}
          {issues > 0 && (
            <span
              title={`${issues} off-token value${issues === 1 ? '' : 's'}`}
              className="shrink-0 rounded-full bg-wb-danger/20 px-1 text-[9px] text-wb-danger"
            >
              {issues}
            </span>
          )}
        </button>

        {drillTo && (
          <button
            onClick={() => props.onDrillIn(drillTo)}
            title={`Open ${drillTo}`}
            className="shrink-0 rounded-sm p-0.5 opacity-0 transition-opacity hover:bg-wb-border/40 group-hover:opacity-100"
          >
            <CornerDownRight className="size-3" />
          </button>
        )}
      </div>

      {!isCollapsed &&
        node.children.map((c) => (
          <Rows key={c.path.join('.')} {...props} node={c} depth={depth + 1} />
        ))}
    </>
  );
}

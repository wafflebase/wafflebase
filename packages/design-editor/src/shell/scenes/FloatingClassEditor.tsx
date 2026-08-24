/**
 * The Figma-style floating editor for a selected node's Tailwind classes.
 *
 * POSITIONED, NOT DOCKED. Rendered via `createPortal` into `document.body` as
 * `position: fixed` at the selection's HOST-PAGE rect (`SceneHost` converts the
 * frame's own coordinates into ours). NOT a Radix popover: Radix's pointer handling
 * is built to own the page it floats over, and this one floats over an iframe whose
 * clicks must keep reaching the frame's picker — a plain `position: fixed` div never
 * contests that.
 *
 * QUICK CONTROLS STAY ON-TOKEN. Direction / align / justify / gap are closed
 * enumerations of Tailwind's own utility names, so toggling one can never produce an
 * arbitrary value. Width/height are spacing-scale presets for the same reason:
 * `SceneNodeDetail` flags arbitrary px literals as a defect, so an editor that
 * defaulted to emitting `w-[137px]` would manufacture the exact thing that panel
 * warns about.
 *
 * DRAGGABLE, ANCHOR-RELATIVE. The header is a drag handle; dragging adds an offset on
 * top of the computed anchor position rather than replacing it, so the panel keeps
 * tracking scroll and zoom changes to the SAME node after being moved out of the way.
 * The offset is deliberately NOT reset by a `hostRect` change — the caller keys this
 * component on the selection id instead, so a NEW node remounts it with a fresh
 * offset while the same node's rect updating preserves the drag.
 *
 * THE RAW CHIP LIST IS THE ESCAPE HATCH. Presets cover the common cases; anything
 * else — an arbitrary value, a state variant, a class this editor has no dedicated
 * control for — goes through the free-text add/remove list, which accepts anything.
 *
 * PORTED with the consumer's `@/lib/utils` and shadcn colour names replaced by the
 * shell's `wb-*` layer, plus a drag-listener leak fixed and accessible names added to
 * the icon-only buttons.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { cn } from '../lib/cn.ts';
import { CLASS_GROUPS, groupsFor } from '../../client/class-groups.ts';

/*
 * The option lists moved to `client/class-groups.ts`, which owns both the options and
 * the rule for when a group is relevant. Keeping a second copy here would let the two
 * drift: a group could offer `gap-12` while detection matched only up to `gap-8`.
 */
const SIZE_SCALE = [
  'auto',
  'full',
  '4',
  '8',
  '12',
  '16',
  '24',
  '32',
  '40',
  '48',
  '64',
  '80',
  '96',
] as const;

/**
 * Removes every class in `group`, then adds `value` back — the mutually
 * exclusive-choice primitive every quick-toggle group is built from.
 */
export function setExclusive(
  classes: string[],
  group: readonly string[],
  value: string | null,
): string[] {
  const rest = classes.filter((c) => !group.includes(c));
  return value ? [...rest, value] : rest;
}

export function activeOf(classes: string[], group: readonly string[]): string | null {
  return group.find((g) => classes.includes(g)) ?? null;
}

/**
 * The pattern is anchored and enumerated on purpose. A looser `^w-` would also strip
 * `w-fit`, `w-1/2` and `w-[137px]` — classes this editor has no control for, which
 * means they belong to the chip list and picking a preset must not silently delete
 * them.
 */
const sizeRe = (prefix: 'w' | 'h') => new RegExp(`^${prefix}-(auto|full|\\d+)$`);

export function setSize(classes: string[], prefix: 'w' | 'h', token: string | null): string[] {
  const rest = classes.filter((c) => !sizeRe(prefix).test(c));
  return token ? [...rest, `${prefix}-${token}`] : rest;
}

export function sizeOf(classes: string[], prefix: 'w' | 'h'): string {
  const hit = classes.find((c) => sizeRe(prefix).test(c));
  return hit ? hit.slice(prefix.length + 1) : '';
}

export interface FloatingClassEditorProps {
  /** `null`/`undefined` = do not render (no selection, or not visible). */
  hostRect: { left: number; top: number; width: number; height: number } | null | undefined;
  /** The node's current, effective class list (baseline + any staged ops). */
  classes: string[];
  /** A short label for the header — the selected tag, e.g. `<h1>`. */
  title: string;
  onChange: (next: string[]) => void;
  onClose: () => void;
}

export function FloatingClassEditor({
  hostRect,
  classes,
  title,
  onChange,
  onClose,
}: FloatingClassEditorProps) {
  const [draft, setDraft] = useState('');
  /**
   * Groups opened by hand for a property the node does not carry yet.
   *
   * Detection can only ever report what IS there, so on its own it makes a node with
   * no `bg-` permanently unable to gain one. This is the other half: what the node
   * uses opens itself, and everything else stays one click away.
   *
   * Keyed by group, not remembered across selections — the next node is a different
   * question, and carrying the answer over would reintroduce exactly the always-on
   * panel this replaces.
   */
  const [opened, setOpened] = useState<string[]>([]);
  useEffect(() => setOpened([]), [title]);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  /**
   * Detaches an in-flight drag. Held in a ref so unmounting mid-drag can run it:
   * without this the `pointermove` listener outlives the panel and keeps calling
   * `setDragOffset` on a component that is gone, once per mouse move, forever.
   */
  const endDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endDragRef.current?.(), []);

  const beginDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startOffset = dragOffset;
    const onMove = (ev: PointerEvent) => {
      setDragOffset({
        x: startOffset.x + (ev.clientX - startX),
        y: startOffset.y + (ev.clientY - startY),
      });
    };
    const detach = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', detach);
      endDragRef.current = null;
    };
    endDragRef.current?.(); // a second pointerdown must not stack listeners
    endDragRef.current = detach;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', detach);
  };

  if (!hostRect) return null;

  const toggle = (group: readonly string[], value: string) =>
    onChange(setExclusive(classes, group, activeOf(classes, group) === value ? null : value));

  const removeChip = (cls: string) => onChange(classes.filter((c) => c !== cls));

  const { relevant, rest: unused } = groupsFor(classes);
  // A group opened by hand joins the shown set in CLASS_GROUPS order, so adding one
  // does not park it at the bottom away from the property it sits next to.
  const shown = CLASS_GROUPS.filter(
    (g) => relevant.includes(g) || opened.includes(g.key),
  );
  const rest = unused.filter((g) => !opened.includes(g.key));

  const addChip = () => {
    const next = draft.trim();
    if (next && !classes.includes(next)) onChange([...classes, next]);
    setDraft('');
  };

  // Below the selection by default, flipped above when there is no room, and clamped
  // horizontally — the pane can sit close to the viewport edge, and this panel has no
  // scroll container of its own to absorb an overflow.
  //
  // `PANEL_HEIGHT` is an ESTIMATE, not a measurement: the panel's real height depends
  // on how many chips the node has. Measuring it would need a layout pass and a
  // second paint, and being wrong here costs a slightly misplaced panel that the user
  // can drag — so the estimate is the honest trade.
  const PANEL_WIDTH = 288;
  const PANEL_HEIGHT = 260;
  const GAP_PX = 6;
  const spaceBelow = window.innerHeight - (hostRect.top + hostRect.height);
  const anchoredTop =
    spaceBelow > PANEL_HEIGHT || spaceBelow > hostRect.top
      ? hostRect.top + hostRect.height + GAP_PX
      : Math.max(GAP_PX, hostRect.top - PANEL_HEIGHT - GAP_PX);
  // The `min` is applied last, so on a window narrower than PANEL_WIDTH + GAP_PX its
  // right-edge bound goes negative and would win over the left-edge floor.
  const anchoredLeft = Math.max(
    GAP_PX,
    Math.min(Math.max(GAP_PX, hostRect.left), window.innerWidth - PANEL_WIDTH - GAP_PX),
  );
  const top = anchoredTop + dragOffset.y;
  const left = anchoredLeft + dragOffset.x;

  return createPortal(
    <div
      data-wb-class-editor
      className="fixed z-50 flex max-h-[70vh] flex-col rounded-md border border-wb-border bg-wb-panel p-2.5 text-wb-fg shadow-lg"
      style={{ top, left, width: PANEL_WIDTH }}
      // The gutter's deselect handler in `SceneHost` sees a bubbling `mousedown` from
      // anywhere in the host page — including this panel, which is not inside the
      // iframe. Without this, adjusting a class deselects the node being adjusted.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Drag handle. `select-none` stops a fast drag from highlighting the title. */}
      <div
        onPointerDown={beginDrag}
        className="flex shrink-0 cursor-grab items-center justify-between pb-2 select-none active:cursor-grabbing"
      >
        <p className="font-mono text-[11px] font-medium text-wb-fg">{title}</p>
        <button
          type="button"
          aria-label="Close the class editor"
          onClick={onClose}
          // Otherwise closing it starts a drag first.
          onPointerDown={(e) => e.stopPropagation()}
          className="rounded-sm p-0.5 text-wb-muted transition-colors hover:bg-wb-subtle hover:text-wb-fg"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/*
        THE BODY IS THE SCROLLER, not the panel.
        
        A node with many classes made the panel taller than `70vh` and the title and
        close button scrolled out of it — so dismissing the editor meant scrolling back
        up to find its X, and the handle you drag it by went with them.
      */}
      <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">

      {/*
        THE CONTROLS THIS NODE ACTUALLY NEEDS. Groups it already uses are open; the
        rest are behind the picker below, so a property the node has never carried is
        still reachable. See `client/class-groups.ts` for why detection alone is not
        enough.
      */}
      {shown.map((g) => (
        <ToggleGroup
          key={g.key}
          label={g.label}
          options={g.options}
          active={activeOf(classes, g.options)}
          onPick={(v) => toggle(g.options, v)}
        />
      ))}
      {shown.length === 0 && (
        <p className="text-[10px] leading-relaxed text-wb-muted">
          No layout or spacing classes on this node yet — add a control below, or type a
          class directly.
        </p>
      )}
      {rest.length > 0 && (
        <label className="flex items-center gap-1 text-[10px] text-wb-muted">
          <span className="shrink-0">Add a control</span>
          <select
            value=""
            aria-label="Add a control for a property this node does not use yet"
            onChange={(e) => e.target.value && setOpened((p) => [...p, e.target.value])}
            className="min-w-0 flex-1 rounded-sm border border-wb-border bg-wb-bg px-1 py-0.5 text-[10px] text-wb-fg outline-none focus:border-wb-accent"
          >
            <option value="">choose…</option>
            {rest.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-2 gap-2">
        <SizeSelect
          label="Width"
          prefix="w"
          value={sizeOf(classes, 'w')}
          onPick={(v) => onChange(setSize(classes, 'w', v))}
        />
        <SizeSelect
          label="Height"
          prefix="h"
          value={sizeOf(classes, 'h')}
          onPick={(v) => onChange(setSize(classes, 'h', v))}
        />
      </div>

      <div>
        <p className="mb-1 text-[10px] font-medium text-wb-muted">All classes</p>
        <div className="flex flex-wrap gap-1">
          {classes.map((c) => (
            <span
              key={c}
              className="flex items-center gap-0.5 rounded-full bg-wb-border px-1.5 py-0.5 font-mono text-[10px] text-wb-fg"
            >
              {c}
              <button
                type="button"
                onClick={() => removeChip(c)}
                className="opacity-60 hover:opacity-100"
                aria-label={`Remove ${c}`}
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
          {classes.length === 0 && <span className="text-[10px] text-wb-muted">(none)</span>}
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addChip()}
            placeholder="add a class…"
            aria-label="Add a class"
            className="min-w-0 flex-1 rounded-sm border border-wb-border bg-wb-bg px-1.5 py-0.5 font-mono text-[10px] text-wb-fg outline-none focus:border-wb-accent"
          />
          <button
            type="button"
            aria-label="Add the class"
            onClick={addChip}
            className="shrink-0 rounded-sm border border-wb-border p-0.5 text-wb-muted transition-colors hover:bg-wb-subtle hover:text-wb-fg"
          >
            <Plus className="size-3" />
          </button>
        </div>
      </div>
      </div>
    </div>,
    document.body,
  );
}

function ToggleGroup({
  label,
  options,
  active,
  onPick,
}: {
  label: string;
  options: readonly string[];
  active: string | null;
  onPick: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium text-wb-muted">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onPick(o)}
            // The visible label drops the shared prefix, so the full utility name has
            // to stay reachable somewhere — this is the only place it is.
            title={o}
            aria-pressed={active === o}
            className={cn(
              'rounded-sm border px-1.5 py-0.5 font-mono text-[10px] transition-colors',
              active === o
                ? 'border-wb-accent/40 bg-wb-accent/12 text-wb-accent'
                : 'border-wb-border text-wb-muted hover:bg-wb-subtle hover:text-wb-fg',
            )}
          >
            {/* Drop the shared stem (`flex-`, `items-`, `justify-`, `gap-`) so the row
                reads as short option labels rather than repeated prefixes. */}
            {o.replace(/^(flex|items|justify|gap)-/, '')}
          </button>
        ))}
      </div>
    </div>
  );
}

function SizeSelect({
  label,
  prefix,
  value,
  onPick,
}: {
  label: string;
  prefix: 'w' | 'h';
  value: string;
  onPick: (value: string | null) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium text-wb-muted">{label}</p>
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onPick(e.target.value || null)}
        className="w-full rounded-sm border border-wb-border bg-wb-bg px-1.5 py-0.5 font-mono text-[10px] text-wb-fg outline-none focus:border-wb-accent"
      >
        {/* The empty option IS "no preset": picking it clears the utility rather than
            setting one, which is why `onPick` takes `null`. */}
        <option value="">—</option>
        {SIZE_SCALE.map((s) => (
          <option key={s} value={s}>
            {prefix}-{s}
          </option>
        ))}
      </select>
    </div>
  );
}

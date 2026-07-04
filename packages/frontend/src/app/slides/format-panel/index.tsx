import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Effects,
  Element,
  Frame,
  ImageElement,
  SlidesEditor,
  SlidesStore,
  TextElement,
  AutofitMode,
} from '@wafflebase/slides';
import { deckSlideHeight, findElementPath } from '@wafflebase/slides';
import { pickSections, type PanelSelection } from './pick-sections';
import { SlideSizeSection } from './slide-size-section';
import { AltTextSection } from './alt-text-section';
import { ImageAdjustmentsSection } from './image-adjustments-section';
import { RecolorSection } from './recolor-section';
import { TextFittingSection } from './text-fitting-section';
import { SizePositionSection } from './size-position-section';
import { DropShadowSection } from './drop-shadow-section';
import { ReflectionSection } from './reflection-section';
import type { DisplayUnit } from './units';

export interface FormatPanelProps {
  store: SlidesStore;
  editor: SlidesEditor;
  onClose: () => void;
  /**
   * `drawer` (default) docks as a fixed-width column on desktop;
   * `sheet` returns content-only for a mobile bottom `Sheet` that owns
   * the chrome (title + built-in close).
   */
  variant?: 'drawer' | 'sheet';
}

function derivePanelSelection(
  store: SlidesStore,
  editor: SlidesEditor,
): PanelSelection {
  const slideId = editor.getCurrentSlideId();
  const ids = editor.getSelection();
  if (!slideId || ids.length === 0) return { kind: 'idle' };
  const slide = store.read().slides.find((s) => s.id === slideId);
  if (!slide) return { kind: 'idle' };
  const elements: Element[] = [];
  for (const id of ids) {
    const path = findElementPath(slide.elements, id);
    if (path) elements.push(path[path.length - 1]);
  }
  if (elements.length === 0) return { kind: 'idle' };
  const types = new Set(elements.map((el) => el.type));
  let selectionType:
    | 'shape'
    | 'image'
    | 'text-element'
    | 'connector'
    | 'group'
    | 'table'
    | 'mixed';
  if (types.size > 1) selectionType = 'mixed';
  else if (types.has('shape')) selectionType = 'shape';
  else if (types.has('image')) selectionType = 'image';
  else if (types.has('text')) selectionType = 'text-element';
  else if (types.has('connector')) selectionType = 'connector';
  else if (types.has('group')) selectionType = 'group';
  else if (types.has('table')) selectionType = 'table';
  else selectionType = 'mixed';
  return { kind: 'object', selectionType, elements, slideId };
}

export function FormatPanel({
  store,
  editor,
  onClose,
  variant = 'drawer',
}: FormatPanelProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const u1 = store.onChange?.(() => setTick((t) => t + 1));
    const u2 = editor.onSelectionChange(() => setTick((t) => t + 1));
    return () => {
      u1?.();
      u2();
    };
  }, [store, editor]);

  // tick gates re-derivation; the store/editor reads are the source of truth.
  void tick;

  const selection = useMemo(
    () => derivePanelSelection(store, editor),
    // tick is intentional: bumping it on store/editor changes re-runs the
    // derivation even though the inputs (store, editor) are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, editor, tick],
  );
  const unit: DisplayUnit = store.read().meta.unit ?? 'in';
  const sections = pickSections(selection);

  const commitFrame = useCallback(
    (ids: readonly string[], patch: Partial<Frame>) => {
      const slideId =
        selection.kind === 'object' ? selection.slideId : undefined;
      if (!slideId) return;
      // A W/H change on a group leaves a residual non-uniform scale; bake
      // it so the group rests at scale 1 (resting-scale invariant, see
      // docs/design/slides/slides-group.md §6.1). x/y-only patches don't
      // change scale, so only bake when the size actually changed.
      const changesSize = patch.w !== undefined || patch.h !== undefined;
      const groupIds =
        changesSize && selection.kind === 'object'
          ? ids.filter(
              (id) =>
                selection.elements.find((e) => e.id === id)?.type === 'group',
            )
          : [];
      store.batch(() => {
        for (const id of ids) store.updateElementFrame(slideId, id, patch);
        for (const gid of groupIds) store.bakeGroupResize(slideId, gid);
      });
    },
    [store, selection],
  );

  const translate = useCallback(
    (ids: readonly string[], dx: number, dy: number) => {
      if (selection.kind !== 'object') return;
      store.batch(() => {
        for (const id of ids) {
          const el = selection.elements.find((e) => e.id === id);
          if (!el) continue;
          store.updateElementFrame(selection.slideId, id, {
            x: el.frame.x + dx,
            y: el.frame.y + dy,
          });
        }
      });
    },
    [store, selection],
  );

  const rotate90 = useCallback(
    (ids: readonly string[], direction: 1 | -1) => {
      if (selection.kind !== 'object') return;
      const delta = (direction * Math.PI) / 2;
      store.batch(() => {
        for (const id of ids) {
          const el = selection.elements.find((e) => e.id === id);
          if (!el) continue;
          const next =
            ((el.frame.rotation + delta) % (Math.PI * 2) + Math.PI * 2) %
            (Math.PI * 2);
          store.updateElementFrame(selection.slideId, id, { rotation: next });
        }
      });
    },
    [store, selection],
  );

  const setUnit = useCallback(
    (next: DisplayUnit) => {
      store.batch(() => store.setUnit(next));
    },
    [store],
  );

  const commitSlideHeight = useCallback(
    (heightPx: number) => {
      store.batch(() => store.setSlideHeight(heightPx));
    },
    [store],
  );

  const commitElementData = useCallback(
    (ids: readonly string[], patch: object) => {
      if (selection.kind !== 'object') return;
      store.batch(() => {
        for (const id of ids)
          store.updateElementData(selection.slideId, id, patch);
      });
    },
    [store, selection],
  );

  // Effects are merged per-element so editing one effect (shadow) preserves
  // any other (reflection) already on that element. A `undefined` value in
  // the patch removes that effect; the whole `effects` key is dropped when
  // nothing remains so empty `{}` cruft never reaches storage.
  const commitEffects = useCallback(
    (ids: readonly string[], patch: Partial<Effects>) => {
      if (selection.kind !== 'object') return;
      store.batch(() => {
        for (const id of ids) {
          const el = selection.elements.find((e) => e.id === id);
          if (!el) continue;
          const existing = (el as { data?: { effects?: Effects } }).data
            ?.effects;
          const merged: Record<string, unknown> = { ...existing };
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) delete merged[k];
            else merged[k] = v;
          }
          const next = merged as Effects;
          const effects = next.shadow || next.reflection ? next : undefined;
          store.updateElementData(selection.slideId, id, { effects });
        }
      });
    },
    [store, selection],
  );

  const lockedResize = useCallback(
    (elems: readonly Element[], axis: 'w' | 'h', newPx: number) => {
      if (selection.kind !== 'object') return;
      store.batch(() => {
        for (const el of elems) {
          const ratio = el.frame.w === 0 ? 1 : el.frame.h / el.frame.w;
          const patch =
            axis === 'w'
              ? { w: newPx, h: newPx * ratio }
              : { h: newPx, w: ratio === 0 ? el.frame.w : newPx / ratio };
          store.updateElementFrame(selection.slideId, el.id, patch);
        }
        // Bake any resized group so it rests at scale 1 (resting-scale
        // invariant, docs/design/slides/slides-group.md §6.1).
        for (const el of elems) {
          if (el.type === 'group') {
            store.bakeGroupResize(selection.slideId, el.id);
          }
        }
      });
    },
    [store, selection],
  );

  const content = (
    <>
      {selection.kind === 'idle' && (
          <>
            <SlideSizeSection
              heightPx={deckSlideHeight(store.read().meta)}
              unit={unit}
              onCommit={commitSlideHeight}
            />
            <p className="px-3 pb-3 text-[11px] text-muted-foreground">
              Select an object to edit its format.
            </p>
          </>
        )}
        {selection.kind === 'object' &&
          sections.map((id) => {
            switch (id) {
              case 'size-position': {
                const textAutofitMode =
                  selection.selectionType === 'text-element'
                    ? ((selection.elements[0] as TextElement).data.autofit ??
                      'grow')
                    : undefined;
                return (
                  <SizePositionSection
                    key={id}
                    kind={selection.selectionType}
                    elements={selection.elements}
                    unit={unit}
                    textAutofitMode={textAutofitMode}
                    onCommitFrame={commitFrame}
                    onTranslate={translate}
                    onSetUnit={setUnit}
                    onRotate90={rotate90}
                    onLockedResize={lockedResize}
                  />
                );
              }
              case 'text-fitting':
                return (
                  <TextFittingSection
                    key={id}
                    elements={selection.elements as readonly TextElement[]}
                    onCommit={(ids, mode: AutofitMode) =>
                      commitElementData(ids, { autofit: mode })
                    }
                  />
                );
              case 'recolor':
                return (
                  <RecolorSection
                    key={id}
                    elements={selection.elements as readonly ImageElement[]}
                    onCommit={(ids, recolor) =>
                      commitElementData(ids, { recolor })
                    }
                  />
                );
              case 'image-adjustments':
                return (
                  <ImageAdjustmentsSection
                    key={id}
                    elements={selection.elements as readonly ImageElement[]}
                    onCommit={(ids, patch) => commitElementData(ids, patch)}
                  />
                );
              case 'drop-shadow':
                return (
                  <DropShadowSection
                    key={id}
                    elements={selection.elements}
                    onCommit={(ids, shadow) => commitEffects(ids, { shadow })}
                  />
                );
              case 'reflection':
                return (
                  <ReflectionSection
                    key={id}
                    elements={selection.elements}
                    onCommit={(ids, reflection) =>
                      commitEffects(ids, { reflection })
                    }
                  />
                );
              case 'alt-text':
                return (
                  <AltTextSection
                    key={id}
                    elements={selection.elements}
                    onCommit={(ids, alt) => commitElementData(ids, { alt })}
                  />
                );
            }
          })}
    </>
  );

  if (variant === 'sheet') {
    return <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>;
  }

  return (
    <aside
      aria-label="Format options"
      className="flex w-72 shrink-0 flex-col border-l bg-background"
    >
      <header className="flex items-center justify-between border-b p-2">
        <h2 className="text-sm font-semibold">Format options</h2>
        <button
          type="button"
          aria-label="Close format options"
          onClick={onClose}
          className="rounded p-1 hover:bg-muted"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">{content}</div>
    </aside>
  );
}

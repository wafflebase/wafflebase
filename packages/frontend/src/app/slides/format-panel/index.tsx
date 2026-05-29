import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Element,
  Frame,
  ImageElement,
  SlidesEditor,
  SlidesStore,
  TextElement,
  AutofitMode,
} from '@wafflebase/slides';
import { findElementPath } from '@wafflebase/slides';
import { pickSections, type PanelSelection } from './pick-sections';
import { AltTextSection } from './alt-text-section';
import { ImageAdjustmentsSection } from './image-adjustments-section';
import { TextFittingSection } from './text-fitting-section';
import { SizePositionSection } from './size-position-section';
import type { DisplayUnit } from './units';

export interface FormatPanelProps {
  store: SlidesStore;
  editor: SlidesEditor;
  onClose: () => void;
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
    | 'mixed';
  if (types.size > 1) selectionType = 'mixed';
  else if (types.has('shape')) selectionType = 'shape';
  else if (types.has('image')) selectionType = 'image';
  else if (types.has('text')) selectionType = 'text-element';
  else if (types.has('connector')) selectionType = 'connector';
  else if (types.has('group')) selectionType = 'group';
  else selectionType = 'mixed';
  return { kind: 'object', selectionType, elements, slideId };
}

export function FormatPanel({ store, editor, onClose }: FormatPanelProps) {
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
      store.batch(() => {
        for (const id of ids) store.updateElementFrame(slideId, id, patch);
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
      });
    },
    [store, selection],
  );

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
      <div className="flex-1 overflow-y-auto">
        {selection.kind === 'idle' && (
          <p className="p-4 text-xs text-muted-foreground">
            Select an object to edit its format.
          </p>
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
              case 'image-adjustments':
                return (
                  <ImageAdjustmentsSection
                    key={id}
                    elements={selection.elements as readonly ImageElement[]}
                    onCommit={(ids, opacity) =>
                      commitElementData(ids, { opacity })
                    }
                  />
                );
              case 'alt-text':
                return (
                  <AltTextSection
                    key={id}
                    elements={selection.elements as readonly ImageElement[]}
                    onCommit={(ids, alt) => commitElementData(ids, { alt })}
                  />
                );
            }
          })}
      </div>
    </aside>
  );
}

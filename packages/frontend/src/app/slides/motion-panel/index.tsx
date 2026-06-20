import { useEffect, useState } from 'react';
import type { SlidesEditor, SlidesStore } from '@wafflebase/slides';
import { AnimationSection } from './animation-section';
import { TransitionSection } from './transition-section';

export interface MotionPanelProps {
  store: SlidesStore;
  editor: SlidesEditor;
  onClose: () => void;
}

export function MotionPanel({ store, editor, onClose }: MotionPanelProps) {
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

  const slideId = editor.getCurrentSlideId();
  const selectedElementIds = editor.getSelection();

  return (
    <aside
      aria-label="Motion"
      className="flex w-72 shrink-0 flex-col border-l bg-background"
    >
      <header className="flex items-center justify-between border-b p-2">
        <h2 className="text-sm font-semibold">Motion</h2>
        <button
          type="button"
          aria-label="Close motion panel"
          onClick={onClose}
          className="rounded p-1 hover:bg-muted"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <section data-testid="motion-transition-section">
          {slideId !== undefined && (
            <TransitionSection store={store} slideId={slideId} />
          )}
        </section>
        <section data-testid="motion-animation-section">
          {slideId !== undefined && (
            <AnimationSection
              store={store}
              slideId={slideId}
              selectedElementIds={selectedElementIds}
              editor={editor}
            />
          )}
        </section>
      </div>
    </aside>
  );
}

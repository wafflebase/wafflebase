import type { SlidesEditor, SlidesStore } from '@wafflebase/slides';

export interface MotionPanelProps {
  store: SlidesStore;
  editor: SlidesEditor;
  onClose: () => void;
}

export function MotionPanel({ onClose }: MotionPanelProps) {
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
        <section data-testid="motion-transition-section" />
        <section data-testid="motion-animation-section" />
      </div>
    </aside>
  );
}

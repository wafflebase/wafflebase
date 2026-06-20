import type { AnimEffect, AnimStart, SlideAnimation, SlidesStore } from '@wafflebase/slides';
import { Button } from '@/components/ui/button';

const ENTRANCE: AnimEffect[] = ['appear', 'fadeIn', 'flyIn', 'zoomIn', 'spin'];
const STARTS: AnimStart[] = ['onClick', 'withPrev', 'afterPrev'];

const EFFECT_LABELS: Record<(typeof ENTRANCE)[number], string> = {
  appear: 'Appear',
  fadeIn: 'Fade In',
  flyIn: 'Fly In',
  zoomIn: 'Zoom In',
  spin: 'Spin',
};

const START_LABELS: Record<AnimStart, string> = {
  onClick: 'On Click',
  withPrev: 'With Previous',
  afterPrev: 'After Previous',
};

const SELECT_CLASS =
  'border-input focus-visible:border-ring focus-visible:ring-ring/50 h-7 flex-1 rounded-md border bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-50';

export function AnimationSection(props: {
  store: SlidesStore;
  slideId: string;
  selectedElementIds: string[];
}) {
  const slide = props.store.read().slides.find((s) => s.id === props.slideId);
  const list: SlideAnimation[] = slide?.animations ?? [];
  const target = props.selectedElementIds[0];

  const add = () => {
    if (!target) return;
    const a: SlideAnimation = {
      id: crypto.randomUUID(),
      elementId: target,
      category: 'entrance',
      effect: 'fadeIn',
      start: 'onClick',
      durationMs: 500,
    };
    props.store.batch(() => props.store.addAnimation(props.slideId, a));
  };

  return (
    <section aria-labelledby="motion-animation-label" className="p-3">
      <h3 id="motion-animation-label" className="mb-3 text-xs font-semibold">
        Animation
      </h3>
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 w-full px-2 text-xs"
          disabled={!target}
          onClick={add}
        >
          + Add animation
        </Button>
        {list.length > 0 && (
          <ol data-testid="anim-list" className="space-y-2 pt-1">
            {list.map((a, i) => (
              <li key={a.id} className="rounded-md border bg-muted/30 p-2 text-xs">
                <div className="mb-2 flex items-center gap-1">
                  <span className="flex-1 truncate font-medium">
                    {i + 1}. {a.effect} → {a.elementId}
                  </span>
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() =>
                      props.store.batch(() =>
                        props.store.reorderAnimation(props.slideId, a.id, i - 1),
                      )
                    }
                    className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={i === list.length - 1}
                    onClick={() =>
                      props.store.batch(() =>
                        props.store.reorderAnimation(props.slideId, a.id, i + 1),
                      )
                    }
                    className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label="Remove animation"
                    onClick={() =>
                      props.store.batch(() =>
                        props.store.removeAnimation(props.slideId, a.id),
                      )
                    }
                    className="rounded p-0.5 text-destructive hover:bg-muted"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-muted-foreground">Effect</span>
                    <select
                      aria-label="Animation effect"
                      value={a.effect}
                      onChange={(e) =>
                        props.store.batch(() =>
                          props.store.updateAnimation(props.slideId, a.id, {
                            effect: e.target.value as AnimEffect,
                          }),
                        )
                      }
                      className={SELECT_CLASS}
                    >
                      {ENTRANCE.map((ef) => (
                        <option key={ef} value={ef}>
                          {EFFECT_LABELS[ef]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-muted-foreground">Start</span>
                    <select
                      aria-label="Animation start"
                      value={a.start}
                      onChange={(e) =>
                        props.store.batch(() =>
                          props.store.updateAnimation(props.slideId, a.id, {
                            start: e.target.value as AnimStart,
                          }),
                        )
                      }
                      className={SELECT_CLASS}
                    >
                      {STARTS.map((s) => (
                        <option key={s} value={s}>
                          {START_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-muted-foreground">Duration</span>
                    <input
                      type="range"
                      aria-label="Animation duration"
                      min={100}
                      max={3000}
                      step={100}
                      value={a.durationMs}
                      onChange={(e) =>
                        props.store.batch(() =>
                          props.store.updateAnimation(props.slideId, a.id, {
                            durationMs: Number(e.target.value),
                          }),
                        )
                      }
                      className="h-4 flex-1 accent-primary"
                    />
                    <span className="w-10 text-right text-muted-foreground">
                      {(a.durationMs / 1000).toFixed(1)}s
                    </span>
                  </label>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

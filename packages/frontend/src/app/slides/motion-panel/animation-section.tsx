import type {
  AnimCategory,
  AnimDirection,
  AnimEasing,
  AnimEffect,
  AnimStart,
  SlideAnimation,
  SlidesEditor,
  SlidesStore,
} from '@wafflebase/slides';
import { findElementPath } from '@wafflebase/slides';
import { Button } from '@/components/ui/button';
import { IconPlayerPlay } from '@tabler/icons-react';

const EFFECTS_BY_CATEGORY: Record<AnimCategory, AnimEffect[]> = {
  entrance: ['appear', 'fadeIn', 'flyIn', 'zoomIn', 'spin'],
  exit: ['disappear', 'fadeOut', 'flyOut', 'zoomOut'],
  emphasis: ['pulse', 'grow'],
};

const DEFAULT_EFFECT_BY_CATEGORY: Record<AnimCategory, AnimEffect> = {
  entrance: 'fadeIn',
  exit: 'fadeOut',
  emphasis: 'pulse',
};

const STARTS: AnimStart[] = ['onClick', 'withPrev', 'afterPrev'];

const EFFECT_LABELS: Record<AnimEffect, string> = {
  appear: 'Appear',
  fadeIn: 'Fade In',
  flyIn: 'Fly In',
  zoomIn: 'Zoom In',
  spin: 'Spin',
  disappear: 'Disappear',
  fadeOut: 'Fade Out',
  flyOut: 'Fly Out',
  zoomOut: 'Zoom Out',
  pulse: 'Pulse',
  grow: 'Grow',
};

const CATEGORY_LABELS: Record<AnimCategory, string> = {
  entrance: 'Entrance',
  exit: 'Exit',
  emphasis: 'Emphasis',
};

const START_LABELS: Record<AnimStart, string> = {
  onClick: 'On Click',
  withPrev: 'With Previous',
  afterPrev: 'After Previous',
};

const DIRECTION_LABELS: Record<AnimDirection, string> = {
  up: 'From Bottom',
  down: 'From Top',
  left: 'From Right',
  right: 'From Left',
};

const EASING_LABELS: Record<AnimEasing, string> = {
  linear: 'Linear',
  easeIn: 'Ease In',
  easeOut: 'Ease Out',
  easeInOut: 'Ease In Out',
};

const CATEGORIES: AnimCategory[] = ['entrance', 'exit', 'emphasis'];
const DIRECTIONS: AnimDirection[] = ['up', 'down', 'left', 'right'];
const EASINGS: AnimEasing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];

const SELECT_CLASS =
  'border-input focus-visible:border-ring focus-visible:ring-ring/50 h-7 flex-1 rounded-md border bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-50';

const FLY_EFFECTS: AnimEffect[] = ['flyIn', 'flyOut'];

export function AnimationSection(props: {
  store: SlidesStore;
  slideId: string;
  selectedElementIds: string[];
  editor: SlidesEditor;
}) {
  const slide = props.store.read().slides.find((s) => s.id === props.slideId);
  const list: SlideAnimation[] = slide?.animations ?? [];
  const target = props.selectedElementIds[0];
  const hasAnimations = list.length > 0;

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

  const isTextElement = (elementId: string): boolean => {
    if (!slide) return false;
    const path = findElementPath(slide.elements, elementId);
    if (!path || path.length === 0) return false;
    return path[path.length - 1].type === 'text';
  };

  return (
    <section aria-labelledby="motion-animation-label" className="p-3">
      <h3 id="motion-animation-label" className="mb-3 text-xs font-semibold">
        Animation
      </h3>
      <div className="space-y-2">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 flex-1 px-2 text-xs"
            disabled={!target}
            onClick={add}
          >
            + Add animation
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Preview animations"
            className="h-7 px-2"
            disabled={!hasAnimations}
            onClick={() => props.editor.previewAnimations()}
          >
            <IconPlayerPlay size={14} />
          </Button>
        </div>
        {list.length > 0 && (
          <ol data-testid="anim-list" className="space-y-2 pt-1">
            {list.map((a, i) => {
              const effects = EFFECTS_BY_CATEGORY[a.category];
              const showDirection = FLY_EFFECTS.includes(a.effect);
              const showByParagraph = isTextElement(a.elementId);

              return (
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
                      <span className="w-16 shrink-0 text-muted-foreground">Category</span>
                      <select
                        aria-label="Animation category"
                        value={a.category}
                        onChange={(e) => {
                          const category = e.target.value as AnimCategory;
                          const effect = DEFAULT_EFFECT_BY_CATEGORY[category];
                          props.store.batch(() =>
                            props.store.updateAnimation(props.slideId, a.id, {
                              category,
                              effect,
                            }),
                          );
                        }}
                        className={SELECT_CLASS}
                      >
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {CATEGORY_LABELS[cat]}
                          </option>
                        ))}
                      </select>
                    </label>
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
                        {effects.map((ef) => (
                          <option key={ef} value={ef}>
                            {EFFECT_LABELS[ef]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {showDirection && (
                      <label className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-muted-foreground">Direction</span>
                        <select
                          aria-label="Animation direction"
                          value={a.direction ?? 'right'}
                          onChange={(e) =>
                            props.store.batch(() =>
                              props.store.updateAnimation(props.slideId, a.id, {
                                direction: e.target.value as AnimDirection,
                              }),
                            )
                          }
                          className={SELECT_CLASS}
                        >
                          {DIRECTIONS.map((d) => (
                            <option key={d} value={d}>
                              {DIRECTION_LABELS[d]}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
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
                    <label className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-muted-foreground">Delay</span>
                      <input
                        type="number"
                        aria-label="Animation delay"
                        min={0}
                        step={100}
                        value={a.delayMs ?? 0}
                        onChange={(e) =>
                          props.store.batch(() =>
                            props.store.updateAnimation(props.slideId, a.id, {
                              delayMs: Math.max(0, Number(e.target.value)),
                            }),
                          )
                        }
                        className={SELECT_CLASS}
                      />
                      <span className="shrink-0 text-muted-foreground">ms</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-muted-foreground">Easing</span>
                      <select
                        aria-label="Animation easing"
                        value={a.easing ?? 'easeInOut'}
                        onChange={(e) =>
                          props.store.batch(() =>
                            props.store.updateAnimation(props.slideId, a.id, {
                              easing: e.target.value as AnimEasing,
                            }),
                          )
                        }
                        className={SELECT_CLASS}
                      >
                        {EASINGS.map((ease) => (
                          <option key={ease} value={ease}>
                            {EASING_LABELS[ease]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {showByParagraph && (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label="By paragraph"
                          checked={a.byParagraph ?? false}
                          onChange={(e) =>
                            props.store.batch(() =>
                              props.store.updateAnimation(props.slideId, a.id, {
                                byParagraph: e.target.checked,
                              }),
                            )
                          }
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        <span className="text-muted-foreground">By paragraph</span>
                      </label>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  up: 'From Top',
  down: 'From Bottom',
  left: 'From Left',
  right: 'From Right',
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

// Static option lists are hoisted so they aren't rebuilt per render/animation.
// (Effect options stay inline since they depend on the row's category.)
const CATEGORY_OPTIONS = CATEGORIES.map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));
const START_OPTIONS = STARTS.map((value) => ({
  value,
  label: START_LABELS[value],
}));
const EASING_OPTIONS = EASINGS.map((value) => ({
  value,
  label: EASING_LABELS[value],
}));
const DIRECTION_OPTIONS = DIRECTIONS.map((value) => ({
  value,
  label: DIRECTION_LABELS[value],
}));

const FLY_EFFECTS: AnimEffect[] = ['flyIn', 'flyOut'];

/** Compact labelled Select row used for each animation field. */
function MotionSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger
          size="sm"
          aria-label={`Animation ${label.toLowerCase()}`}
          className="h-7 flex-1 px-2 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

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
                    <MotionSelect
                      label="Category"
                      value={a.category}
                      options={CATEGORY_OPTIONS}
                      onChange={(category) => {
                        const effect = DEFAULT_EFFECT_BY_CATEGORY[category];
                        props.store.batch(() =>
                          props.store.updateAnimation(props.slideId, a.id, {
                            category,
                            effect,
                          }),
                        );
                      }}
                    />
                    <MotionSelect
                      label="Effect"
                      value={a.effect}
                      options={effects.map((ef) => ({
                        value: ef,
                        label: EFFECT_LABELS[ef],
                      }))}
                      onChange={(effect) =>
                        props.store.batch(() =>
                          props.store.updateAnimation(props.slideId, a.id, {
                            effect,
                          }),
                        )
                      }
                    />
                    {showDirection && (
                      <MotionSelect
                        label="Direction"
                        value={a.direction ?? 'right'}
                        options={DIRECTION_OPTIONS}
                        onChange={(direction) =>
                          props.store.batch(() =>
                            props.store.updateAnimation(props.slideId, a.id, {
                              direction,
                            }),
                          )
                        }
                      />
                    )}
                    <MotionSelect
                      label="Start"
                      value={a.start}
                      options={START_OPTIONS}
                      onChange={(start) =>
                        props.store.batch(() =>
                          props.store.updateAnimation(props.slideId, a.id, {
                            start,
                          }),
                        )
                      }
                    />
                    <label className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-muted-foreground">Duration</span>
                      <Slider
                        aria-label="Animation duration"
                        min={100}
                        max={3000}
                        step={100}
                        value={[a.durationMs]}
                        onValueChange={([v]) =>
                          props.store.batch(() =>
                            props.store.updateAnimation(props.slideId, a.id, {
                              durationMs: v,
                            }),
                          )
                        }
                        className="flex-1"
                      />
                      <span className="w-10 text-right text-muted-foreground">
                        {(a.durationMs / 1000).toFixed(1)}s
                      </span>
                    </label>
                    <label className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-muted-foreground">Delay</span>
                      <Input
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
                        className="h-7 flex-1 px-2 text-xs"
                      />
                      <span className="shrink-0 text-muted-foreground">ms</span>
                    </label>
                    <MotionSelect
                      label="Easing"
                      value={a.easing ?? 'easeInOut'}
                      options={EASING_OPTIONS}
                      onChange={(easing) =>
                        props.store.batch(() =>
                          props.store.updateAnimation(props.slideId, a.id, {
                            easing,
                          }),
                        )
                      }
                    />
                    {showByParagraph && (
                      <label className="flex items-center gap-2">
                        <Checkbox
                          aria-label="By paragraph"
                          checked={a.byParagraph ?? false}
                          onCheckedChange={(checked) =>
                            props.store.batch(() =>
                              props.store.updateAnimation(props.slideId, a.id, {
                                byParagraph: checked === true,
                              }),
                            )
                          }
                          className="size-3.5"
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

import type { SlidesStore, SlideTransition } from '@wafflebase/slides';
import { Button } from '@/components/ui/button';

const TYPES: Array<SlideTransition['type'] | 'none'> = [
  'none',
  'fade',
  'dissolve',
  'slide',
  'flip',
  'cube',
  'wipe',
  'push',
];

const SPEED_MS = { slow: 1000, med: 500, fast: 250 } as const;

const TYPE_LABELS: Record<SlideTransition['type'] | 'none', string> = {
  none: 'None',
  fade: 'Fade',
  dissolve: 'Dissolve',
  slide: 'Slide',
  flip: 'Flip',
  cube: 'Cube',
  wipe: 'Wipe',
  push: 'Push',
};

export function TransitionSection(props: {
  store: SlidesStore;
  slideId: string;
}) {
  const slide = props.store.read().slides.find((s) => s.id === props.slideId);
  const t = slide?.transition;

  const set = (next: SlideTransition | undefined) =>
    props.store.batch(() =>
      props.store.setSlideTransition(props.slideId, next),
    );

  return (
    <section aria-labelledby="motion-transition-label" className="p-3">
      <h3
        id="motion-transition-label"
        className="mb-3 text-xs font-semibold"
      >
        Transition
      </h3>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0">Type</span>
          <select
            aria-label="Transition type"
            value={t?.type ?? 'none'}
            onChange={(e) => {
              const type = e.target.value as SlideTransition['type'] | 'none';
              set(
                type === 'none'
                  ? undefined
                  : { type, durationMs: t?.durationMs ?? SPEED_MS.med },
              );
            }}
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-7 flex-1 rounded-md border bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-50"
          >
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {TYPE_LABELS[ty]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0">Speed</span>
          <select
            aria-label="Transition speed"
            value={t?.durationMs ?? SPEED_MS.med}
            disabled={!t}
            onChange={(e) =>
              t && set({ ...t, durationMs: Number(e.target.value) })
            }
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-7 flex-1 rounded-md border bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-50"
          >
            <option value={SPEED_MS.slow}>Slow</option>
            <option value={SPEED_MS.med}>Medium</option>
            <option value={SPEED_MS.fast}>Fast</option>
          </select>
        </label>
        <div className="pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 w-full px-2 text-xs"
            onClick={() =>
              props.store.batch(() => {
                for (const s of props.store.read().slides) {
                  props.store.setSlideTransition(
                    s.id,
                    t ? { ...t } : undefined,
                  );
                }
              })
            }
          >
            Apply to all slides
          </Button>
        </div>
      </div>
    </section>
  );
}

import type { SlidesStore, SlideTransition } from '@wafflebase/slides';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TRIGGER_CLASS = 'h-7 flex-1 px-2 text-xs';

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
          <Select
            value={t?.type ?? 'none'}
            onValueChange={(value) => {
              const type = value as SlideTransition['type'] | 'none';
              set(
                type === 'none'
                  ? undefined
                  : { type, durationMs: t?.durationMs ?? SPEED_MS.med },
              );
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label="Transition type"
              className={TRIGGER_CLASS}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((ty) => (
                <SelectItem key={ty} value={ty}>
                  {TYPE_LABELS[ty]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0">Speed</span>
          <Select
            value={String(t?.durationMs ?? SPEED_MS.med)}
            disabled={!t}
            onValueChange={(value) =>
              t && set({ ...t, durationMs: Number(value) })
            }
          >
            <SelectTrigger
              size="sm"
              aria-label="Transition speed"
              className={TRIGGER_CLASS}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={String(SPEED_MS.slow)}>Slow</SelectItem>
              <SelectItem value={String(SPEED_MS.med)}>Medium</SelectItem>
              <SelectItem value={String(SPEED_MS.fast)}>Fast</SelectItem>
            </SelectContent>
          </Select>
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

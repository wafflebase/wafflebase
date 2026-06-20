---
title: slides-animation
target-version: 0.5.0
---

# Slides Motion — Transitions & Object Animations

## Summary

Slides currently renders statically: presentation mode does hard cuts
between slides and elements never move. This adds **motion** parity with
Google Slides / PowerPoint in two layers:

- **Slide transitions** — an effect played when advancing from one slide
  to the next (fade, dissolve, slide/push, wipe, flip, cube).
- **Object animations** — per-element entrance / exit / emphasis effects
  (fade, fly, zoom, spin, …) sequenced within a slide with PowerPoint-style
  start conditions (on click / with previous / after previous).

The data model follows Google Slides' **flat sequence** shape (simple to
edit and CRDT-friendly) while the schema carries OOXML preset/path
**preservation fields** so PPTX import is lossless even for effects we
don't yet play. A single pure animation engine drives playback in both
presentation mode and an editor **Play** preview; the existing Canvas
renderer stays stateless and receives per-element transforms as an
optional argument.

Prior design notes (`slides.md`, `slides-presentation-mode.md`) listed
animations/transitions as explicit non-goals ("cuts only"). This document
supersedes those non-goals.

### Goals

- Author slide transitions (per-slide + "apply to all") and object
  animations (add / reorder / remove / configure) from a right-side
  **Motion** panel.
- Play animations in presentation mode (keyboard / click advance, with
  PowerPoint-style on-click / with-previous / after-previous timing) and
  in an editor **Play** preview, driven by one shared engine.
- Support entrance / exit / emphasis effects and by-paragraph text reveal.
- Import PPTX `<p:transition>` and `<p:timing>` best-effort, mapping known
  effect presets and **preserving** unmapped presets / motion paths for
  lossless round-trip (preview-only when unplayable).
- Keep the static render path byte-identical when no animation state is
  supplied (zero regression for existing decks).

Success = a deck with transitions + multi-step object animations authored
in-app plays correctly in presentation mode; a PPTX with animations
imports without dropping effect data; existing decks render unchanged.

### Non-Goals

- **Motion path authoring.** Motion paths are *preserved* on import but
  not user-authored in v1 (matches Google Slides).
- **Animation triggers** (start a sequence by clicking a specific shape /
  OOXML `interactiveSeq`). Dropped on import with a report warning.
- **Auto-advance / timed slideshow** (per-slide `advTm`). Out of scope.
- **PPTX export.** v1 exports PDF only; preservation fields lay the
  groundwork for a future lossless PPTX export but no serializer is built.
- **Audio / video timeline nodes.** Dropped with a report warning.
- **Presence-synced playback.** Playback is local to each viewer, like the
  existing presenter.

## Proposal Details

### Architecture overview

```
  Motion panel (frontend) ──Store ops──▶ CRDT (Slide.transition, Slide.animations)
                                              │
                                              ▼
                              src/anim/  (pure, no DOM / no time)
                              ├─ timeline.ts  compile flat list → Step[]
                              ├─ effects.ts   effect → (progress)→Partial<AnimState>
                              ├─ easing.ts    linear/easeIn/easeOut/easeInOut
                              ├─ sample.ts    Step + elapsed → Map<id, AnimState>
                              ├─ transition.ts transition type → cross-paint
                              └─ player.ts    RAF state machine (advance/tick)
                                              │ onFrame(states)
                          ┌───────────────────┴───────────────────┐
                          ▼                                       ▼
              presenter.ts (present mode)            Motion panel ▶ Play (editor)
                          │                                       │
                          └──────── forceRender(slide, doc, ghosts?, animStates?) ┘
                                              │
                            view/canvas/slide-renderer + element-renderer
                                  (stateless; animStates injected at paint)
```

The renderer stays pure. The `src/anim/` engine is pure and
deterministic (no DOM, time injected). Only `presenter.ts` and the panel's
Play control own a RAF loop, and both use the same `AnimationPlayer`.

### Data model & CRDT schema

`src/model/element.ts` — animation value types (no field added to
`Element` itself; the sequence lives on the slide, see below):

```ts
export type AnimCategory = 'entrance' | 'exit' | 'emphasis';
export type AnimStart = 'onClick' | 'withPrev' | 'afterPrev';
export type AnimEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
export type AnimDirection = 'up' | 'down' | 'left' | 'right';

export type AnimEffect =
  | 'appear' | 'fadeIn' | 'flyIn' | 'zoomIn' | 'spin'   // entrance
  | 'disappear' | 'fadeOut' | 'flyOut' | 'zoomOut'      // exit
  | 'pulse' | 'grow';                                   // emphasis

export type ObjectAnimation = {
  id: string;
  category: AnimCategory;
  effect: AnimEffect;
  start: AnimStart;
  direction?: AnimDirection;          // fly effects
  durationMs: number;
  delayMs?: number;
  easing?: AnimEasing;                // absent ⇒ easeInOut
  byParagraph?: boolean;              // text elements only
  // PPTX round-trip preservation (lossless even when unplayed):
  pptxPreset?: { class: string; id: number; subtype?: number };
  motionPath?: string;               // normalized <p:animMotion> path, preserved only
};
```

`src/model/presentation.ts` — slide-level transition + animation sequence:

```ts
export type SlideTransition = {
  type: 'none'|'fade'|'dissolve'|'slide'|'flip'|'cube'|'wipe'|'push';
  direction?: AnimDirection;
  durationMs: number;
};

export type SlideAnimation = ObjectAnimation & { elementId: string };

export type Slide = {
  id: string; layoutId: string; background: Background;
  elements: Element[]; notes: Block[];
  transition?: SlideTransition;        // absent ⇒ cut (current behavior)
  animations?: SlideAnimation[];       // playback order = array order
};
```

**Why the sequence lives on the slide, not on each element.** Playback
order is a single per-slide dimension; storing animations as one ordered
slide-level list makes the array index *be* the order, so there is no
separate `order` integer to conflict on under concurrent edits. With/after
relationships are encoded relative to the previous list item, which
flattens PowerPoint's time-node tree losslessly.

**CRDT mapping (Yorkie).**

- `Slide.animations` → a slide-level `Yorkie.Array`. Concurrent appends
  merge; reorder/remove follow the array. A `SlideAnimation` whose
  `elementId` no longer resolves (element deleted) is skipped at
  queue-build time — the presenter already reconciles by ID.
- Each animation's scalar fields (`effect`, `start`, `durationMs`, …) are
  LWW. Animation editing is low-contention; this matches the slides
  "LWW-on-blur" posture (`slides-collaboration.md`).
- `Slide.transition` → an LWW object on the slide, mirroring the existing
  `background` pattern.

Both new slide fields are optional, so existing serialized decks keep
their exact JSON shape and render identically.

### Animation engine (`src/anim/`)

Pure, deterministic, separately unit-tested. No DOM, time injected.

**Timeline compilation — `timeline.ts`.** Compile `Slide.animations` into
playback steps:

```ts
type ScheduledAnim = { anim: SlideAnimation; startAtMs: number; endAtMs: number };
type Step = { items: ScheduledAnim[] };   // one onClick advance plays one Step
function compileTimeline(slide: Slide): Step[];
```

Walking the array: an `onClick` item begins a **new Step**; `withPrev`
shares the previous item's `startAtMs`; `afterPrev` starts at the previous
item's `endAtMs`. A `byParagraph` text animation is expanded at compile
time into one scheduled effect per paragraph, chained `afterPrev`.

**Effects registry — `effects.ts`.** Each effect is a pure
`(progress: number) => Partial<AnimState>`:

```ts
type AnimState = {
  opacity: number; scale: number; dx: number; dy: number;
  rotation: number; hidden: boolean;
};
```

Examples: `fadeIn: p => ({ opacity: p })`,
`flyIn(dir): p => ({ dx/dy: (1 - p) * offset, opacity: p })`,
`zoomIn: p => ({ scale: 0.3 + 0.7 * p, opacity: p })`,
`spin: p => ({ rotation: p * 2π })`. Entrance effects report `hidden:true`
before their step starts; exit effects report `hidden:true` after they
finish.

**Easing — `easing.ts`.** `linear | easeIn | easeOut | easeInOut`. OOXML
`accel`/`decel` are quantized onto these on import (PowerPoint's
trapezoidal velocity profile is approximated, not reproduced exactly).

**Sampling — `sample.ts`.** `sampleStep(step, elapsedMs, slideSize) →
Map<elementId, AnimState>`. Progress is eased, then passed to each effect.
Multiple animations on one element **compose**: opacity multiplies, dx/dy
and rotation add, scale multiplies.

**Transitions — `transition.ts`.** `(type, progress) →` a cross-paint
instruction: fade/dissolve = globalAlpha cross-fade; push/slide = offset
translate of prev+next; wipe = clip rect; flip/cube = approximation
(scaleX or fade fallback). Played *before* the slide's step queue, per
OOXML semantics ("transition always precedes slide animation").

**Player — `player.ts`.** RAF state machine shared by presenter and editor
Play:

```ts
class AnimationPlayer {
  constructor(steps: Step[], onFrame: (s: Map<string, AnimState>) => void,
              onStepBoundary?: () => void);
  advance(): void;       // next input: play next Step; if mid-step, skip-to-end
  tick(nowMs: number): void;   // RAF: sample current step → onFrame
  get isLastStep(): boolean;
  reset(): void;
}
```

`advance()` UX: while a step is animating, the next input **completes the
current step immediately** (skip-to-end) and stops; the input after that
plays the next step — matching PowerPoint / Google Slides. `withPrev` /
`afterPrev` items chain automatically inside a step (no extra input). Time
is injected via `tick(nowMs)`, so tests use a fake clock.

### Render integration (approach A)

The renderer stays stateless; animation transforms are injected via an
optional argument so the static path is untouched when absent.

- `slide-renderer.ts`: `drawSlide(ctx, slide, doc, options, onAssetLoad,
  ghosts?, animStates?)` and `forceRender(slide, doc, ghosts?,
  animStates?)`. `animStates?: Map<elementId, AnimState>` — absent ⇒
  byte-identical to today.
- `element-renderer.ts`: `drawElement(...)` takes an optional
  `anim?: AnimState`.

**Composition order (must not break rotation / groups).** `drawElement`
already applies `translate(center) → rotate → flip` in element-local
space. The animation transform wraps that in **slide-space**, reusing the
existing `GHOST_ALPHA` save/restore pattern
(`slides-multi-select-resize.md`):

```
ctx.save();
ctx.globalAlpha *= anim.opacity;                 // opacity via globalAlpha
ctx.translate(anim.dx, anim.dy);                 // position in slide space
ctx.translate(cx, cy);
ctx.scale(anim.scale, anim.scale);               // scale/rotate about element center
ctx.rotate(anim.rotation);
ctx.translate(-cx, -cy);
  /* existing drawElement body (its own local rotate/flip unchanged) */
ctx.restore();
```

`hidden:true` skips the paint. A group with an animation applies the
transform once at group level; children ride the existing group-coordinate
transform unchanged (recursive renderer needs no change).

**Dirty flag.** `SlideRenderer` pins dirty `true` while animation is
active so the player's RAF repaints every frame via `forceRender`; on stop
it returns to the "skip repaint when unchanged" optimization.

### Editing UI — Motion panel

Reuses the existing right slot. `slides-detail.tsx` `RightPanel` union
gains `"motion"` alongside `"theme"` / `"format"`; a new
**`MotionPanel`** (`packages/frontend/src/app/slides/motion-panel/`)
holds transitions + animations together (like Google Slides):

1. **Slide transition** (always shown): type dropdown, direction (when
   applicable), speed (slow/med/fast → durationMs presets), **Apply to all
   slides**.
2. **Object animation** (element selected): **+ Add animation** appends to
   `Slide.animations`; an ordered list of the slide's animations
   (drag-reorder = array reorder) with effect name / target / start icon;
   a per-row inspector (effect, category, start, duration, delay, easing,
   by-paragraph for text); a **▶ Play** button previewing the slide
   sequence on the editor canvas via the shared `AnimationPlayer`.

All edits go through the `Store` / `DocStore` interface — new ops
`setSlideTransition`, `addAnimation`, `updateAnimation`, `removeAnimation`,
`reorderAnimations` — never ad-hoc persistence (per CLAUDE.md).

The editor draws a small **order badge** on animated elements (shown when
selected), as Google Slides / PowerPoint do.

Presentation mode integrates `AnimationPlayer` into `presenter.ts`:
existing advance keys (→ / Space / click) now mean "next step"; when no
steps remain they advance to the next slide. Entering a slide plays its
`transition` then starts the step queue.

### PPTX import

Principle: **read preset identifiers, do not reverse-engineer the
primitive behavior tree.** We own the playback engine, so we map presets
to our effects and need not reproduce OOXML primitive tweens.

- **Transitions — `src/import/pptx/slide.ts`.** Parse `<p:transition>`
  (sibling of `<p:cSld>`): `spd` → `durationMs` preset; child type element
  (`<p:fade>`, `<p:push dir>`, `<p:wipe>`, `<p:cut>`, `<p:dissolve>`, …) →
  `SlideTransition.type` + `direction`. A `transition-map.ts` maps basic
  types directly; p14 extensions (morph/cube/gallery/ripple) approximate
  (cube kept; others → fade fallback or none); unsupported → report.
- **Object animations — `src/import/pptx/timing.ts` (new).** Flatten the
  `<p:timing>` time-node tree: from each effect `par`'s `cTn` read
  `presetClass` (entr/exit/emph/path) + `presetID` + `presetSubtype` →
  `effect`/`category`/`direction` via `anim-preset-map.ts`;
  `cTn.nodeType` (clickEffect/withEffect/afterEffect) + `cond`
  (delay/evt) → `start`; `cTn.dur` → `durationMs`, `delay` → `delayMs`,
  `accel`/`decel` → quantized `easing`. Target `tgtEl>spTgt spid` →
  `elementId` via a spid↔id table kept during import; `txEl`/paragraph
  conditions → `byParagraph:true`. **Unmapped preset** → preserve
  `pptxPreset` (and `motionPath` from `<p:animMotion>`), skip playback,
  report "preview only". `interactiveSeq` (triggers) and audio/video nodes
  are dropped with warnings.
- **Report — `src/import/pptx/report.ts`.** New keys:
  `transition-approximated`, `animation-preset-unmapped`,
  `animation-trigger-dropped`, `animation-media-dropped`.
- **Export.** Out of scope for v1 (PDF only). Preservation fields make a
  future lossless PPTX export possible.

### Testing strategy

- **Engine units (`src/anim/*.test.ts`)** — time/DOM-free:
  `compileTimeline` (onClick split, withPrev shared start, afterPrev
  accumulation, by-paragraph expansion, deleted-id skip); `easing`
  (boundaries, monotonicity); `sample`/`effects` (per-effect snapshots,
  composition, entrance pre-hidden / exit post-hidden); `player` (fake
  clock advance / skip-to-end, step boundaries, isLastStep).
- **Import units (`src/import/pptx/*.test.ts`)** — small synthetic
  transition/timing XML fixtures → mapping; unmapped presetID →
  `pptxPreset` preserved + report; trigger/media → dropped + report.
- **Render regression** — `drawSlide` with no `animStates` is pixel-equal
  to current output (proves the optional arg leaves the static path
  untouched); injected AnimState snapshots verify composition order
  (rotated shape + dx + scale).
- **Browser/interaction (`pnpm verify:browser:docker`)** — presentation
  step advance + skip-to-end + transition playback; Motion panel
  add/reorder/remove, Play preview, Apply-to-all.
- **Collaboration** — two clients editing one slide's animation array
  converge (reorder/append), reusing slides collaboration test patterns.
- **Gate** — every commit `pnpm verify:fast` green; manual `pnpm dev`
  smoke before merge (UI change).

### Implementation phasing

One design, delivered in stages (each its own commit / verify-green):

- **P0** — data model + CRDT + Store ops + Motion panel authoring (no
  playback; editor shows static state + order badges).
- **P1** — `src/anim/` engine + render integration; presentation-mode
  playback for transitions + entrance effects (onClick); editor Play.
- **P2** — with/after-previous, by-paragraph, exit + emphasis effects.
- **P3** — PPTX import of `<p:transition>` / `<p:timing>`, preset mapping,
  preservation of unmapped presets + motion paths.

## Implementation status (v0.5.0)

All four phases shipped on the `slides-animation-design` branch. Object
animations and slide transitions play in both presentation mode and the
editor **Play** preview; the Motion panel authors transitions + object
animations (category/effect/start/direction/delay/easing/by-paragraph);
PPTX `<p:transition>` and `<p:timing>` import best-effort.

Known limitations / deviations (tracked for follow-up):

- **Unmapped imported presets** are preserved (`pptxPreset` + `motionPath`)
  and play as `appear` (an instant show) rather than being skipped
  "preview-only". The data round-trips; only the fallback playback differs
  from the original intent.
- **Transition direction** is honored by the engine (push/slide) and by
  import, but the Motion panel does not yet expose a direction control
  (in-app authored transitions use the default "from right"). `wipe`
  ignores direction in the renderer.
- **Motion paths** are preserved on import but not authored or played in
  v1 (cross-fade/cut fallback).
- **Triggers** (`interactiveSeq`) and audio/video timeline nodes are
  dropped on import, surfaced via import-report counters.
- `entr:3` (blinds) imports as `flyIn` (lossy — raw preset not preserved).

## Risks and Mitigation

- **Render regression for existing decks.** Optional `animStates` arg
  leaves the static path untouched; a pixel-equality snapshot test guards
  it.
- **Transform composition breaking rotated / grouped elements.** Animation
  transform is applied in slide-space *outside* the element-local
  rotate/flip, reusing the proven ghost save/restore pattern; snapshot
  tests cover rotated + translated + scaled composition.
- **PPTX fidelity gaps.** We map presets, not primitives, so exotic effects
  won't play exactly. Mitigation: preserve `pptxPreset` / `motionPath` for
  lossless round-trip and surface every gap in the import report rather
  than silently dropping.
- **CRDT ordering conflicts.** Order is the array index (no separate
  integer); reorder/append merge through `Yorkie.Array`; stale
  `elementId`s are skipped at queue build.
- **RAF performance on large slides.** Dirty flag pins repaint only while
  animating; the engine samples a `Map` once per frame and reuses the
  existing single-paint path.
- **Scope creep (triggers, motion-path authoring, auto-advance).**
  Explicit non-goals; import preserves trigger/path *data* without building
  authoring or playback for them.
